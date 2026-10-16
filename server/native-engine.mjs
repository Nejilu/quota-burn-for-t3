import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { isBusy, userIntervened, campaignEnd, plan, quotaWindowsValid } from './planner.mjs';
import { extraQuotaBlock } from './providers.mjs';

const iso=()=>new Date().toISOString();
const workStates=new Set(['queued','preparing','starting','running','waiting']);
const finishedStates=new Set(['completed','interrupted','failed','cancelled','limited','rolled_back']);
// Small internal backoff after a managed run ends; quota resets still control
// eligibility independently. Never inserted between native goal phases.
export const RUN_RETRY_DELAY_MS=10000;
// T3 trims the command argument when persisting native goals. Keep the outgoing
// text untouched and normalize only comparisons used for ownership and resume.
const sameGoal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.trim()===b.trim();

export async function launchV2(project,account,campaign,{single=false}={}) {
  this.validateModel(project);
  if(this.requireWatchdog){const guard=this.store.get('watchdog','global');if(!guard||Date.now()-Date.parse(guard.checkedAt)>15000)throw new Error('Quota Burn watchdog is not ready.');try{process.kill(guard.pid,0);}catch{throw new Error('Quota Burn watchdog is not running.');}}
  const instance=account.instances.find(i=>project.instanceIds.includes(i.id));
  if(!instance)throw new Error('Account not allowed for this goal.');
  const native=!single;
  if(native&&!instance.nativeGoals)throw new Error('This T3 provider does not advertise native /goal support. Single turns remain available.');
  // Protect only projects that the user has explicitly selected for managed work.
  await this.t3.protectProject(project.t3ProjectId);
  // A single turn must never wake a Claude goal left on a bound conversation.
  let threadId=single?null:project.bindings?.[instance.id]||project.existingThreadId||null;
  let thread=threadId?await this.t3.readThread(threadId):null;
  if(thread){
    if(isBusy(thread)||thread.archivedAt)throw new Error('Conversation is busy or archived.');
    if(thread.modelSelection?.instanceId!==instance.id)throw new Error('The conversation account has changed.');
    const previous=project.lastSentMessages?.[instance.id];
    const human=thread.messages.filter(m=>m.role==='user'&&(!m.createdBy||m.createdBy==='user')).at(-1);
    if(previous&&human?.id!==previous){project.state='paused';project.reason='Human intervention in T3.';this.store.put('projects',project);throw new Error(project.reason);}
    if(thread.goal&&!sameGoal(thread.goal.objective,project.nativeObjectives?.[instance.id]))throw new Error('This native goal is not owned by Quota Burn. Use a dedicated conversation.');
  }
  const objective=project.goal;
  const resumes=native&&thread?.goal&&sameGoal(thread.goal.objective,objective)&&thread.goal.status!=='complete';
  // Claude retains its native goal across Stop and resumes on the next message.
  const text=native?(resumes?(instance.driver==='codex'?'/goal resume':'Continue.'):`/goal ${objective}`):project.goal;
  threadId ||= randomUUID();
  const run={id:randomUUID(),wireProtocol:2,native,projectId:project.id,projectName:project.name,accountId:account.id,instanceId:instance.id,
    campaignId:campaign?.id||null,threadId,messageId:randomUUID(),commandId:randomUUID(),createCommandId:randomUUID(),
    status:'prepared',startedAt:iso(),baselineUserIds:(thread?.messages||[]).filter(m=>m.role==='user').map(m=>m.id),single,
    model:project.model,maxMinutes:project.maxMinutes,nativeTurnIds:[],countedTurns:0,objective:native?objective:null};
  const modelSelection={instanceId:instance.id,model:project.model,options:project.options};
  run.command={type:'message.dispatch',commandId:run.commandId,threadId,messageId:run.messageId,text,attachments:[],modelSelection,dispatchMode:{type:'start_immediately'}};
  this.store.put('runs',run);
  if(!single){project.bindings={...project.bindings,[instance.id]:threadId};project.lastSentMessages={...project.lastSentMessages,[instance.id]:run.messageId};
    if(native)project.nativeObjectives={...project.nativeObjectives,[instance.id]:objective};this.store.put('projects',project);}
  try{
    if(!thread)await this.t3.dispatch({type:'thread.create',commandId:run.createCommandId,threadId,projectId:project.t3ProjectId,title:`QP · ${project.name}`,modelSelection,runtimeMode:project.runtimeMode,interactionMode:'default',branch:null,worktreePath:null});
    else{
      await this.t3.dispatch({type:'thread.runtime-mode.set',commandId:randomUUID(),threadId,runtimeMode:project.runtimeMode});
      await this.t3.dispatch({type:'thread.model-selection.set',commandId:randomUUID(),threadId,modelSelection});
    }
    await this.t3.dispatch(run.command);
    run.status='running';this.store.put('runs',run);project.lastRunAt=run.startedAt;this.store.put('projects',project);
    this.store.log('launch',`${native?'Native goal':'Turn'} started: ${project.name}`,{runId:run.id,threadId});
  }catch(error){run.status='unknown';run.error='Submission uncertain: check the conversation before retrying.';this.store.put('runs',run);this.store.log('uncertain',run.error,{runId:run.id},'error');throw error;}
  return run;
}

export async function stopNativeRun(run,reason) {
  // Persist the stop before I/O. A lost acknowledgement must not lose the stop intent.
  run.stopCommandId ||= randomUUID();run.stopReason=reason;run.status='interrupting';this.store.put('runs',run);
  const thread=await this.t3.readThread(run.threadId);
  if(userIntervened(thread,run))return;
  const owned=ownedNativeRuns(thread,run);
  const current=(thread.runs||[]).filter(r=>owned.has(r.id)).sort((a,b)=>b.ordinal-a.ordinal)[0];
  if(!current)return; // Submission is still uncertain. Keep the stop durable.
  run.nativeRunId=current.id;this.store.put('runs',run);
  if(!workStates.has(current.status)&&thread.goal?.status!=='active')return;
  await this.t3.interrupt(run.threadId,current.id,{commandId:run.stopCommandId});
}

export function ownedNativeRuns(thread,run){
  const owned=new Set((thread.runs||[]).filter(r=>r.userMessageId===run.messageId).map(r=>r.id));
  let added=true;while(added){added=false;for(const r of thread.runs||[]){if(!owned.has(r.id)&&[r.restartContinuationOfRunId,r.usageLimitContinuationOfRunId].some(id=>owned.has(id))){owned.add(r.id);added=true;}}}
  return owned;
}

function finish(engine,run,p,status,reason){
  run.status=status;run.endedAt=iso();
  p.nextEligibleAt=new Date(Date.now()+RUN_RETRY_DELAY_MS).toISOString();
  if(reason){p.state=reason.state;p.reason=reason.text;}
  engine.store.put('runs',run);engine.store.put('projects',p);
  engine.store.log('turn',`${run.native?'Native goal':'Turn'} ${status}: ${p.name}`,{runId:run.id,projectId:p.id});
}

export async function pollNativeRun(run) {
  const p=this.store.get('projects',run.projectId);if(!p)return;
  let thread;
  try{thread=await this.t3.readThread(run.threadId);}catch(error){run.error='T3 state unavailable; submission is not retried.';this.store.put('runs',run);return;}
  run.lastObservedAt=iso();
  if(userIntervened(thread,run)||(run.native&&thread.goal&&!sameGoal(thread.goal.objective,run.objective))){
    finish(this,run,p,'handed-off',{state:'paused',text:'Human intervention in T3.'});return;
  }
  const message=thread.messages.find(m=>m.id===run.messageId);
  if(!message){if(Date.now()-Date.parse(run.startedAt)>30000){run.status='unknown';this.store.put('runs',run);}return;}
  const owned=ownedNativeRuns(thread,run);
  const current=(thread.runs||[]).filter(r=>owned.has(r.id)).sort((a,b)=>b.ordinal-a.ordinal)[0];
  if(!current){run.status='unknown';this.store.put('runs',run);return;}
  run.nativeRunId=current.id;run.turnId=current.id;
  const roots=new Set(thread.runs.filter(r=>owned.has(r.id)).map(r=>r.rootNodeId).filter(Boolean));
  const turns=thread.providerTurns.filter(t=>roots.has(t.nodeId)&&t.nativeTurnRef);
  const ids=[...new Set([...(run.nativeTurnIds||[]),...turns.map(t=>t.id)])];
  p.turns=(p.turns||0)+Math.max(0,ids.length-(run.countedTurns||0));run.nativeTurnIds=ids;run.countedTurns=ids.length;
  run.output=thread.messages.filter(m=>m.role==='assistant'&&owned.has(m.runId)).map(m=>m.text).join('\n').slice(-6000);
  run.goal=thread.goal;
  const a=this.accounts().find(a=>a.id===run.accountId),policy=this.policy(run.accountId);
  const c=run.campaignId?this.store.get('campaigns',run.campaignId):null;
  const reserves={weeklyReserve:c?.weeklyReserve??policy.weeklyReserve,sessionReserve:c?.sessionReserve??policy.sessionReserve};
  const latestNative=[...turns].sort((a,b)=>Date.parse(b.startedAt)-Date.parse(a.startedAt))[0];
  const expired=run.maxMinutes>0&&Date.now()-Date.parse(latestNative?.startedAt||run.startedAt)>run.maxMinutes*60000;
  const stale=!a||!a.checkedAt||!Number.isFinite(Date.parse(a.checkedAt))||Date.now()-Date.parse(a.checkedAt)>300000;
  const invalidQuota=a&&(!quotaWindowsValid(a)||['auth','unknown'].includes(plan(a,policy,c).code)||Date.parse(a.checkedAt)>Date.now()+60000||[a.session,a.weekly].some(w=>!Number.isFinite(Date.parse(w?.resetsAt))||Date.parse(w.resetsAt)<=Date.now()));
  const limit=a&&(invalidQuota||extraQuotaBlock(a,reserves)||a.unavailable||!a.weekly||!a.session||100-a.weekly.usedPercent<=reserves.weeklyReserve||100-a.session.usedPercent<=reserves.sessionReserve);
  const campaignStopped=run.campaignId&&(!c||!c.enabled||['paused','completed'].includes(c.status)||(campaignEnd(c)&&Date.parse(campaignEnd(c))<=Date.now())||(c.maxPoints!=null&&(c.consumedPoints||0)>=c.maxPoints));
  const summaries=turns.filter(t=>t.status==='completed').map(t=>thread.messages.filter(m=>m.role==='assistant'&&m.nativeTurnId===t.id).map(m=>m.text).join(' ').replace(/\s+/g,' ').trim()).filter(Boolean).slice(-3);
  const repeated=summaries.length===3&&summaries.every(x=>x===summaries[0]);
  const turnsLimited=run.native&&p.maxTurns>0&&(p.turns>p.maxTurns||p.turns>=p.maxTurns&&latestNative?.status==='completed');
  const settings=this.store.settings();
  const prohibited=settings.mode==='paused'||(!run.single&&settings.mode!=='active')||p.state==='paused'||policy.paused||(!run.single&&!policy.enabled&&!c);
  const otherWork=(this.t3.shell?.threads||[]).some(t=>t.id!==run.threadId&&t.lineage?.rootThreadId!==run.threadId&&isBusy(t)&&
    (a?.instances.some(i=>i.id===t.modelSelection?.instanceId)||(this.t3.shell.projects||[]).some(s=>s.id===t.projectId&&resolve(s.workspaceRoot).toLowerCase()===p.repositoryRoot.toLowerCase())));
  const guard=this.store.get('watchdog','global');
  const guardAbsent=this.requireWatchdog&&(!guard||!Number.isFinite(Date.parse(guard.checkedAt))||Date.now()-Date.parse(guard.checkedAt)>15000);
  const unsafeRecovery=this.t3.rawConfig?.settings?.autoResumeLimitedThreads===true;
  let reason=run.stopReason;
  if(!reason){reason=repeated?'Three identical native summaries: check progress.':prohibited?'Managed work paused.':guardAbsent?'Quota Burn watchdog unavailable.':unsafeRecovery?'Disable automatic usage-limit recovery in T3.':expired?'Maximum native turn duration reached.':stale?'Quotas have been unavailable for more than five minutes.':campaignStopped?(c?.reason||'Campaign stopped.'):limit?(a?.unavailable||'Quota reserve reached.'):turnsLimited?'Native turn limit reached.':otherWork?'Manual work takes priority.':null;}
  // Never infer completion from the end of one phase: native goals own their lifecycle.
  const working=workStates.has(current.status)||!finishedStates.has(current.status);
  const goalWorking=run.native&&thread.goal?.status==='active'&&working;
  if((working||goalWorking)&&reason){
    this.store.put('projects',p);
    if(expired||turnsLimited||repeated){p.state=repeated?'blocked':'paused';p.reason=reason;this.store.put('projects',p);}
    await stopNativeRun.call(this,run,reason);return;
  }
  if(working){
    run.status=thread.hasPendingApprovals?'waiting-approval':thread.hasPendingUserInput?'waiting-input':'running';
    this.store.put('runs',run);this.store.put('projects',p);return;
  }
  if(current.status==='limited'&&thread.limitRecovery?.autoResume){
    await this.t3.dispatch({type:'thread.metadata.update',commandId:randomUUID(),threadId:run.threadId,
      limitRecovery:{runId:current.id,resetAt:thread.limitRecovery.resetAt,autoResume:false,snooze:false}});
  }
  if(reason){finish(this,run,p,'interrupted',expired||turnsLimited||repeated?{state:repeated?'blocked':'paused',text:reason}:null);return;}
  if(thread.goal?.status==='usage_limited'){finish(this,run,p,'interrupted',null);p.nextEligibleAt=a?.session?.resetsAt||new Date(Date.now()+300000).toISOString();this.store.put('projects',p);return;}
  if(current.status==='interrupted'&&run.native&&thread.goal?.status==='active'){finish(this,run,p,'interrupted',null);return;}
  if(current.status==='failed'){run.error='T3 run failed.';finish(this,run,p,'error',{state:'blocked',text:run.error});return;}
  if(!run.native){finish(this,run,p,'completed',{state:'completed',text:'Single turn completed.'});return;}
  switch(thread.goal?.status){
    case 'complete':finish(this,run,p,'completed',{state:'completed',text:'Native goal completed.'});break;
    case 'blocked':finish(this,run,p,'completed',{state:'blocked',text:thread.goal.lastCheck||'Native goal blocked.'});break;
    case 'usage_limited':
      finish(this,run,p,'interrupted',null);p.nextEligibleAt=a?.session?.resetsAt||new Date(Date.now()+300000).toISOString();this.store.put('projects',p);break;
    case 'paused':case 'budget_limited':finish(this,run,p,'interrupted',{state:'paused',text:'Native goal paused in T3.'});break;
    default:finish(this,run,p,'interrupted',{state:'paused',text:'Native goal state needs review in T3.'});
  }
}

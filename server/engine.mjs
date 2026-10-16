import { overlappingWorkspace } from './platform.mjs';
import { launchV2,pollNativeRun,stopNativeRun,RUN_RETRY_DELAY_MS } from './native-engine.mjs';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { defaultPolicy,projectSchema,campaignSchema,policySchema } from './schema.mjs';
import { plan,selectCampaign,isBusy,userIntervened,progressResult,campaignEnd,campaignStarted } from './planner.mjs';
import { withCodex,creditsView } from './codex.mjs';
import { withClaude } from './claude.mjs';
import { providerOf,driverOf,extraQuotaBlock } from './providers.mjs';
import { englishRecord } from './legacy-messages.mjs';
const execute=promisify(execFile);
const activeStatuses=['prepared','running','waiting-approval','waiting-input','interrupting','unknown'];
const nowISO=()=>new Date().toISOString();

// Goal state is the only scheduling switch. Preserve old opt-outs as a pause,
// rather than silently enabling definitions saved with the retired switches.
function cleanGoal(project){
  const {enabled,repeat,continuation,priority,cooldownSeconds,...goal}=project;
  if(goal.state==='ready'&&(enabled===false||repeat===false)){
    goal.state='paused';goal.reason='Paused.';
  }
  return goal;
}

export class Engine {
  constructor(store,t3,{codex=withCodex,claude=withClaude,requireWatchdog=process.env.QP_WATCHDOG_ENABLED==='1'}={}){this.store=store;this.t3=t3;this.codex=codex;this.claude=claude;this.requireWatchdog=requireWatchdog;this.connected=false;this.error=null;this.lastRefresh=0;this.lastAttempt=0;this.chain=Promise.resolve();this.decisions=[];this.stopping=false;for(const p of store.list('projects'))if(['enabled','repeat','continuation','priority','cooldownSeconds'].some(k=>Object.hasOwn(p,k)))store.put('projects',cleanGoal(p));const selected=store.list('projects').filter(p=>p.state==='ready');if(selected.length>1)for(const p of selected)store.put('projects',{...p,state:'paused',reason:'Choose one active goal.'});for(const intent of store.list('resets').filter(r=>r.status==='prepared'))store.put('resets',{...intent,status:'unknown',error:'Restart during a reset: retry the same intent.'});}
  serial(fn){const next=this.chain.then(fn);this.chain=next.catch(()=>{});return next;}
  accounts(){return this.t3.accounts.length?this.t3.accounts:this.store.list('accounts');}
  policy(id){const account=this.accounts().find(a=>a.id===id);return {...defaultPolicy(),windowWeeklyPoints:providerOf(account)?.windowWeeklyPoints||16,...this.store.get('policies',id),id};}
  runs(){return this.store.list('runs').sort((a,b)=>b.startedAt.localeCompare(a.startedAt));}
  async refresh(){this.lastAttempt=Date.now();try{const result=await this.t3.connect(true);this.connected=true;this.error=null;this.lastRefresh=Date.now();for(const a of this.t3.publicAccounts()){this.store.put('accounts',a);this.store.sample(a);}this.updateCampaigns();this.store.log('refresh','Quotas and projects synced with T3.');return result;}catch(e){this.connected=false;if(this.error!==e.message)this.store.log('connection',e.message,{},'error');this.error=e.message;throw e;}}
  updateCampaigns(){const now=Date.now(),active=this.store.settings().mode==='active';for(const c of this.store.list('campaigns')){if(!c.enabled||c.status==='completed'||c.status==='paused')continue;let reason=null;if(campaignEnd(c)&&Date.parse(campaignEnd(c))<=now)reason='End date reached.';if(active&&campaignStarted(c,now)){c.baselines??={};for(const a of this.accounts().filter(a=>c.accountIds.includes(a.id)&&a.weekly)){const current={used:a.weekly.usedPercent,epoch:a.weekly.resetsAt},old=c.baselines[a.id];if(old){if(Math.abs(Date.parse(old.epoch)-Date.parse(current.epoch))>60000||current.used<old.used){if(!c.continueAfterReset)reason='Weekly reset detected: campaign completed.';else c.consumedPoints=(c.consumedPoints||0)+Math.max(0,current.used);}else c.consumedPoints=(c.consumedPoints||0)+Math.max(0,current.used-old.used);}c.baselines[a.id]=current;}if(c.maxPoints!=null&&(c.consumedPoints||0)>=c.maxPoints)reason='Cumulative cap reached.';const allReserved=c.accountIds.every(id=>{const a=this.accounts().find(a=>a.id===id);return a?.weekly&&100-a.weekly.usedPercent<=c.weeklyReserve;});if(allReserved&&(c.resetRule.mode==='never'||(c.resetCount||0)>=c.resetRule.maxResets))reason='Weekly reserve reached.';}
      if(reason){c.status='completed';c.reason=reason;this.store.log('campaign',`${c.name} : ${reason}`,{campaignId:c.id});}this.store.put('campaigns',c);}}
  decisionFor(a){const campaign=selectCampaign(this.store.list('campaigns'),a.id);return {...plan(a,this.policy(a.id),campaign),campaignId:campaign?.id||null,campaignName:campaign?.name||null};}
  snapshot(){const accounts=this.t3.accounts.length?this.t3.publicAccounts():this.store.list('accounts');return {version:'0.2.0',settings:this.store.settings(),connection:{connected:this.connected,error:this.error,lastRefresh:this.lastRefresh?new Date(this.lastRefresh).toISOString():null,origin:this.t3.publicOrigin||this.t3.origin,remote:!!this.t3.remote,serverVersion:this.t3.descriptor?.serverVersion,protocol:this.t3.compatibility?.protocol,nativeGoals:this.t3.compatibility?.nativeGoals||false},accounts:accounts.map(a=>({...a,policy:this.policy(a.id),history:this.store.history(a.id),credits:this.store.get('credits',a.id),decision:this.decisions.find(d=>d.accountId===a.id)||this.decisionFor(a)})),projects:this.store.list('projects').map(p=>({...englishRecord(p),runState:this.runs().find(r=>r.projectId===p.id&&activeStatuses.includes(r.status))?.status,nativeGoal:this.runs().find(r=>r.projectId===p.id&&r.wireProtocol===2)?.goal||null})),campaigns:this.store.list('campaigns').sort((a,b)=>b.priority-a.priority).map(englishRecord),runs:this.runs().slice(0,100).map(englishRecord),resets:this.store.list('resets').slice(-50).reverse().map(englishRecord),events:this.store.events().map(englishRecord),t3Projects:(this.t3.shell?.projects||[]).map(p=>({id:p.id,title:p.title,workspaceRoot:p.workspaceRoot})),t3Threads:(this.t3.shell?.threads||[]).filter(t=>!t.archivedAt).map(t=>({id:t.id,title:t.title,projectId:t.projectId,instanceId:t.modelSelection?.instanceId,busy:isBusy(t)})),now:nowISO()};}
  validateModel(project){const drivers=new Set(project.instanceIds.map(id=>this.t3.accounts.flatMap(a=>a.instances).find(i=>i.id===id)?.driver).filter(Boolean));if(drivers.size>1)throw new Error('Choose instances from a single provider for each goal.');for(const id of project.instanceIds){const instance=this.t3.accounts.flatMap(a=>a.instances).find(i=>i.id===id);if(!instance)throw new Error('T3 account not found. Refresh your accounts.');if(instance.installed===false)throw new Error('Install and connect this provider in T3 first.');const model=instance.models.find(m=>m.id===project.model);if(!model)throw new Error(`Model unavailable for ${instance.name}.`);for(const choice of project.options){const d=model.options.find(d=>d.id===choice.id);if(!d||(d.type==='select'&&!d.options.some(o=>o.id===choice.value))||(d.type==='boolean'&&typeof choice.value!=='boolean'))throw new Error('Unsupported model option.');}}}
  async saveProject(input,id){if(!this.connected)throw new Error('Reconnect T3 before editing a project.');const data=projectSchema.parse(input);this.validateModel(data);const source=this.t3.shell.projects.find(p=>p.id===data.t3ProjectId);if(!source)throw new Error('T3 project not found.');const workspaceRoot=this.t3.validateFolder?await this.t3.validateFolder(source.workspaceRoot):await realpath(source.workspaceRoot);let repositoryRoot=workspaceRoot;if(!this.t3.remote)try{repositoryRoot=(await execute('git',['-C',workspaceRoot,'rev-parse','--show-toplevel'],{encoding:'utf8',windowsHide:true,timeout:5000})).stdout.trim();}catch{}
    const saved=id?this.store.get('projects',id):null;const old=saved?cleanGoal(saved):null;if(id&&!old)throw new Error('Project not found.');if(old&&this.runs().some(r=>r.projectId===id&&activeStatuses.includes(r.status)))throw new Error('Pause the project and wait for the current turn to finish before editing it.');if(data.existingThreadId){const thread=await this.t3.readThread(data.existingThreadId);if(thread.projectId!==source.id||!data.instanceIds.includes(thread.modelSelection?.instanceId))throw new Error('The conversation does not match the selected project or account.');if(isBusy(thread))throw new Error('This conversation is already running.');}
    const record={...old,...data,id:id||randomUUID(),workspaceRoot,repositoryRoot,bindings:old?.bindings||{},state:old?.state||'paused',createdAt:old?.createdAt||nowISO(),updatedAt:nowISO()};this.store.put('projects',record);this.store.log('project',`${old?'Project updated':'Project created'} : ${record.name}`,{projectId:record.id});return record;}
  assertCampaignIdle(id){if(this.runs().some(r=>r.campaignId===id&&activeStatuses.includes(r.status)))throw new Error('Stop the current turn before editing or deleting this campaign.');}
  saveCampaign(input,id){if(id)this.assertCampaignIdle(id);const data=campaignSchema.parse(input);if(data.accountIds.some(id=>!this.accounts().some(a=>a.id===id)))throw new Error('Campaign account not found.');if(data.resetRule.mode!=='never'&&data.accountIds.some(id=>this.accounts().find(a=>a.id===id)?.capabilities?.resetCredits===false))throw new Error('One selected provider does not support reset credits.');if(data.projectIds.some(id=>!this.store.get('projects',id)))throw new Error('Campaign project not found.');const old=id?this.store.get('campaigns',id):null;if(id&&!old)throw new Error('Campaign not found.');const record={...old,...data,id:id||randomUUID(),status:old?.status==='completed'?'completed':data.enabled?'ready':'paused',consumedPoints:old?.consumedPoints||0,resetCount:old?.resetCount||0,createdAt:old?.createdAt||nowISO()};this.store.put('campaigns',record);this.store.log('campaign',`Campaign saved: ${record.name}`,{campaignId:record.id});return record;}
  setPolicy(id,data){if(!this.accounts().some(a=>a.id===id))throw new Error('Unknown account.');return this.store.put('policies',{id,...policySchema.parse({...this.policy(id),...data})});}
  async tick(){if(this.stopping)return;const settings=this.store.settings();if(Date.now()-this.lastAttempt>settings.pollSeconds*1000)await this.refresh().catch(()=>{});if(this.connected)await this.t3.readShell();await this.pollRuns();this.updateCampaigns();this.decisions=this.accounts().map(a=>this.decisionFor(a));if(!this.connected||settings.mode!=='active')return;
    if(this.runs().some(r=>activeStatuses.includes(r.status)))return;
    await this.processResets();
    this.decisions=this.accounts().map(a=>this.decisionFor(a));
    if(this.runs().some(r=>activeStatuses.includes(r.status)))return;
    const shell=await this.t3.readShell();
    for(const decision of this.decisions.filter(d=>d.shouldRun).sort((a,b)=>(this.store.get('campaigns',b.campaignId)?.priority||0)-(this.store.get('campaigns',a.campaignId)?.priority||0)||Date.parse(a.deadline)-Date.parse(b.deadline))){
      const account=this.t3.accounts.find(a=>a.id===decision.accountId);const ids=account.instances.map(i=>i.id);
      if(shell.threads.some(t=>(this.t3.remote||ids.includes(t.modelSelection?.instanceId))&&isBusy(t))){decision.reason='A T3 conversation is using this account; manual work takes priority.';continue;}
      const campaign=decision.campaignId?this.store.get('campaigns',decision.campaignId):null;
      const projects=this.store.list('projects').filter(p=>p.state==='ready'&&p.instanceIds.some(id=>ids.includes(id))&&(!campaign?.projectIds.length||campaign.projectIds.includes(p.id))&&(!p.nextEligibleAt||Date.parse(p.nextEligibleAt)<=Date.now())&&(!p.maxTurns||(p.turns||0)<p.maxTurns));
      let launched=false;for(const project of projects){const busyRepo=shell.threads.some(t=>isBusy(t)&&shell.projects.some(p=>p.id===t.projectId&&overlappingWorkspace(p.workspaceRoot,project.repositoryRoot)));if(busyRepo)continue;await this.launch(project,account,campaign);launched=true;break;}
      if(launched)break;decision.reason='No eligible goals: create a goal or resume a paused one.';
    }
  }
  async launch(project,account,campaign,{single=false}={}){
    if(this.t3.compatibility?.protocol===2)return launchV2.call(this,project,account,campaign,{single});
    this.validateModel(project);const instance=account.instances.find(i=>project.instanceIds.includes(i.id));if(!instance)throw new Error('Account not allowed for this goal.');
    let threadId=project.bindings?.[instance.id]||project.existingThreadId||null,thread=null;
    if(threadId){thread=await this.t3.readThread(threadId);if(isBusy(thread)||thread.archivedAt)throw new Error('Conversation is busy or archived.');if(thread.modelSelection?.instanceId!==instance.id)throw new Error('The conversation account has changed.');const previous=project.lastSentMessages?.[instance.id];if(previous&&thread.messages.filter(m=>m.role==='user').at(-1)?.id!==previous){project.state='paused';project.reason='A human message was added since the last turn.';this.store.put('projects',project);throw new Error(project.reason);}}
    const modelSelection={instanceId:instance.id,model:project.model,options:project.options};
    threadId ||= randomUUID();const startedAt=nowISO(),run={id:randomUUID(),projectId:project.id,projectName:project.name,accountId:account.id,instanceId:instance.id,campaignId:campaign?.id||null,threadId,messageId:randomUUID(),commandId:randomUUID(),createCommandId:randomUUID(),status:'prepared',startedAt,baselineUserIds:(thread?.messages||[]).filter(m=>m.role==='user').map(m=>m.id),single,model:project.model,maxMinutes:project.maxMinutes};
    const text=`[Quota Burn — persistent goal]\n${project.goal}\n\n${(project.turns||0)>0?'Continue the existing objective.':'Start with the next concrete step toward this goal.'}\n\nFollow the repository instructions (AGENTS.md and CLAUDE.md when applicable) and the selected permissions. End each step with a short summary and the next useful action. If the goal is complete, end with [QP_COMPLETE]. If human input is needed or no useful progress is possible, end with [QP_BLOCKED] and explain why. Do not invent work just to consume quota.`;
    run.command={type:'thread.turn.start',commandId:run.commandId,threadId,message:{messageId:run.messageId,role:'user',text,attachments:[]},modelSelection,runtimeMode:project.runtimeMode,interactionMode:'default',createdAt:startedAt};
    this.store.put('runs',run);project.bindings={...project.bindings,[instance.id]:threadId};project.lastSentMessages={...project.lastSentMessages,[instance.id]:run.messageId};this.store.put('projects',project);
    try{if(!thread)await this.t3.dispatch({type:'thread.create',commandId:run.createCommandId,threadId,projectId:project.t3ProjectId,title:`QP · ${project.name}`,modelSelection,runtimeMode:project.runtimeMode,interactionMode:'default',branch:null,worktreePath:null,createdAt:startedAt});await this.t3.dispatch(run.command);run.status='running';this.store.put('runs',run);project.lastRunAt=startedAt;this.store.put('projects',project);this.store.log('launch',`Turn started: ${project.name}`,{runId:run.id,threadId});}
    catch(e){run.status='unknown';run.error='Submission uncertain: check the conversation before retrying.';this.store.put('runs',run);this.store.log('uncertain',run.error,{runId:run.id},'error');throw e;}
    return run;
  }
  async pollRuns(){for(const run of this.runs().filter(r=>activeStatuses.includes(r.status))){if(run.wireProtocol===2){await pollNativeRun.call(this,run);continue;}let thread;try{thread=await this.t3.readThread(run.threadId);}catch(e){if(e.status===404&&Date.now()-Date.parse(run.startedAt)>30000){run.status='unknown';run.error='Conversation not found. Check again before retrying.';this.store.put('runs',run);}continue;}const project=this.store.get('projects',run.projectId);if(!project)continue;
      if(userIntervened(thread,run)){run.status='handed-off';run.endedAt=nowISO();project.state='paused';project.reason='Human intervention in T3.';this.store.put('runs',run);this.store.put('projects',project);this.store.log('human','Control handed back to the user in T3.',{runId:run.id});continue;}
      const ownMessage=thread.messages.find(m=>m.id===run.messageId);if(!ownMessage){if(Date.now()-Date.parse(run.startedAt)>30000){run.status='unknown';this.store.put('runs',run);}continue;}
      run.turnId=ownMessage.turnId||thread.latestTurn?.turnId||run.turnId;
      const shellThread=this.t3.shell?.threads.find(t=>t.id===thread.id);
      if(isBusy(thread)){
        run.status=shellThread?.hasPendingApprovals?'waiting-approval':shellThread?.hasPendingUserInput?'waiting-input':run.status==='interrupting'?'interrupting':'running';
        const a=this.accounts().find(a=>a.id===run.accountId),c=run.campaignId?this.store.get('campaigns',run.campaignId):null;const decision=a?plan(a,this.policy(a.id),c):null;
        const expired=run.maxMinutes>0&&Date.now()-Date.parse(run.startedAt)>run.maxMinutes*60000;
        const stale=!a||Date.now()-Date.parse(a.checkedAt)>300000;
        const reserveWeekly=c?.weeklyReserve??this.policy(run.accountId).weeklyReserve;const reserveSession=c?.sessionReserve??this.policy(run.accountId).sessionReserve;const hard=!!a&&(extraQuotaBlock(a,{weeklyReserve:reserveWeekly,sessionReserve:reserveSession})||a.unavailable||!a.weekly||!a.session||100-a.weekly.usedPercent<=reserveWeekly||100-a.session.usedPercent<=reserveSession||c?.status==='completed'||(campaignEnd(c)&&Date.parse(campaignEnd(c))<=Date.now())||(c?.maxPoints!=null&&(c.consumedPoints||0)>=c.maxPoints));
        if(run.status!=='interrupting'&&(expired||stale||hard)){await this.t3.interrupt(run.threadId,run.turnId);run.status='interrupting';run.stopReason=expired?'Maximum turn duration reached.':stale?'Quotas have been unavailable for more than five minutes.':c?.reason||decision?.reason||'Usage limit reached.';if(expired){project.state='paused';project.reason=run.stopReason;this.store.put('projects',project);}}
        this.store.put('runs',run);continue;
      }
      if(!thread.latestTurn||thread.latestTurn.turnId!==run.turnId)continue;
      const state=thread.latestTurn.state;if(state==='running')continue;
      const output=thread.messages.filter(m=>m.role==='assistant'&&m.turnId===run.turnId).map(m=>m.text).join('\n').trim();
      run.status=state==='completed'?'completed':state==='interrupted'?'interrupted':'error';run.output=output.slice(-6000);run.endedAt=nowISO();run.error=thread.session?.lastError||run.error||null;
      project.turns=(project.turns||0)+1;project.nextEligibleAt=new Date(Date.now()+RUN_RETRY_DELAY_MS).toISOString();
      const result=progressResult(output,project.recentOutputs||[]);project.recentOutputs=[...(project.recentOutputs||[]),output.replace(/\s+/g,' ').trim()].slice(-3);
      if(state==='error'){project.state='blocked';project.reason=run.error||'The last turn failed.';}
      else if(state==='interrupted'&&!run.stopReason){project.state='paused';project.reason='Turn interrupted in T3.';}
      else if(result==='blocked'||result==='empty'||result==='repeated'){project.state='blocked';project.reason=result==='blocked'?'The agent is waiting for human input.':result==='repeated'?'Three identical summaries: check progress.':'No usable summary.';}
      else if(result==='complete'||run.single||(project.maxTurns&&project.turns>=project.maxTurns)){project.state='completed';project.reason=result==='complete'?'Goal completed.':'Turn limit reached or single-turn test completed.';}
      this.store.put('runs',run);this.store.put('projects',project);this.store.log('turn',`Turn ${run.status}: ${project.name}`,{runId:run.id,projectId:project.id});
    }}
  async stopAll(){this.store.put('settings',{...this.store.settings(),mode:'paused'});for(const run of this.runs().filter(r=>activeStatuses.includes(r.status))){if(run.wireProtocol===2){const nativeThread=await this.t3.readThread(run.threadId).catch(()=>null);if(nativeThread&&(isBusy(nativeThread)||nativeThread.goal?.status==='active'&&nativeThread.latestRunId)&&!userIntervened(nativeThread,run))await stopNativeRun.call(this,run,'Immediate stop requested.');continue;}const thread=await this.t3.readThread(run.threadId).catch(()=>null);if(thread&&isBusy(thread)&&!userIntervened(thread,run)){await this.t3.interrupt(run.threadId,run.turnId||thread.session?.activeTurnId);run.status='interrupting';run.stopReason='Immediate stop requested.';this.store.put('runs',run);}}this.store.log('stop','Global stop requested; only managed conversations are interrupted.');}
  async projectAction(id,action){
    const p=this.store.get('projects',id);if(!p)throw new Error('Project not found.');
    if(action==='pause'){
      if(p.state==='completed'&&!this.runs().some(r=>r.projectId===id&&activeStatuses.includes(r.status)))return;
      p.state='paused';p.reason='Pause requested.';this.store.put('projects',p);
      for(const run of this.runs().filter(r=>r.projectId===id&&activeStatuses.includes(r.status))){
        const thread=await this.t3.readThread(run.threadId);
        if(userIntervened(thread,run))continue;
        if(run.wireProtocol===2){
          if(isBusy(thread)||thread.goal?.status==='active'&&thread.latestRunId)await stopNativeRun.call(this,run,'Goal paused.');
        }else if(isBusy(thread)){
          await this.t3.interrupt(run.threadId,run.turnId||thread.session?.activeTurnId);
          this.store.put('runs',{...run,status:'interrupting',stopReason:'Goal paused.'});
        }
      }
    }else if(action==='resume'){
      if(this.runs().some(r=>r.projectId===id&&r.status==='unknown'))throw new Error('Resolve the uncertain submission in the activity log first.');
      // Persist the old selection's pause before Stop. A failed Stop must never
      // leave two active goals or allow the new one to launch beside the old run.
      const otherRunning=new Set(this.runs().filter(r=>r.projectId!==id&&activeStatuses.includes(r.status)).map(r=>r.projectId));
      for(const other of this.store.list('projects').filter(g=>g.id!==id&&(g.state==='ready'||otherRunning.has(g.id))))await this.projectAction(other.id,'pause');
      p.state='ready';p.reason=null;p.recentOutputs=[];p.nextEligibleAt=null;p.lastSentMessages={};
      if(p.maxTurns&&p.turns>=p.maxTurns)p.turns=0;
    }else throw new Error('Unknown action.');
    this.store.put('projects',p);this.store.log('project',`${p.name} : ${action==='pause'?'paused':'activated'}.`);
  }
  async resolveRun(id){const r=this.store.get('runs',id);if(!r||r.status!=='unknown')throw new Error('No uncertain submission to resolve.');const t=await this.t3.readThread(r.threadId).catch(e=>{if(e.status===404)return null;throw e;});if(t?.messages.some(m=>m.id===r.messageId)){await this.pollRuns();return;}if(isBusy(t))throw new Error('The conversation is running; retry is not allowed.');r.status='cancelled';r.endedAt=nowISO();r.error='Submission not found; cancellation confirmed after checking T3.';this.store.put('runs',r);this.store.log('reconcile',r.error,{runId:id});}
  async readCredits(id){const a=this.t3.accounts.find(a=>a.id===id);if(!a)throw new Error('Reconnect this account in T3.');if(a.capabilities?.resetCredits===false)throw new Error('Reset credits are not supported for this provider.');const instance=a.instances.find(i=>i.resetAllowed!==false)||a.instances[0];const details=driverOf(a)==='claudeAgent'?await this.claude(instance,c=>c.read()):creditsView(await this.codex(instance,c=>c.read()));const view={id,...details,checkedAt:nowISO()};this.store.put('credits',view);return view;}
  async consumeCredit(accountId,creditId,{intentId=null,campaignId=null}={}){
    if(this.store.settings().mode!=='active')throw new Error('Enable the pilot before applying a reset.');
    const a=this.t3.accounts.find(a=>a.id===accountId);if(!a)throw new Error('Account not found.');if(a.capabilities?.resetCredits===false)throw new Error('Reset credits are not supported for this provider.');let intent=intentId?this.store.get('resets',intentId):null;
    if(intentId&&(!intent||intent.accountId!==accountId))throw new Error('Reset intent not found.');
    if(intent?.status==='completed')return intent;
    if(!intent){if(this.store.list('resets').some(r=>r.accountId===accountId&&r.status==='unknown'))throw new Error('A reset result is uncertain. Retry the same operation before creating another.');const credits=await this.readCredits(accountId);if(!credits.credits?.some(c=>c.id===creditId&&c.status==='available'&&(!c.expiresAt||Date.parse(c.expiresAt)>Date.now())))throw new Error('This credit is no longer available.');intent={id:randomUUID(),idempotencyKey:randomUUID(),accountId,creditId,campaignId,status:'prepared',createdAt:nowISO()};this.store.put('resets',intent);}
    try{const adapter=driverOf(a)==='claudeAgent'?this.claude:this.codex;const instance=a.instances.find(i=>i.resetAllowed!==false)||a.instances[0];const result=await adapter(instance,c=>c.consume(intent.creditId,intent.idempotencyKey));intent.outcome=result.outcome;intent.status=['reset','alreadyRedeemed'].includes(result.outcome)?'completed':'declined';intent.endedAt=nowISO();this.store.put('resets',intent);if(intent.status==='completed'&&intent.campaignId){const campaign=this.store.get('campaigns',intent.campaignId);campaign.resetCount=(campaign.resetCount||0)+1;this.store.put('campaigns',campaign);}this.store.log('reset',`Reset : ${result.outcome}.`,{resetId:intent.id});await this.refresh().catch(()=>{});await this.readCredits(accountId).catch(()=>{});return intent;}
    catch(e){intent.status='unknown';intent.error='Reset result uncertain: retry the same intent.';this.store.put('resets',intent);this.store.log('reset',intent.error,{resetId:intent.id},'error');throw e;}
  }
  async processResets(){for(const c of this.store.list('campaigns').filter(c=>c.enabled&&c.status!=='paused'&&c.status!=='completed'&&campaignStarted(c)&&(!campaignEnd(c)||Date.parse(campaignEnd(c))>Date.now())&&c.resetRule?.mode!=='never'&&(c.resetCount||0)<c.resetRule.maxResets)){for(const id of c.accountIds){const a=this.t3.accounts.find(a=>a.id===id);if(!a?.weekly||a.capabilities?.resetCredits===false||Date.now()-Date.parse(a.checkedAt)>180000||this.policy(id).paused||100-a.weekly.usedPercent>c.resetRule.weeklyRemainingAtMost)continue;if(this.store.list('resets').some(r=>r.accountId===id&&['prepared','unknown'].includes(r.status)))continue;
        if(c.resetRule.mode==='scheduled'&&Date.parse(c.resetRule.at)>Date.now())continue;
        const credits=await this.readCredits(id);if(credits.availableCount<=c.resetRule.keepCredits)continue;const candidates=(credits.credits||[]).filter(x=>x.status==='available'&&(!x.expiresAt||Date.parse(x.expiresAt)>Date.now())).sort((a,b)=>Date.parse(a.expiresAt||'9999-01-01')-Date.parse(b.expiresAt||'9999-01-01'));
        const credit=candidates.find(x=>c.resetRule.mode==='scheduled'||(x.expiresAt&&Date.parse(x.expiresAt)-Date.now()<=c.resetRule.beforeExpiryHours*3600000));if(credit){await this.consumeCredit(id,credit.id,{campaignId:c.id});return;}
      }}}
  async shutdown(){this.stopping=true;await this.chain;await this.stopAll();await this.t3.close();}
}

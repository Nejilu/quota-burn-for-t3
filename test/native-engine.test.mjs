import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/store.mjs';
import {Engine} from '../server/engine.mjs';
import {normalizeV2Projection} from '../server/t3-compat.mjs';
import {projectSchema} from '../server/schema.mjs';
import {RUN_RETRY_DELAY_MS} from '../server/native-engine.mjs';

function fixture(driver='codex'){
  const store=new Store(':memory:'),now=()=>new Date().toISOString();
  const a={id:'a',name:'A',driver,authStatus:'authenticated',checkedAt:now(),session:{usedPercent:0,resetsAt:new Date(Date.now()+18000000).toISOString(),windowDurationMins:300},weekly:{usedPercent:0,resetsAt:new Date(Date.now()+604800000).toISOString()},instances:[{id:'i',driver,nativeGoals:true,models:[{id:'m',options:[]}]}]};
  const p={id:'p',name:'Goal',goal:'Complete the useful work',t3ProjectId:'repo',repositoryRoot:'/repo',instanceIds:['i'],model:'m',options:[],runtimeMode:'approval-required',state:'ready',priority:50,maxTurns:0,maxMinutes:30,cooldownSeconds:10};
  const commands=[],threads=new Map();let fail=false,stopFail=false,seq=0;
  const t3={accounts:[a],compatibility:{protocol:2,nativeGoals:true},rawConfig:{settings:{autoResumeLimitedThreads:false}},shell:{projects:[{id:'repo',workspaceRoot:'/repo'}],threads:[]},
    publicAccounts(){return this.accounts;},async connect(){return{};},async close(){},async readShell(){return this.shell;},async protectProject(){},
    async readThread(id){if(!threads.has(id))throw Error('Missing thread');return normalizeV2Projection(threads.get(id));},
    async dispatch(c){commands.push(c);if(c.type==='thread.create')threads.set(c.threadId,{thread:{id:c.threadId,projectId:c.projectId,modelSelection:c.modelSelection,activeProviderThreadId:'pt'},runs:[],messages:[],nodes:[],providerThreads:[{id:'pt',goal:null}],providerTurns:[],runtimeRequests:[]});
      if(c.type==='message.dispatch'){const t=threads.get(c.threadId),id='r'+(++seq),root='root'+seq;
        t.messages.push({id:c.messageId,role:'user',createdBy:'user',runId:id,text:c.text,createdAt:now()});t.runs.push({id,ordinal:seq,userMessageId:c.messageId,rootNodeId:root,status:'running'});
        if(c.text.startsWith('/goal ')&&c.text!=='/goal resume')t.providerThreads[0].goal={objective:c.text.slice(6),status:'active'};
        if(c.text==='/goal resume')t.providerThreads[0].goal.status='active';
        t.providerTurns.push({id:'turn'+seq,nodeId:root,status:'running',nativeTurnRef:{nativeId:'native'+seq},startedAt:now()});
        if(fail)throw Error('Lost response after acceptance');}
      return{};},
    async interrupt(id,runId,options){commands.push({type:'run.interrupt',runId,...options});if(stopFail)throw Error('Stop acknowledgement lost');const t=threads.get(id);t.runs.at(-1).status='interrupted';if(driver==='codex'&&t.providerThreads[0].goal)t.providerThreads[0].goal.status='paused';}
  };
  store.put('projects',p);store.put('settings',{id:'global',mode:'active',pollSeconds:60});
  const engine=new Engine(store,t3);engine.connected=true;engine.lastAttempt=Date.now();
  return{store,a,p,t3,commands,threads,engine,async launch(options){return engine.launch(store.get('projects','p'),a,null,options);},get detail(){return [...threads.values()].at(-1);},phase(){const t=this.detail;t.providerTurns.at(-1).status='completed';t.providerTurns.push({id:'phase'+t.providerTurns.length,nodeId:t.runs.at(-1).rootNodeId,status:'running',nativeTurnRef:{nativeId:'next'},startedAt:now()});},complete(){this.detail.runs.at(-1).status='completed';this.detail.providerThreads[0].goal.status='complete';},failAccept(){fail=true;},failStop(value=true){stopFail=value;},close(){store.close();}};
}

test('a native goal continues multiple phases without another QP message or premature completion',async()=>{
  const f=fixture();try{await f.launch();f.phase();await f.engine.pollRuns();await f.engine.pollRuns();
    assert.equal(f.commands.filter(c=>c.type==='message.dispatch').length,1);assert.equal(f.engine.runs()[0].status,'running');assert.equal(f.store.get('projects','p').turns,2);
    f.complete();await f.engine.pollRuns();assert.equal(f.store.get('projects','p').state,'completed');
  }finally{f.close();}
});

for(const [name,mutate]of[
  ['weekly reserve',f=>f.a.weekly.usedPercent=99],['session reserve',f=>f.a.session.usedPercent=99],
  ['stale quota',f=>f.a.checkedAt=new Date(Date.now()-360000).toISOString()],['account pause',f=>f.engine.setPolicy('a',{paused:true})],
  ['global observation',f=>f.store.put('settings',{id:'global',mode:'observe',pollSeconds:60})],
  ['global pause',f=>f.store.put('settings',{id:'global',mode:'paused',pollSeconds:60})],
  ['unsafe T3 auto recovery',f=>f.t3.rawConfig.settings.autoResumeLimitedThreads=true],
  ['null quota',f=>f.a.weekly.usedPercent=null],
  ['expired reset',f=>f.a.session.resetsAt=new Date(Date.now()-1).toISOString()],
  ['invalid reset',f=>f.a.weekly.resetsAt='invalid'],
  ['future quota reading',f=>f.a.checkedAt=new Date(Date.now()+120000).toISOString()],
  ['invalid extra window',f=>f.a.extraWindows=[{usedPercent:-1,resetsAt:new Date(Date.now()+3600000).toISOString()}]],
  ['turn cap',f=>{f.store.put('projects',{...f.store.get('projects','p'),maxTurns:1});f.phase();}]
])test(`native work stops on ${name}`,async()=>{const f=fixture();try{await f.launch();mutate(f);await f.engine.pollRuns();assert.equal(f.commands.at(-1).type,'run.interrupt');assert.equal(f.engine.runs()[0].status,'interrupting');await f.engine.pollRuns();assert.equal(f.engine.runs()[0].status,'interrupted');}finally{f.close();}});

test('a paused or exhausted campaign stops its owned native goal',async()=>{
  for(const patch of [{status:'paused'},{consumedPoints:20}]){const f=fixture();try{const c=f.engine.saveCampaign({name:'C',mode:'immediate',accountIds:['a'],maxPoints:10});await f.engine.launch(f.p,f.a,c);f.store.put('campaigns',{...c,...patch});await f.engine.pollRuns();assert.equal(f.commands.at(-1).type,'run.interrupt');}finally{f.close();}}
});

test('Codex resumes an existing paused goal; Claude uses a follow-up without inventing a resume objective',async()=>{
  for(const driver of ['codex','claudeAgent']){const f=fixture(driver);try{await f.launch();await f.engine.projectAction('p','pause');await f.engine.pollRuns();await f.engine.projectAction('p','resume');await f.launch();
    assert.equal(f.commands.filter(c=>c.type==='thread.create').length,1);assert.equal(f.commands.filter(c=>c.type==='message.dispatch').at(-1).text,driver==='codex'?'/goal resume':'Continue.');
  }finally{f.close();}}
});

test('native goals send only the verbatim objective, ignore retired guidance and resume T3-trimmed goals',async()=>{
  for(const driver of ['codex','claudeAgent']){const f=fixture(driver);try{
    const goal='  Fix the parser.\n\nPreserve Unicode: é and spaces.  ';
    const parsed=projectSchema.parse({...f.p,goal,continuation:'Old hidden guidance.',enabled:false,repeat:false,priority:100});
    assert.equal(parsed.goal,goal);for(const retired of ['continuation','enabled','repeat','priority'])assert.equal(retired in parsed,false);
    assert.throws(()=>projectSchema.parse({...f.p,goal:' \n '}));
    f.store.put('projects',{...f.p,goal,continuation:'Old hidden guidance.'});await f.launch();
    assert.equal(f.commands.find(c=>c.type==='message.dispatch').text,`/goal ${goal}`);
    f.detail.providerThreads[0].goal.objective=goal.trim();
    await f.engine.pollRuns();assert.equal(f.engine.runs()[0].status,'running');
    await f.engine.projectAction('p','pause');await f.engine.pollRuns();
    await f.engine.projectAction('p','resume');await f.launch();
    assert.equal(f.commands.filter(c=>c.type==='message.dispatch').at(-1).text,driver==='codex'?'/goal resume':'Continue.');
  }finally{f.close();}}
});

test('an owned goal created with old appended text is replaced with the clean objective on its next launch',async()=>{
  const f=fixture();try{
    await f.launch();await f.engine.projectAction('p','pause');await f.engine.pollRuns();
    const p=f.store.get('projects','p'),oldObjective=p.goal+'\n\nOld continuation and appended guidance.';
    f.detail.providerThreads[0].goal.objective=oldObjective;
    f.store.put('projects',{...p,nativeObjectives:{i:oldObjective}});
    await f.engine.projectAction('p','resume');await f.launch();
    assert.equal(f.commands.filter(c=>c.type==='thread.create').length,1);
    assert.equal(f.commands.filter(c=>c.type==='message.dispatch').at(-1).text,`/goal ${p.goal}`);
    assert.equal(f.detail.providerThreads[0].goal.objective,p.goal);
  }finally{f.close();}
});

test('human input hands control back without stopping the human; system wake messages do not',async()=>{
  const f=fixture();try{await f.launch();const run=f.engine.runs()[0];f.detail.messages.push({id:'system-wake',role:'user',createdBy:'system',createdAt:new Date(Date.now()+10).toISOString()});await f.engine.pollRuns();assert.equal(f.engine.runs()[0].status,'running');
    f.detail.messages.push({id:'human',role:'user',createdBy:'user',createdAt:new Date(Date.now()+20).toISOString()});await f.engine.pollRuns();assert.equal(f.engine.runs()[0].status,'handed-off');assert.equal(f.commands.filter(c=>c.type==='run.interrupt').length,0);
  }finally{f.close();}
});

test('an accepted native submission is reconciled after restart without duplicate dispatch',async()=>{
  const f=fixture();try{f.failAccept();await assert.rejects(f.launch(),/Lost response/);assert.equal(f.engine.runs()[0].status,'unknown');const recovered=new Engine(f.store,f.t3);await recovered.pollRuns();assert.equal(recovered.runs()[0].status,'running');assert.equal(f.commands.filter(c=>c.type==='message.dispatch').length,1);}finally{f.close();}
});

test('a failed native Stop remains durable and retries the same command ID',async()=>{
  const f=fixture();try{await f.launch();f.a.weekly.usedPercent=99;f.failStop();await assert.rejects(f.engine.pollRuns(),/acknowledgement/);const id=f.engine.runs()[0].stopCommandId;f.failStop(false);await f.engine.pollRuns();assert.equal(f.commands.at(-1).commandId,id);}finally{f.close();}
});

test('single turns use a separate conversation and never activate or resume native goals',async()=>{
  const f=fixture('claudeAgent');try{await f.launch();await f.engine.projectAction('p','pause');await f.engine.pollRuns();const bound=f.store.get('projects','p').bindings.i;await f.engine.projectAction('p','resume');const r=await f.launch({single:true});assert.notEqual(r.threadId,bound);assert.equal(r.native,false);assert.equal(r.command.text,f.p.goal);assert.equal(f.store.get('projects','p').bindings.i,bound);}finally{f.close();}
});

test('a provider losing native goal capability cannot silently start a fake looping prompt',async()=>{
  const f=fixture();try{f.a.instances[0].nativeGoals=false;await assert.rejects(f.launch(),/does not advertise/);assert.equal(f.commands.length,0);}finally{f.close();}
});

test('T3 restart interruptions are eligible for later quota-controlled resume, not blind replay',async()=>{
  const f=fixture();try{await f.launch();f.detail.runs[0].status='interrupted';await f.engine.pollRuns();assert.equal(f.store.get('projects','p').state,'ready');assert.equal(f.engine.runs()[0].status,'interrupted');assert.equal(f.commands.filter(c=>c.type==='message.dispatch').length,1);}finally{f.close();}
});

test('three identical completed native phases block repeated work; child turns are not counted',async()=>{
  const f=fixture();try{
    await f.launch();
    for(let n=0;n<3;n++){
      const turn=f.detail.providerTurns.at(-1);turn.status='completed';
      f.detail.messages.push({id:'assistant'+n,role:'assistant',runId:f.detail.runs[0].id,text:'Same result',createdAt:new Date().toISOString()});
      (f.detail.turnItems||=[]).push({id:'item'+n,providerTurnId:turn.id,messageId:'assistant'+n});
      f.phase();
    }
    f.detail.providerTurns.push({id:'child-turn',nodeId:'child-node',status:'completed',nativeTurnRef:{nativeId:'child'},startedAt:new Date().toISOString()});
    await f.engine.pollRuns();
    assert.equal(f.commands.at(-1).type,'run.interrupt');
    assert.equal(f.store.get('projects','p').state,'blocked');
    assert.equal(f.store.get('projects','p').turns,4);
  }finally{f.close();}
});

test('pausing an already completed goal preserves its completed state',async()=>{
  const f=fixture();try{await f.launch();f.complete();await f.engine.pollRuns();await f.engine.projectAction('p','pause');assert.equal(f.store.get('projects','p').state,'completed');}finally{f.close();}
});

test('old opt-outs migrate to Paused and Resume alone makes a native goal eligible',async()=>{
  for(const retired of [{enabled:false,repeat:true},{enabled:true,repeat:false}]){
    const f=fixture();try{
      f.store.put('projects',{...f.p,...retired,continuation:'Old instruction.'});
      const recovered=new Engine(f.store,f.t3);
      recovered.saveCampaign({name:'Now',mode:'immediate',accountIds:['a']});
      const migrated=f.store.get('projects','p');assert.equal(migrated.state,'paused');
      for(const key of ['enabled','repeat','continuation'])assert.equal(key in migrated,false);
      await recovered.tick();assert.equal(f.commands.length,0);
      await recovered.projectAction('p','resume');await recovered.tick();
      assert.equal(f.commands.filter(c=>c.type==='message.dispatch').length,1);
      assert.equal(f.commands.at(-1).text,`/goal ${f.p.goal}`);
    }finally{f.close();}
  }
});

test('editing a paused goal cannot reactivate it through retired flags',async()=>{
  const f=fixture();try{
    f.t3.shell.projects[0].workspaceRoot=process.cwd();
    await f.engine.projectAction('p','pause');
    const saved=await f.engine.saveProject({...f.p,goal:'Updated objective',enabled:true,repeat:false},'p');
    assert.equal(saved.state,'paused');assert.equal(saved.goal,'Updated objective');
    assert.equal('enabled' in saved,false);assert.equal('repeat' in saved,false);
    assert.equal(f.commands.length,0);
  }finally{f.close();}
});

test('saving multiple goals leaves them inactive and does not change the active goal',async()=>{
  const f=fixture();try{
    f.t3.shell.projects[0].workspaceRoot=process.cwd();
    for(const name of ['Saved A','Saved B']){
      const saved=await f.engine.saveProject({...f.p,name,priority:100});
      assert.equal(saved.state,'paused');assert.equal('priority' in saved,false);
    }
    assert.deepEqual(f.store.list('projects').filter(p=>p.state==='ready').map(p=>p.id),['p']);
    assert.equal(f.commands.length,0);
  }finally{f.close();}
});

test('activating another goal stops the previous native work before launching the selection',async()=>{
  const f=fixture();try{
    f.store.put('projects',{...f.p,id:'second',name:'Second',state:'paused'});
    f.engine.saveCampaign({name:'Now',mode:'immediate',accountIds:['a']});
    await f.engine.tick();assert.equal(f.engine.runs()[0].projectId,'p');
    await f.engine.projectAction('second','resume');
    assert.equal(f.commands.at(-1).type,'run.interrupt');
    assert.deepEqual(f.store.list('projects').filter(p=>p.state==='ready').map(p=>p.id),['second']);
    assert.equal(f.commands.filter(c=>c.type==='message.dispatch').length,1);
    await f.engine.tick();
    assert.equal(f.commands.filter(c=>c.type==='message.dispatch').length,2);
    assert.equal(f.engine.runs().find(r=>r.projectId==='p').status,'interrupted');
    assert.equal(f.engine.runs().find(r=>r.projectId==='second').status,'running');
    await Promise.all(['p','second'].map(id=>f.engine.serial(()=>f.engine.projectAction(id,'resume'))));
    assert.deepEqual(f.store.list('projects').filter(p=>p.state==='ready').map(p=>p.id),['second']);
  }finally{f.close();}
});

test('a failed Stop cannot activate a replacement goal alongside unsupervised old work',async()=>{
  const f=fixture();try{
    f.store.put('projects',{...f.p,id:'second',state:'paused'});
    await f.launch();f.failStop();
    await assert.rejects(f.engine.projectAction('second','resume'),/acknowledgement/);
    assert.equal(f.store.list('projects').filter(p=>p.state==='ready').length,0);
    assert.equal(f.engine.runs()[0].status,'interrupting');
    assert.equal(f.commands.filter(c=>c.type==='message.dispatch').length,1);
  }finally{f.close();}
});

test('migration removes old priorities and pauses ambiguous multiple active goals',()=>{
  const f=fixture();try{
    f.store.put('projects',{...f.p,id:'second',priority:100});
    new Engine(f.store,f.t3);
    assert.equal(f.store.list('projects').filter(p=>p.state==='ready').length,0);
    for(const p of f.store.list('projects'))assert.equal('priority' in p,false);
  }finally{f.close();}
});

test('goal limits default to unlimited and no longer accept a configurable retry delay',()=>{
  const f=fixture();try{
    const {maxMinutes,maxTurns,...input}=f.p;
    for(const value of [undefined,0]){
      const p=projectSchema.parse({...input,maxMinutes:value,maxTurns:value,cooldownSeconds:86400});
      assert.equal(p.maxMinutes,0);assert.equal(p.maxTurns,0);assert.equal('cooldownSeconds' in p,false);
    }
    assert.equal(projectSchema.parse({...input,maxMinutes:500}).maxMinutes,500);
    assert.throws(()=>projectSchema.parse({...input,maxMinutes:-1}));
  }finally{f.close();}
});

test('unlimited native duration permits long work but still stops at quota reserves',async()=>{
  const f=fixture();try{
    f.store.put('projects',{...f.p,maxMinutes:0,maxTurns:0});await f.launch();
    f.detail.providerTurns[0].startedAt=new Date(Date.now()-25*3600000).toISOString();
    await f.engine.pollRuns();assert.equal(f.engine.runs()[0].status,'running');
    assert.equal(f.commands.filter(c=>c.type==='run.interrupt').length,0);
    f.a.weekly.usedPercent=99;await f.engine.pollRuns();
    assert.equal(f.engine.runs()[0].status,'interrupting');
  }finally{f.close();}
});

test('an optional native time limit still interrupts and pauses the goal',async()=>{
  const f=fixture();try{
    f.store.put('projects',{...f.p,maxMinutes:1});await f.launch();
    f.detail.providerTurns[0].startedAt=new Date(Date.now()-120000).toISOString();
    await f.engine.pollRuns();assert.equal(f.engine.runs()[0].status,'interrupting');
    assert.equal(f.store.get('projects','p').state,'paused');
    assert.equal(f.engine.runs()[0].stopReason,'Maximum native turn duration reached.');
  }finally{f.close();}
});

test('native retry backoff is internal and retired settings cannot delay quota recovery',async()=>{
  const f=fixture();try{
    await f.launch();f.store.put('projects',{...f.store.get('projects','p'),cooldownSeconds:86400});
    f.complete();const before=Date.now();await f.engine.pollRuns();
    const next=Date.parse(f.store.get('projects','p').nextEligibleAt);
    assert.ok(next>=before+RUN_RETRY_DELAY_MS&&next<=Date.now()+RUN_RETRY_DELAY_MS);
  }finally{f.close();}
});

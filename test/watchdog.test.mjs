import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/store.mjs';
import {guardNeeded,enforceGuard} from '../server/watchdog.mjs';

test('watchdog reacts to a dead/stalled scheduler or unobserved native work, but ignores legacy/manual work',()=>{
  const now=Date.now(),fresh=new Date(now).toISOString(),old=new Date(now-60000).toISOString();
  const run={wireProtocol:2,status:'running',startedAt:old,lastObservedAt:fresh};
  assert.equal(guardNeeded({schedulerAt:fresh},[run],now),false);
  assert.equal(guardNeeded(null,[run],now),true);
  assert.equal(guardNeeded({schedulerAt:old},[run],now),true);
  assert.equal(guardNeeded({schedulerAt:fresh},[{...run,lastObservedAt:old}],now),true);
  assert.equal(guardNeeded(null,[{...run,wireProtocol:1}],now),false);
  assert.equal(guardNeeded(null,[{...run,status:'completed'}],now),false);
});

test('watchdog stops only verified owned runs and persists a pause independently of the main process',async()=>{
  const store=new Store(':memory:');try{
    const startedAt=new Date().toISOString(),run={id:'qp',wireProtocol:2,status:'running',instanceId:'i',threadId:'t',projectId:'p',messageId:'mine',startedAt};
    store.put('runs',run);store.put('projects',{id:'p',state:'ready'});store.put('settings',{id:'global',mode:'active',pollSeconds:60});
    let stopped=false;const calls=[];
    const t3={accounts:[{driver:'codex',instances:[{id:'i'}]}],async readThread(){return {id:'t',activeRunId:stopped?null:'owned',latestRunId:'owned',latestTurn:{state:stopped?'interrupted':'running'},session:{status:stopped?'ready':'running'},goal:{status:stopped?'paused':'active'},messages:[{id:'mine',role:'user',createdAt:startedAt}],runs:[{id:'owned',ordinal:1,status:stopped?'interrupted':'running',userMessageId:'mine'}]};},async interrupt(...args){calls.push(args);stopped=true;}};
    await enforceGuard(store,t3);assert.equal(calls.length,1);assert.equal(calls[0][1],'owned');assert.equal(store.settings().mode,'paused');assert.equal(store.get('projects','p').state,'paused');
    await enforceGuard(store,t3);assert.equal(calls.length,1);assert.equal(store.get('runs','qp').status,'interrupted');
  }finally{store.close();}
});

test('watchdog never interrupts a conversation taken over by the user',async()=>{
  const store=new Store(':memory:');try{const startedAt=new Date().toISOString();store.put('projects',{id:'p',state:'ready'});store.put('runs',{id:'r',wireProtocol:2,status:'running',projectId:'p',threadId:'t',messageId:'mine',startedAt});
    const t3={async readThread(){return {messages:[{id:'human',role:'user',createdBy:'user',createdAt:startedAt}]};},async interrupt(){assert.fail('Human conversation interrupted');}};
    await enforceGuard(store,t3);assert.equal(store.get('runs','r').status,'handed-off');assert.equal(store.get('projects','p').state,'paused');
  }finally{store.close();}
});

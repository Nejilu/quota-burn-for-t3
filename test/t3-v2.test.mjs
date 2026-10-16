import test from 'node:test';
import assert from 'node:assert/strict';
import {T3Adapter} from '../server/t3.mjs';
import {negotiateT3,normalizeV2Projection,normalizeV2ShellThread} from '../server/t3-compat.mjs';
import {isBusy} from '../server/planner.mjs';

test('T3 compatibility follows the wire protocol across future release numbers',()=>{
  for(const version of ['0.1.0','0.1.99','0.2.0','1.5.7','2.0.0-nightly.20400101.99'])assert.equal(negotiateT3({serverVersion:version,orchestrationProtocolVersion:2}).nativeGoals,true);
  assert.equal(negotiateT3({serverVersion:'0.0.88',orchestrationProtocolVersion:1}).nativeGoals,false);
  assert.throws(()=>negotiateT3({serverVersion:'9.0.0',orchestrationProtocolVersion:3}),/protocol 3/);
});

function catalog(){return {providers:[{instanceId:'c',driver:'claudeAgent',enabled:true,installed:true,version:'99.0.0',auth:{status:'authenticated'},models:[],slashCommands:[{name:'goal'}]}],settings:{providerInstances:{c:{config:{homePath:'C:/quota-burn-test-missing'}}}}};}
test('connection accepts later T3/provider versions and renegotiates after an upgrade',async()=>{
  const a=new T3Adapter();let version='0.1.0';const commands=[];
  a.http=async path=>path.includes('.well-known')?{serverVersion:version,orchestrationProtocolVersion:2}:{projects:[],threads:[],futureField:true};
  a.rpc=async(tag)=>{commands.push(tag);return catalog();};
  await a.connect(false);version='0.4.2';await a.connect(false);
  assert.equal(a.descriptor.serverVersion,'0.4.2');assert.equal(a.accounts[0].instances[0].nativeGoals,true);
  assert.deepEqual(commands,['server.getConfig','server.getConfig']);
});

test('new goal commands use V2 transport and retain caller command/message IDs',async()=>{
  const a=new T3Adapter();a.compatibility={protocol:2};const calls=[];a.rpc=async(tag,payload)=>calls.push({tag,payload});
  await a.dispatch({type:'thread.turn.start',commandId:'cmd',threadId:'thread',message:{messageId:'message',text:'/goal objective'},modelSelection:{instanceId:'c',model:'m'}});
  assert.equal(calls[0].tag,'orchestration.dispatchCommand');assert.equal(calls[0].payload.type,'message.dispatch');
  assert.equal(calls[0].payload.messageId,'message');assert.equal(calls[0].payload.commandId,'cmd');
  assert.equal(calls[0].payload.createdBy,'user');assert.equal(calls[0].payload.creationSource,'web');
  await a.dispatch({type:'project.create',projectId:'p'});assert.equal(calls[1].tag,'projects.mutate');
});

test('restart protection preserves unrelated project/global settings and does not repeat writes',async()=>{
  const a=new T3Adapter();a.compatibility={protocol:2};let writes=0;
  const settings={autoResumeLimitedThreads:false,continueThreadsAfterServerUpdate:true,projectSettingsOverrides:{p:{defaultRuntimeMode:'approval-required'},other:{continueThreadsAfterServerUpdate:true}}};
  a.rpc=async(tag,payload)=>{if(tag==='server.getConfig')return {settings};writes++;Object.assign(settings.projectSettingsOverrides,payload.patch.projectSettingsOverrides);};
  await a.protectProject('p');await a.protectProject('p');
  assert.equal(writes,1);assert.equal(settings.continueThreadsAfterServerUpdate,true);
  assert.deepEqual(settings.projectSettingsOverrides.p,{defaultRuntimeMode:'approval-required',continueThreadsAfterServerUpdate:false});
  assert.deepEqual(settings.projectSettingsOverrides.other,{continueThreadsAfterServerUpdate:true});
  settings.autoResumeLimitedThreads=true;await assert.rejects(a.protectProject('p'),/automatic usage-limit recovery/);
});

test('V2 projection uses app runs for ownership and native provider state for completion',()=>{
  const t=normalizeV2Projection({thread:{id:'t',modelSelection:{instanceId:'c'},activeProviderThreadId:'pt'},runs:[{id:'r',ordinal:1,status:'running',rootNodeId:'root'}],messages:[{id:'m',runId:'r',role:'user'}],providerThreads:[{id:'pt',goal:{objective:'x',status:'active'}}],providerTurns:[{id:'phase2',nodeId:'root',status:'completed'}],runtimeRequests:[{kind:'user_input',status:'pending'}]});
  assert.equal(t.messages[0].turnId,'r');assert.equal(t.goal.status,'active');assert.ok(isBusy(t));assert.equal(t.hasPendingUserInput,true);
  assert.throws(()=>normalizeV2Projection({thread:{id:'t'},runs:[]}),/incompatible/);
});

test('unknown future runtime states are treated as busy, never as completed',()=>{
  assert.ok(isBusy(normalizeV2ShellThread({id:'t',modelSelection:{instanceId:'c'},status:'future-background-state'})));
});

test('native Stop targets the live app run, holds its queue and reuses a durable stop ID',async()=>{
  const a=new T3Adapter();a.compatibility={protocol:2};const calls=[];
  a.readThread=async()=>({activeRunId:'newest',latestRunId:'old'});a.dispatch=async c=>calls.push(c);
  await assert.rejects(a.interrupt('t','stale-provider-turn'),/ownership changed/);
  await a.interrupt('t','newest',{commandId:'durable'});
  assert.deepEqual(calls,[{type:'run.interrupt',commandId:'durable',threadId:'t',runId:'newest',holdQueue:true,reason:'Quota Burn stop'}]);
});

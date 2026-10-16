import test from 'node:test';
import assert from 'node:assert/strict';
import {T3Adapter} from '../server/t3.mjs';
import {Store} from '../server/store.mjs';
import {Engine} from '../server/engine.mjs';
import {plan} from '../server/planner.mjs';
import {defaultPolicy} from '../server/schema.mjs';
import {claudeCreditsView,withClaude} from '../server/claude.mjs';

const now=Date.now(),iso=ms=>new Date(ms).toISOString();
const windows=[{id:'seven_day_fable',kind:'weekly',label:'Weekly · Fable',usedPercent:20,resetsAt:iso(now+86400000)},
  {id:'seven_day',kind:'weekly',label:'Weekly',usedPercent:30,resetsAt:iso(now+7*86400000)},
  {id:'five_hour',kind:'session',label:'Session',usedPercent:10,resetsAt:iso(now+5*3600000)}];
function source(id,driver,profile='shared'){return{instanceId:id,driver,enabled:true,installed:true,displayName:id,auth:{status:'authenticated',profileId:profile},version:'2.1.301',usageLimits:{checkedAt:iso(now),windows},models:[{slug:'model',name:'Model',capabilities:{optionDescriptors:[]}}]};}
function config(providers){return{providers,settings:{providerInstances:Object.fromEntries(providers.map(p=>[p.instanceId,{config:{homePath:`C:/quota-burn-test-missing/${p.instanceId}`}}]))}};}
test('same identity never pools Codex and Claude, while Claude instances share a budget',async()=>{
  const t=new T3Adapter();t.accounts=await t.normalize(config([source('codex','codex'),source('claude-a','claudeAgent'),source('claude-b','claudeAgent')]));
  assert.equal(t.accounts.length,2);assert.equal(t.accounts[1].instances.length,2);
  assert.equal(t.accounts[1].weekly.id,'seven_day');assert.equal(t.accounts[1].extraWindows[0].id,'seven_day_fable');
  const output=JSON.stringify(t.publicAccounts());for(const field of ['accountConfigPath','resetAllowed','binary','home'])assert.ok(!output.includes('"'+field+'"'));
});
test('provider defaults apply only to unsaved policies',()=>{
  const store=new Store(':memory:');try{const engine=new Engine(store,{accounts:[{id:'c',driver:'codex'},{id:'a',driver:'claudeAgent'}]});
    assert.equal(engine.policy('c').windowWeeklyPoints,16);assert.equal(engine.policy('a').windowWeeklyPoints,13);
    store.put('policies',{id:'a',windowWeeklyPoints:9});assert.equal(engine.policy('a').windowWeeklyPoints,9);
  }finally{store.close();}
});
test('Claude API accounts stay visible but cannot schedule or offer resets',async()=>{
  const t=new T3Adapter(),p=source('api','claudeAgent');p.usageLimits={checkedAt:iso(now),windows:[],unavailable:{reason:'unsupported'}};
  const [a]=await t.normalize(config([p]));assert.equal(a.capabilities.resetCredits,false);assert.equal(plan(a,defaultPolicy()).shouldRun,false);
});
test('an additional Claude weekly reserve blocks an immediate campaign',()=>{
  const a={id:'a',authStatus:'authenticated',checkedAt:iso(now),session:windows[2],weekly:windows[1],extraWindows:[{...windows[0],usedPercent:99}]};
  const decision=plan(a,defaultPolicy(),{enabled:true,status:'ready',startsAt:iso(now-1000),weeklyReserve:10,sessionReserve:5,maxPoints:100},now);
  assert.equal(decision.shouldRun,false);assert.match(decision.reason,/Fable.*reserve/);
});
test('expired or missing scoped reset timestamps never permit a new turn',()=>{
  const a={id:'a',authStatus:'authenticated',checkedAt:iso(now),session:windows[2],weekly:windows[1],extraWindows:[{...windows[0],resetsAt:null}]};
  assert.equal(plan(a,defaultPolicy(),null,now).code,'stale');
});
test('Claude grants reject paused, unusable, malformed and expired entries',()=>{
  const good={id:'grant',resets_left:2,usable_now:true,ends_at:iso(now+3600000)};
  const view=claudeCreditsView({cedar_ember:{eligible:true,next_grant_id:'grant',grants:[good,{...good,id:'paused',paused:true},{...good,id:'old',ends_at:iso(now-1)},{...good,id:'blocked',usable_now:false},{...good,id:'bad',ends_at:'2099-02-30T00:00:00Z'}]}},now);
  assert.equal(view.availableCount,2);assert.equal(view.credits.length,1);assert.equal(view.credits[0].id,'grant');
  assert.deepEqual(claudeCreditsView({}),{availableCount:null,credits:null});
});
function bridgeFixture(){const calls=[];const instance={home:'fake',accountConfigPath:'account',version:'2.1.301',resetAllowed:true};
  const read=async p=>JSON.stringify(p==='account'?{oauthAccount:{organizationUuid:'org'}}:{claudeAiOauth:{accessToken:'private-test-token'}});
  const request=async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>({result:'reset'})};};
  return{calls,instance,read,request};}
test('Claude credit bridge uses the persisted request key and the selected grant',async()=>{
  const f=bridgeFixture();for(let i=0;i<2;i++)await withClaude(f.instance,c=>c.consume('grant','same-request'),f);
  assert.equal(f.calls.length,2);assert.equal(f.calls[0].url,'https://api.anthropic.com/api/organizations/org/reset_rate_limits');
  assert.deepEqual(JSON.parse(f.calls[0].options.body),{program:'cedar_ember',grant_id:'grant',request_id:'same-request'});
  assert.equal(f.calls[0].options.body,f.calls[1].options.body);
});
test('Claude credit reads never POST or redeem a grant',async()=>{
  const f=bridgeFixture();f.request=async(url,options)=>{f.calls.push({url,options});return{ok:true,json:async()=>({cedar_ember:{eligible:false}})};};
  const result=await withClaude(f.instance,c=>c.read(),f);assert.equal(result.availableCount,0);assert.equal(f.calls[0].options.method,'GET');
});
test('Claude rejects invalid reset identifiers before contacting the server',async()=>{
  const f=bridgeFixture();await assert.rejects(()=>withClaude(f.instance,c=>c.consume('../other','bad request'),f),/Invalid/);assert.equal(f.calls.length,0);
});
test('a failed Claude credit request never exposes credentials in the error',async()=>{
  const f=bridgeFixture();f.request=async()=>{throw Error('private-test-token');};
  await assert.rejects(()=>withClaude(f.instance,c=>c.read(),f),e=>!e.message.includes('private-test-token')&&/disconnected/.test(e.message));
});
test('Claude reset retry uses the Claude adapter, with the same durable intent',async()=>{
  const store=new Store(':memory:');let calls=0;const keys=[];
  const a={id:'a',driver:'claudeAgent',instances:[{id:'claude',resetAllowed:true}]};
  const engine=new Engine(store,{accounts:[a]},{codex:()=>{throw Error('Wrong provider adapter');},claude:async(_,fn)=>fn({read:async()=>({availableCount:1,credits:[{id:'grant',status:'available'}]}),consume:async(id,key)=>{keys.push(key);if(calls++===0)throw Error('Lost response');return{outcome:'alreadyRedeemed'};}})});
  engine.refresh=async()=>{};store.put('settings',{id:'global',mode:'active',pollSeconds:60});
  try{await assert.rejects(()=>engine.consumeCredit('a','grant'));const intent=store.list('resets')[0];await engine.consumeCredit('a','grant',{intentId:intent.id});assert.equal(keys[0],keys[1]);assert.equal(store.list('resets').length,1);assert.equal(store.get('resets',intent.id).status,'completed');}finally{store.close();}
});

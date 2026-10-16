import test from 'node:test';
import assert from 'node:assert/strict';
import {plan,capacity,selectCampaign,userIntervened,progressResult} from '../server/planner.mjs';
import {defaultPolicy,campaignSchema} from '../server/schema.mjs';
const now=Date.parse('2026-10-16T10:00:00Z'),hour=3600000;
const iso=t=>new Date(t).toISOString();
const account=(hours=30,sessionUsed=0,weeklyUsed=0)=>({id:'a',authStatus:'authenticated',checkedAt:iso(now),session:{usedPercent:sessionUsed,resetsAt:iso(now+5*hour),windowDurationMins:300},weekly:{usedPercent:weeklyUsed,resetsAt:iso(now+hours*hour),windowDurationMins:10080}});
const policy={...defaultPolicy(),sessionReserve:0,weeklyReserve:0,anticipationMinutes:0};
const campaign=(extra={})=>({id:'c',name:'Sprint',mode:'immediate',enabled:true,status:'ready',accountIds:['a'],projectIds:[],startsAt:iso(now-hour),endsAt:null,weeklyReserve:10,sessionReserve:2,maxPoints:100,priority:70,...extra});

test('a reset exactly at the weekly deadline adds no capacity',()=>{const a=account(30);assert.equal(capacity(a,policy,now,now+30*hour),96);const d=plan(a,policy,null,now);assert.equal(d.shouldRun,true);assert.equal(d.unusable,4);});
test('the partial final window is bounded by actual consumption time',()=>{const a=account(30.1);assert.ok(Math.abs(capacity(a,policy,now,now+30.1*hour)-97.6)<.001);assert.equal(plan(a,policy,null,now).shouldRun,true);});
test('a partially used current window cannot be counted as a full one',()=>{const a=account(30,50);assert.equal(capacity(a,policy,now,now+30*hour),88);});
test('a long horizon waits and supplies an estimated start time',()=>{const d=plan(account(150),policy,null,now);assert.equal(d.shouldRun,false);assert.ok(Date.parse(d.latestStart)>now+100*hour);});
test('pause wins over an immediate campaign',()=>assert.equal(plan(account(),{...policy,paused:true},campaign(),now).code,'paused'));
test('freshness and reset timestamps are mandatory',()=>{assert.equal(plan({...account(),checkedAt:iso(now-181000)},policy,campaign(),now).code,'stale');assert.equal(plan({...account(),session:{...account().session,resetsAt:iso(now)}},policy,null,now).code,'stale');});

test('invalid quota values never become available capacity through coercion',()=>{
  for(const field of ['session','weekly'])for(const usedPercent of [null,undefined,'0',NaN,-1,101]){
    const a=account();a[field].usedPercent=usedPercent;
    assert.equal(plan(a,policy,campaign(),now).code,'unknown');
  }
  const a=account();a.session.windowDurationMins=-300;
  assert.equal(plan(a,policy,campaign(),now).code,'unknown');
});
test('a failed provider read cannot launch using cached bars',()=>assert.equal(plan({...account(),unavailable:'probeFailed'},policy,campaign(),now).code,'unknown'));
test('both weekly and session reserves stop starts',()=>{assert.equal(plan(account(150,0,90),policy,campaign(),now).code,'reserve');assert.equal(plan(account(150,99,0),policy,campaign(),now).code,'session');});
test('scheduled campaigns respect dates, caps and explicit terminal state',()=>{assert.equal(plan(account(),policy,campaign({mode:'scheduled',startsAt:iso(now+hour)}),now).code,'scheduled');assert.equal(plan(account(),policy,campaign({mode:'scheduled',endsAt:iso(now)}),now).code,'ended');assert.equal(plan(account(),policy,campaign({consumedPoints:100}),now).code,'budget');assert.equal(plan(account(),policy,campaign({status:'completed'}),now).code,'campaign-paused');});
test('campaign selection is per account and priority',()=>{assert.equal(selectCampaign([campaign({id:'low',priority:1}),campaign({id:'high',priority:90}),campaign({id:'other',priority:100,accountIds:['b']})],'a',now).id,'high');});
test('human input and repeated output are distinct from successful completion',()=>{const r={startedAt:iso(now),messageId:'ours',baselineUserIds:['old']};assert.equal(userIntervened({messages:[{id:'ours',role:'user',createdAt:iso(now)}]},r),false);assert.equal(userIntervened({messages:[{id:'human',role:'user',createdAt:iso(now+1000)}]},r),true);assert.equal(progressResult('terminé [QP_COMPLETE]'),'complete');assert.equal(progressResult('besoin d’aide [QP_BLOCKED]'),'blocked');assert.equal(progressResult('même résultat',['même résultat','même résultat']),'repeated');});
test('campaign validation requires a coherent time interval and explicit reset date',()=>{const raw=campaign({mode:'scheduled'});assert.equal(campaignSchema.parse(raw).endsAt,null);assert.throws(()=>campaignSchema.parse({...raw,mode:'pre-reset'}));assert.throws(()=>campaignSchema.parse({...raw,endsAt:iso(now-2*hour)}));assert.throws(()=>campaignSchema.parse({...raw,endsAt:iso(now+hour),resetRule:{mode:'scheduled'}}));});

test('blank or omitted campaign caps are unlimited, while numeric caps remain enforced',()=>{for(const maxPoints of [undefined,null,'']){const parsed=campaignSchema.parse(campaign({maxPoints}));assert.equal(parsed.maxPoints,null);const decision=plan(account(),policy,{...parsed,consumedPoints:250},now);assert.equal(decision.shouldRun,true);assert.equal(decision.budget,90);}assert.equal(campaignSchema.parse(campaign({maxPoints:20})).maxPoints,20);assert.throws(()=>campaignSchema.parse(campaign({maxPoints:0})));});
test('immediate campaigns discard old dates and optional dates default sensibly',()=>{const before=Date.now(),parsed=campaignSchema.parse(campaign({startsAt:'2099-01-01T00:00:00Z',endsAt:'2099-01-02T00:00:00Z',maxPoints:null}));assert.ok(Date.parse(parsed.startsAt)>=before);assert.equal(parsed.endsAt,null);const scheduled=campaignSchema.parse({name:'Open-ended',mode:'scheduled',accountIds:['a'],startsAt:'',endsAt:''});assert.equal(scheduled.endsAt,null);assert.equal(scheduled.resetRule.mode,'never');assert.ok(Number.isFinite(Date.parse(scheduled.startsAt)));});
test('legacy immediate campaign dates never schedule or expire a threshold campaign',()=>{const legacy=campaign({startsAt:iso(now+hour),endsAt:iso(now-hour),maxPoints:null,consumedPoints:200});assert.equal(selectCampaign([legacy],'a',now).id,'c');assert.equal(plan(account(),policy,legacy,now).shouldRun,true);});

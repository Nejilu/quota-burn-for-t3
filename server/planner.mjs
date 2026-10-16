import {extraQuotaBlock} from './providers.mjs';
// Immediate campaigns never inherit a scheduled period, including older records.
export const campaignEnd=c=>c?.mode==='immediate'?null:c?.endsAt;
export const campaignStarted=(c,now=Date.now())=>c.mode==='immediate'||Date.parse(c.startsAt)<=now;
const MINUTE=60000;
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
export const quotaWindowsValid=account=>[account?.session,account?.weekly].every(w=>w&&Number.isFinite(w.usedPercent)&&w.usedPercent>=0&&w.usedPercent<=100&&(w.windowDurationMins==null||Number.isFinite(w.windowDurationMins)&&w.windowDurationMins>0));

export function capacity(account,policy,start,deadline,{skipCurrent=false}={}) {
  const reset=Date.parse(account.session?.resetsAt),duration=(account.session?.windowDurationMins||300)*MINUTE;
  if(!Number.isFinite(reset)||!Number.isFinite(deadline)||deadline<=start)return 0;
  const points=policy.windowWeeklyPoints,rate=points/(policy.fillMinutes*MINUTE);
  let sum=0;
  if(!skipCurrent&&start<reset){const available=points*clamp((100-account.session.usedPercent-policy.sessionReserve)/100,0,1);sum+=Math.min(available,rate*Math.max(0,Math.min(reset,deadline)-start));}
  for(let edge=reset,i=0;edge<deadline&&i<1000;edge+=duration,i++) {
    const begin=Math.max(start,edge),end=Math.min(deadline,edge+duration);
    if(end>begin)sum+=Math.min(points*(1-policy.sessionReserve/100),rate*(end-begin));
  }
  return sum;
}

export function plan(account,policy,campaign=null,now=Date.now()) {
  const stop=(code,reason,extra={})=>({accountId:account.id,code,reason,shouldRun:false,...extra});
  if(policy.paused)return stop('paused','Account manually paused.');
  if(!policy.enabled&&!campaign)return stop('disabled','Automatic scheduling is disabled for this account.');
  if(account.authStatus!=='authenticated')return stop('auth','Reconnect this account in T3.');
  if(account.unavailable)return stop('unknown','T3 could not confirm the quotas for this account.');
  if(!account.session||!account.weekly)return stop('unknown','Both quota windows are required.');
  if(!quotaWindowsValid(account))return stop('unknown','Quota values are invalid; refresh required.');
  const checked=Date.parse(account.checkedAt),weeklyReset=Date.parse(account.weekly.resetsAt),sessionReset=Date.parse(account.session.resetsAt);
  if(!Number.isFinite(checked)||now-checked>180000||checked>now+60000||!Number.isFinite(weeklyReset)||!Number.isFinite(sessionReset)||sessionReset<=now||weeklyReset<=now)return stop('stale','Quota reading is stale; refresh required.');
  if(campaign){
    if(campaign.status==='completed'||campaign.status==='paused'||!campaign.enabled)return stop('campaign-paused','Campaign stopped or paused.');
    if(!campaignStarted(campaign,now))return stop('scheduled','Campaign scheduled.',{nextAt:campaign.startsAt});
    if(campaignEnd(campaign)&&Date.parse(campaignEnd(campaign))<=now)return stop('ended','End date reached.');
    if(campaign.maxPoints!=null&&(campaign.consumedPoints||0)>=campaign.maxPoints)return stop('budget','Campaign cumulative cap reached.');
  }
  const effective={...policy,...(campaign?{weeklyReserve:campaign.weeklyReserve,sessionReserve:campaign.sessionReserve}:{})};
  const scoped=extraQuotaBlock(account,effective,now);if(scoped)return stop(scoped.code,scoped.reason);
  const remaining=100-account.weekly.usedPercent;
  const budget=Math.min(Math.max(0,remaining-effective.weeklyReserve),campaign?.maxPoints!=null?campaign.maxPoints-(campaign.consumedPoints||0):Infinity);
  const deadline=Math.min(weeklyReset,campaignEnd(campaign)?Date.parse(campaignEnd(campaign)):Infinity);
  if(budget<=0)return stop('reserve','Weekly reserve reached.',{remaining,budget:0,deadline:new Date(deadline).toISOString()});
  if(100-account.session.usedPercent<=effective.sessionReserve)return stop('session','Session reserve reached; waiting for the next reset.',{nextAt:account.session.resetsAt,budget});
  const total=capacity(account,effective,now,deadline),future=capacity(account,effective,now,deadline,{skipCurrent:true});
  let lo=now,hi=deadline;
  if(total>=budget)for(let i=0;i<40;i++){const mid=(lo+hi)/2;if(capacity(account,effective,mid,deadline)>=budget)lo=mid;else hi=mid;}
  const latest=total<budget?now:lo,trigger=latest-effective.anticipationMinutes*MINUTE;
  const shouldRun=!!campaign||now>=trigger;
  return {accountId:account.id,code:shouldRun?'run':'wait',shouldRun,reason:campaign?'Active campaign: use the available window.':shouldRun?'This window is needed to reach the target before the reset.':'Future windows still provide enough capacity to reach the target.',budget,remaining,deadline:new Date(deadline).toISOString(),latestStart:new Date(latest).toISOString(),nextAt:new Date(Math.max(now,trigger)).toISOString(),capacity:Math.round(total*10)/10,futureCapacity:Math.round(future*10)/10,unusable:Math.max(0,Math.round((budget-total)*10)/10),estimated:true};
}

export function selectCampaign(campaigns,accountId,now=Date.now()) {
  return campaigns.filter(c=>c.enabled&&c.status!=='completed'&&c.status!=='paused'&&c.accountIds.includes(accountId)&&campaignStarted(c,now)&&(!campaignEnd(c)||Date.parse(campaignEnd(c))>now)).sort((a,b)=>b.priority-a.priority||a.startsAt.localeCompare(b.startsAt))[0]||null;
}

export function isBusy(thread){return !!thread&&(thread.latestTurn?.state==='running'||['starting','running'].includes(thread.session?.status)||!!thread.session?.activeTurnId);}
export function userIntervened(thread,run){return (thread.messages||[]).some(m=>m.role==='user'&&(!m.createdBy||m.createdBy==='user')&&!m.notification&&!m.senderThreadId&&Date.parse(m.createdAt)>=Date.parse(run.startedAt)&&m.id!==run.messageId&&!(run.baselineUserIds||[]).includes(m.id));}
export function progressResult(text,previous=[],limit=3){const normalized=(text||'').replace(/\s+/g,' ').trim();if(/\[QP_BLOCKED\]/.test(normalized))return 'blocked';if(/\[QP_COMPLETE\]/.test(normalized))return 'complete';if(!normalized)return 'empty';if(previous.slice(-(limit-1)).filter(t=>t===normalized).length>=limit-1)return 'repeated';return 'continue';}

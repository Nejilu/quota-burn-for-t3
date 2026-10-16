import { z } from 'zod';
const percent=z.number().min(0).max(100);
const date=z.string().datetime({offset:true});
const ids=z.array(z.string().min(1).max(200)).max(50);
export const policySchema=z.object({enabled:z.boolean().default(true),paused:z.boolean().default(false),weeklyReserve:percent.default(10),sessionReserve:percent.default(5),windowWeeklyPoints:z.number().min(.1).max(100).default(16),fillMinutes:z.number().min(1).max(300).default(60),anticipationMinutes:z.number().min(0).max(1440).default(60)});
export const projectSchema=z.object({name:z.string().trim().min(1).max(100),t3ProjectId:z.string().min(1),goal:z.string().min(1).max(24000).refine(v=>v.trim().length>0,'Enter a goal.'),instanceIds:ids.min(1),model:z.string().min(1).max(120),options:z.array(z.object({id:z.string().min(1).max(100),value:z.union([z.string().max(120),z.boolean()])})).max(20).default([]),runtimeMode:z.enum(['approval-required','auto-accept-edits','auto','full-access']).default('approval-required'),maxTurns:z.number().int().min(0).max(100000).default(0),maxMinutes:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),existingThreadId:z.string().max(200).default('')});
export const resetRuleSchema=z.object({mode:z.enum(['never','scheduled','expiring']).default('never'),at:date.nullable().default(null),beforeExpiryHours:z.number().min(0).max(720).default(24),weeklyRemainingAtMost:percent.default(10),maxResets:z.number().int().min(0).max(20).default(1),keepCredits:z.number().int().min(0).max(20).default(0)});
// Blank controls have explicit semantics: no cumulative cap and no end date.
const optionalDate=z.preprocess(v=>v===''?null:v,date.nullish().transform(v=>v??null));
const optionalCap=z.preprocess(v=>v===''?null:v,z.number().min(.1).max(10000).nullish().transform(v=>v??null));
export const campaignSchema=z.object({
  name:z.string().trim().min(1).max(100),mode:z.enum(['immediate','scheduled','pre-reset']),
  accountIds:ids.min(1),projectIds:ids.default([]),startsAt:optionalDate,endsAt:optionalDate,
  weeklyReserve:percent.default(10),sessionReserve:percent.default(2),maxPoints:optionalCap,
  continueAfterReset:z.boolean().default(false),priority:z.number().int().min(0).max(100).default(70),
  enabled:z.boolean().default(true),resetRule:resetRuleSchema.default(()=>resetRuleSchema.parse({}))
}).transform(v=>({...v,startsAt:v.mode==='immediate'?new Date().toISOString():v.startsAt||new Date().toISOString(),endsAt:v.mode==='immediate'?null:v.endsAt}))
.superRefine((v,c)=>{
  if(v.mode==='pre-reset'&&!v.endsAt)c.addIssue({code:'custom',message:'Choose the planned reset deadline.',path:['endsAt']});
  if(v.endsAt&&Date.parse(v.endsAt)<=Date.parse(v.startsAt))c.addIssue({code:'custom',message:'The end must be after the start.',path:['endsAt']});
  if(v.resetRule.mode==='scheduled'&&!v.resetRule.at)c.addIssue({code:'custom',message:'Choose the reset date.',path:['resetRule','at']});
});
export const defaultPolicy = () => policySchema.parse({});
export const settingsSchema=z.object({mode:z.enum(['observe','active','paused']),pollSeconds:z.number().int().min(30).max(600).default(60)});

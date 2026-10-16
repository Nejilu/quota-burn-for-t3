import { spawn } from 'node:child_process';
import { CODEX_BINARY,ROOT } from './paths.mjs';

// No inference method is exposed by this adapter. Credentials remain Codex-owned.
export async function withCodex(instance,action){
  const child=spawn(instance.binary||CODEX_BINARY,['app-server','--listen','stdio://'],{cwd:ROOT,env:{...process.env,CODEX_HOME:instance.home},windowsHide:true,stdio:['pipe','pipe','ignore']});
  let buffer='',nextId=1;const pending=new Map();let failure=null;
  const fail=(message)=>{failure=new Error(message);for(const p of pending.values()){clearTimeout(p.timer);p.reject(failure);}pending.clear();};
  child.on('error',()=>fail('Could not start the Codex credit reader.'));
  child.on('exit',()=>fail('The Codex reader stopped.'));
  child.stdout.on('data',chunk=>{buffer+=chunk.toString();if(buffer.length>8e6){fail('Codex response too large.');child.kill();return;}let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);let m;try{m=JSON.parse(line);}catch{continue;}const p=pending.get(m.id);if(!p)continue;pending.delete(m.id);clearTimeout(p.timer);if(m.error)p.reject(new Error(`Codex rejected the operation (${m.error.code}).`));else p.resolve(m.result);}});
  const call=(method,params)=>new Promise((resolve,reject)=>{if(failure)return reject(failure);const id=nextId++;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Codex: read timed out.'));},30000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,...(params!==undefined?{params}:{})})+'\n',e=>{if(e)fail('Codex connection closed.');});});
  try{await call('initialize',{clientInfo:{name:'quota_burn',title:'Quota Burn',version:'0.2.0'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');return await action({read:()=>call('account/rateLimits/read'),consume:(creditId,idempotencyKey)=>call('account/rateLimitResetCredit/consume',{creditId,idempotencyKey})});}
  finally{child.stdin.end();const timer=setTimeout(()=>child.kill(),500);timer.unref();}
}

export function creditsView(response){const summary=response.rateLimitResetCredits;if(!summary)return{availableCount:null,credits:null};return{availableCount:summary.availableCount,credits:summary.credits?.map(c=>({id:c.id,status:c.status,expiresAt:c.expiresAt?new Date(c.expiresAt*1000).toISOString():null,title:c.title||'Reset credit'}))??null};}

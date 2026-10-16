import {open,readFile,unlink,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {Store} from './store.mjs';
import {T3Adapter} from './t3.mjs';
import {DATA} from './paths.mjs';
import {userIntervened,isBusy} from './planner.mjs';
import {stopNativeRun,ownedNativeRuns} from './native-engine.mjs';

const active=new Set(['prepared','running','waiting-approval','waiting-input','interrupting','unknown']);
export const dataKey=path=>createHash('sha256').update(resolve(path).toLowerCase()).digest('hex').slice(0,20);
export function guardNeeded(health,runs,now=Date.now()){
  if(!runs.some(r=>r.wireProtocol===2&&active.has(r.status)))return false;
  if(!health||now-Date.parse(health.schedulerAt||'')>45000||!Number.isFinite(Date.parse(health.schedulerAt||'')))return true;
  return runs.some(r=>r.wireProtocol===2&&active.has(r.status)&&now-Date.parse(r.lastObservedAt||r.startedAt)>45000);
}

export async function enforceGuard(store,t3){
  const engine={store,t3};
  for(const run of store.list('runs').filter(r=>r.wireProtocol===2&&active.has(r.status))){
    const thread=await t3.readThread(run.threadId);
    if(userIntervened(thread,run)){store.put('runs',{...run,status:'handed-off',endedAt:new Date().toISOString()});const p=store.get('projects',run.projectId);if(p)store.put('projects',{...p,state:'paused',reason:'Human intervention in T3.'});continue;}
    const owns=ownedNativeRuns(thread,run);
    if(!owns.size)continue;
    store.put('settings',{...store.settings(),mode:'paused'});
    const project=store.get('projects',run.projectId);
    if(project)store.put('projects',{...project,state:'paused',reason:'Quota Burn watchdog stopped unsupervised work.'});
    const driver=t3.accounts.find(a=>a.instances.some(i=>i.id===run.instanceId))?.driver;
    if(!isBusy(thread)&&(thread.goal?.status!=='active'||driver==='claudeAgent')){
      store.put('runs',{...run,status:'interrupted',endedAt:new Date().toISOString(),stopReason:'Quota Burn watchdog confirmed work stopped.'});continue;
    }
    await stopNativeRun.call(engine,run,'Quota Burn watchdog stopped unsupervised work.');
  }
}

async function main(){
  await mkdir(DATA,{recursive:true});const lock=join(DATA,'watchdog.lock'),nonce=randomUUID();let owned=false;
  try{const fd=await open(lock,'wx');await fd.writeFile(JSON.stringify({pid:process.pid,nonce}));await fd.close();owned=true;}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    const previous=JSON.parse(await readFile(lock,'utf8'));
    try{process.kill(previous.pid,0);return;}catch(e){if(e.code!=='ESRCH')throw e;}
    await unlink(lock);return main();
  }
  const store=new Store(join(DATA,'quota-pilot.sqlite')),t3=new T3Adapter();let stopped=false,missingSince=0;
  const stop=()=>{stopped=true;};process.on('SIGTERM',stop);process.on('SIGINT',stop);
  try{while(!stopped){
    const now=Date.now();store.put('watchdog',{id:'global',pid:process.pid,checkedAt:new Date(now).toISOString()});
    let health=null;try{health=await fetch(`http://127.0.0.1:${process.env.QP_PORT||4317}/healthz`,{signal:AbortSignal.timeout(3000)}).then(r=>r.json());if(health.service!=='quota-burn'||health.dataKey!==dataKey(DATA))health=null;}catch{}
    const runs=store.list('runs');
    if(guardNeeded(health,runs,now)){
      try{await t3.connect(false);await enforceGuard(store,t3);}
      catch{const record=store.get('watchdog','global');store.put('watchdog',{...record,error:'Stop pending: T3 is unreachable or ownership changed.'});}
    }
    if(health)missingSince=0;else missingSince ||= now;
    if(missingSince&&now-missingSince>60000&&!runs.some(r=>r.wireProtocol===2&&active.has(r.status)))break;
    await new Promise(r=>setTimeout(r,5000));
  }}finally{
    await t3.close();store.close();
    if(owned){try{const value=JSON.parse(await readFile(lock,'utf8'));if(value.nonce===nonce)await unlink(lock);}catch{}}
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{process.exitCode=1;});

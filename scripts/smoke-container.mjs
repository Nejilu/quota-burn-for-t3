// Disposable CI integration: real T3, remote credentials, no provider login/inference.
import { spawnSync } from 'node:child_process';
import { mkdtemp,writeFile,chmod,rm } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { randomUUID,randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { ROOT } from '../server/paths.mjs';

if(process.env.CI!=='true'||process.platform!=='linux')throw Error('Container smoke test requires a disposable Linux CI runner.');
const id='quota-burn-ci-'+randomUUID().slice(0,8),network=id+'-net',volume=id+'-data';
const names={t3:id+'-t3',app:id+'-app',guard:id+'-guard'},created=[];
const secrets=await mkdtemp(join(ROOT,'.runtime','container-'));
await chmod(secrets,0o777);
const password=randomBytes(32).toString('hex');await writeFile(join(secrets,'password'),password,{mode:0o644});
const auth='Basic '+Buffer.from('admin:'+password).toString('base64');
function docker(args,{failure=false}={}){const p=spawnSync('docker',args,{cwd:ROOT,encoding:'utf8',timeout:600000,maxBuffer:8e6});if(p.status!==0&&!failure)throw Error(`Docker ${args[0]} failed: ${p.stderr?.slice(-1500)||'inspect CI build output'}`);return p.stdout?.trim()||'';}
async function ready(url,headers={}){for(let i=0;i<90;i++){try{const r=await fetch(url,{headers,signal:AbortSignal.timeout(1500)});if(r.ok)return r;}catch{}await new Promise(r=>setTimeout(r,1000));}throw Error('Container service readiness timeout.');}
const mounts=['-v',`${secrets}:/credentials:ro`,'-v',`${volume}:/data`];
const environment=['-e','QP_T3_ORIGIN=http://'+names.t3+':3773','-e','QP_T3_TOKEN_FILE=/credentials/t3-session.json','-e','QP_ACCESS_PASSWORD_FILE=/credentials/password','-e','QP_PUBLIC_ORIGIN=http://burn.test','-e','QP_WATCHDOG_ORIGIN=http://'+names.app+':4317'];
let networkCreated=false,volumeCreated=false;
try{
  console.log('Building runtime and isolated T3 tools images.');
  docker(['build','--target','dependencies','-t',id+'-tools','.']);docker(['build','-t',id+'-runtime','.']);
  docker(['network','create',network]);networkCreated=true;docker(['volume','create',volume]);volumeCreated=true;
  docker(['run','-d','--name',names.t3,'--network',network,'--user','1000:1000','--tmpfs','/t3:uid=1000,gid=1000,mode=0700','--tmpfs','/workspace:uid=1000,gid=1000,mode=0700',
    '-v',`${secrets}:/credentials`,'-v',`${join(ROOT,'scripts')}:/app/scripts:ro`,'-v',`${join(ROOT,'server')}:/app/server:ro`,
    '-e','QP_T3_HOME=/t3','-e','CODEX_HOME=/t3/codex','-p','127.0.0.1::3773','--entrypoint','/app/node_modules/@t3code/t3-linux-x64/t3',id+'-tools',
    'serve','--mode','web','--host','0.0.0.0','--port','3773','--base-dir','/t3','/workspace']);created.push(names.t3);
  const t3port=JSON.parse(docker(['inspect',names.t3]))[0].NetworkSettings.Ports['3773/tcp'][0].HostPort;
  await ready(`http://127.0.0.1:${t3port}/.well-known/t3/environment`);
  docker(['exec',names.t3,'node','scripts/issue-t3-session.mjs','/credentials/t3-session.json','1h']);
  docker(['run','-d','--init','--name',names.app,'--network',network,...mounts,...environment,'-p','127.0.0.1::4317',id+'-runtime']);created.push(names.app);
  docker(['run','-d','--init','--name',names.guard,'--network',network,...mounts,...environment,id+'-runtime','node','server/watchdog.mjs']);created.push(names.guard);
  const port=JSON.parse(docker(['inspect',names.app]))[0].NetworkSettings.Ports['4317/tcp'][0].HostPort,origin=`http://127.0.0.1:${port}`;
  const headers={Host:'burn.test',Authorization:auth};await ready(origin+'/healthz');
  assert.equal((await fetch(origin+'/api/bootstrap',{headers:{Host:'burn.test'}})).status,401);
  const boot=await fetch(origin+'/api/bootstrap',{headers}),{csrf}=await boot.json();headers.Cookie=boot.headers.get('set-cookie').split(';')[0];
  const commandHeaders={...headers,Origin:'http://burn.test','Content-Type':'application/json','X-QP-CSRF':csrf};
  let state;
  for(let i=0;i<60;i++){state=await fetch(origin+'/api/state',{headers}).then(r=>r.json());if(state.connection.connected)break;await new Promise(r=>setTimeout(r,1000));}
  assert.equal(state.connection.connected,true);assert.equal(state.settings.mode,'observe');assert.equal(state.runs.length,0);assert.equal(state.resets.length,0);
  const folder=await fetch(origin+'/api/t3-projects',{method:'POST',headers:commandHeaders,body:JSON.stringify({title:'Container smoke',path:'/workspace'})});assert.equal(folder.status,200);
  const policy=await fetch(origin+'/api/settings',{method:'PUT',headers:commandHeaders,body:JSON.stringify({mode:'observe',pollSeconds:45})});assert.equal(policy.status,200);
  console.log('Remote T3 discovery, authentication, remote folder validation and Observation passed.');
  const heartbeat=()=>JSON.parse(docker(['exec',names.guard,'node','--input-type=module','-e',"import {Store} from './server/store.mjs';const s=new Store('/data/quota-pilot.sqlite');console.log(JSON.stringify(s.get('watchdog','global')));s.close();"]));
  let first;for(let i=0;i<10;i++){first=heartbeat();if(first)break;await new Promise(r=>setTimeout(r,1000));}assert.ok(first?.checkedAt);
  docker(['kill','--signal','KILL',names.app]);await new Promise(r=>setTimeout(r,6500));
  assert.ok(Date.parse(heartbeat().checkedAt)>Date.parse(first.checkedAt));
  docker(['start',names.app]);await ready(origin+'/healthz');
  const fresh=await fetch(origin+'/api/bootstrap',{headers:{Host:'burn.test',Authorization:auth}});headers.Cookie=fresh.headers.get('set-cookie').split(';')[0];
  state=await fetch(origin+'/api/state',{headers}).then(r=>r.json());assert.equal(state.settings.pollSeconds,45);assert.equal(state.runs.length,0);
  docker(['stop','--time','90',names.app]);assert.equal(JSON.parse(docker(['inspect',names.app]))[0].State.ExitCode,0);
  console.log('External watchdog survived worker loss; persistent settings and graceful restart/stop passed.');
}finally{
  for(const name of created.reverse())docker(['rm','-f',name],{failure:true});
  if(volumeCreated)docker(['volume','rm',volume],{failure:true});if(networkCreated)docker(['network','rm',network],{failure:true});
  await rm(resolve(secrets),{recursive:true,force:true});
}

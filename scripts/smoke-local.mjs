// CI-only disposable checkout: starts real T3 without a login or model request.
import { spawnSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT,T3_BINARY,CODEX_BINARY,CLAUDE_BINARY } from '../server/paths.mjs';

if(process.env.CI!=='true')throw Error('This smoke test requires a disposable CI checkout.');
const temp=await mkdtemp(join(tmpdir(),'quota-burn-smoke-'));
const env={...process.env,CODEX_HOME:join(temp,'codex'),CLAUDE_CONFIG_DIR:join(temp,'claude'),QP_DATA_DIR:join(temp,'burn'),QP_T3_HOME:join(temp,'t3')};
const run=(script,command)=>{const p=spawnSync(process.execPath,[join(ROOT,'scripts',script),command],{env,encoding:'utf8',timeout:120000,windowsHide:true});if(p.status!==0)throw Error(p.stderr||p.stdout||'Smoke command failed.');return p.stdout;};
for(const binary of [T3_BINARY,CODEX_BINARY,CLAUDE_BINARY]){const p=spawnSync(binary,['--version'],{env,encoding:'utf8',timeout:30000,windowsHide:true});if(p.status!==0)throw Error('Bundled CLI version probe failed: '+binary);}
let t3=false,burn=false;
try{
  run('t3-local.mjs','start');t3=true;run('burn-local.mjs','start');burn=true;
  const origin='http://127.0.0.1:4317',boot=await fetch(origin+'/api/bootstrap'),cookie=boot.headers.get('set-cookie').split(';')[0];
  let state;
  for(let i=0;i<40;i++){state=await fetch(origin+'/api/state',{headers:{Cookie:cookie}}).then(r=>r.json());if(state.connection.connected)break;await new Promise(r=>setTimeout(r,1000));}
  if(!state.connection.connected||state.settings.mode!=='observe'||state.runs.length||state.resets.length)throw Error('Native connection did not settle safely in Observation.');
  console.log('Native T3 discovery, Observation startup and provider catalog passed. No inference or resets.');
}finally{
  if(burn)run('burn-local.mjs','stop');if(t3)run('t3-local.mjs','stop');
  // The detached local watchdog exits after the worker disappears; do not delete its open DB.
  console.log('Native services stopped; disposable CI runtime retained until runner cleanup.');
}

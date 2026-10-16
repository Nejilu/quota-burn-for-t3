import { spawn, spawnSync } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function linuxIdentity(pid) {
  const stat=await readFile(`/proc/${pid}/stat`,'utf8');
  const fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');
  return {startTicks:fields[19],state:fields[0],executable:await realpath(`/proc/${pid}/exe`),
    args:(await readFile(`/proc/${pid}/cmdline`,'utf8')).split('\0').filter(Boolean)};
}
export async function processIdentity(pid) {
  if(process.platform!=='linux')return {};
  const identity=await linuxIdentity(pid);return {startTicks:identity.startTicks};
}
export async function stopOwnedProcess(state,root,kind) {
  if(process.platform==='win32') {
    const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(root,'scripts',kind==='t3'?'Stop-T3.ps1':'Stop-Burn.ps1'),'-StateFile',state.file],{cwd:root,windowsHide:true,encoding:'utf8',timeout:20000});
    if(result.status!==0||result.error)throw Error('Process identity could not be verified; Stop refused.');
    return;
  }
  if(process.platform!=='linux')throw Error('Process management supports Windows and Linux.');
  let identity;try{identity=await linuxIdentity(state.pid);}catch(e){if(e.code==='ENOENT'||e.code==='ESRCH')return;throw e;}
  const expected=await realpath(state.executable),marker=state.entry||state.baseDir;
  if(!state.startTicks||identity.startTicks!==state.startTicks||identity.executable!==expected||!identity.args.includes(marker))
    throw Error('Process identity changed; Stop refused.');
  // Launchers create a dedicated process group. SIGTERM lets owned services clean up.
  process.kill(-state.pid,'SIGTERM');
  for(let i=0;i<450;i++){try{const current=await linuxIdentity(state.pid);if(current.startTicks!==state.startTicks||current.state==='Z')return;}catch(e){if(e.code==='ENOENT'||e.code==='ESRCH')return;throw e;}await sleep(100);}
  throw Error('Stop is still pending after 45 seconds. Inspect the service before retrying.');
}
export function openBrowser(url) {
  let child;
  if(process.platform==='win32')child=spawn('powershell.exe',['-NoProfile','-Command','Start-Process -FilePath $env:QP_BROWSER_URL'],{windowsHide:true,env:{...process.env,QP_BROWSER_URL:url},stdio:'ignore'});
  else if(process.env.DISPLAY||process.env.WAYLAND_DISPLAY)child=spawn('xdg-open',[url],{stdio:'ignore'});
  else {console.log(`Open in your browser: ${url}`);return;}
  child.on('error',()=>console.log(`Open in your browser: ${url}`));child.unref();
}

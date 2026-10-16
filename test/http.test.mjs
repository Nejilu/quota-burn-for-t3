import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ROOT} from '../server/paths.mjs';

test('local HTTP API rejects cross-site requests and commands without session/CSRF',async()=>{
  const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
  const base=resolve(ROOT,'.runtime','http-tests'),dir=join(base,randomUUID());await mkdir(dir,{recursive:true});
  const child=spawn(process.execPath,[join(ROOT,'server','index.mjs')],{cwd:ROOT,env:{...process.env,QP_WATCHDOG_ENABLED:'0',QP_PORT:String(port),QP_DATA_DIR:dir,QP_T3_ORIGIN:'http://127.0.0.1:9'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  try{
    await new Promise((r,j)=>{const timer=setTimeout(()=>j(Error('HTTP test startup timeout')),10000);child.stdout.on('data',b=>{if(b.toString().includes('Quota Burn V2')){clearTimeout(timer);r();}});child.once('error',j);child.once('exit',()=>j(Error('Server exited before ready')));});
    const origin=`http://127.0.0.1:${port}`;
    assert.equal((await fetch(origin+'/api/state')).status,401);
    assert.equal((await fetch(origin+'/api/bootstrap',{headers:{Origin:'https://other.example'}})).status,403);
    assert.equal((await fetch(origin+'/api/bootstrap',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
    const boot=await fetch(origin+'/api/bootstrap');assert.equal(boot.status,200);const{csrf}=await boot.json();const cookie=boot.headers.get('set-cookie').split(';')[0];assert.ok(boot.headers.get('set-cookie').includes('HttpOnly'));assert.ok(boot.headers.get('set-cookie').includes('SameSite=Strict'));
    assert.equal((await fetch(origin+'/api/state',{headers:{Cookie:cookie}})).status,200);
    const before=await fetch(origin+'/api/settings',{method:'PUT',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({mode:'active',pollSeconds:60})});assert.equal(before.status,403);
    const invalid=await fetch(origin+'/api/settings',{method:'PUT',headers:{Cookie:cookie,'Content-Type':'application/json','X-QP-CSRF':csrf},body:JSON.stringify({mode:'active',pollSeconds:0})});assert.equal(invalid.status,400);
    const state=await fetch(origin+'/api/state',{headers:{Cookie:cookie}}).then(r=>r.json());assert.equal(state.settings.mode,'observe');assert.equal(state.runs.length,0);
    const exported=await fetch(origin+'/api/export',{headers:{Cookie:cookie}}).then(r=>r.json());assert.equal(exported.settings.mode,'observe');assert.ok(!JSON.stringify(exported).includes('access_token'));
  }finally{
    if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}
    const resolved=resolve(dir);assert.ok(resolved.startsWith(base+sep));await rm(resolved,{recursive:true,force:true});
  }
});

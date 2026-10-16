import test from 'node:test';
import assert from 'node:assert/strict';
import { bundledBinary,sameWorkspace,overlappingWorkspace } from '../server/platform.mjs';
import { httpConfig } from '../server/http-config.mjs';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { T3Adapter } from '../server/t3.mjs';

test('binary selection follows platform and architecture without PATH/global CLI assumptions',()=>{
  assert.match(bundledBinary('root','codex','linux','arm64'),/aarch64-unknown-linux-musl/);
  assert.match(bundledBinary('root','codex','win32','x64'),/x86_64-pc-windows-msvc/);
  assert.match(bundledBinary('root','t3','linux','x64'),/t3-linux-x64/);
  assert.match(bundledBinary('root','claude','linux','x64'),/claude-code-linux-x64/);
  assert.throws(()=>bundledBinary('root','t3','freebsd','x64'),/Unsupported/);
});
test('Linux paths preserve case; remote Windows paths compare using Windows rules',()=>{
  assert.equal(sameWorkspace('/work/App','/work/app'),false);
  assert.equal(sameWorkspace('C:\\Projects\\App','c:/projects/app/'),true);
  assert.equal(overlappingWorkspace('/work/app','/work/app/src'),true);
  assert.equal(overlappingWorkspace('/work/app','/work/apple'),false);
  assert.equal(overlappingWorkspace('C:\\app','c:/app/src'),true);
});
test('hosted HTTP access requires a password and never trusts an arbitrary Origin',async()=>{
  await assert.rejects(httpConfig({QP_HOST:'0.0.0.0'}),/password/i);
  await assert.rejects(httpConfig({QP_PUBLIC_ORIGIN:'https://burn.example/path'}),/origin/i);
  const dir=await mkdtemp(join(tmpdir(),'quota-burn-config-'));
  try{const file=join(dir,'password');await writeFile(file,'a-long-test-password');
    const c=await httpConfig({QP_HOST:'0.0.0.0',QP_PUBLIC_ORIGIN:'https://burn.example',QP_ACCESS_PASSWORD_FILE:file});
    assert.equal(c.secure,true);assert.equal(c.authorized(),false);
    assert.equal(c.authorized('Basic '+Buffer.from('admin:a-long-test-password').toString('base64')),true);
    assert.equal(c.authorized('Basic '+Buffer.from('admin:wrong').toString('base64')),false);
    assert.equal(c.origins.has('https://burn.example'),true);assert.equal(c.origins.has('http://localhost:4317'),false);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('remote T3 credentials rotate from a file without invoking or revoking local CLI sessions',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'quota-burn-remote-'));
  try{const file=join(dir,'session');await writeFile(file,JSON.stringify({token:'first-test-credential'}));
    const a=new T3Adapter({tokenFile:file});a.cli=()=>{throw Error('Local CLI must not run.');};
    assert.equal(a.remote,true);assert.equal(a.providerLocal,false);assert.equal(await a.token(),'first-test-credential');
    await writeFile(file,'second-test-credential');assert.equal(await a.token(),'second-test-credential');await a.close();
    await writeFile(file,JSON.stringify({token:'private-test-secret',expiresAt:'2000-01-01T00:00:00Z'}));
    await assert.rejects(a.token(),e=>/Renew/.test(e.message)&&!e.message.includes('private-test-secret'));
    await rm(file);await assert.rejects(a.token(),/Renew/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('remote folders are validated on T3 and remote-only accounts never expose local reset operations',async()=>{
  const a=new T3Adapter({tokenFile:'unused'});a.compatibility={protocol:2};let requested;
  a.rpc=async(tag,input)=>{requested={tag,input};return {entries:[{kind:'directory'}]};};
  assert.equal(await a.validateFolder('/only-on-t3/project'),'/only-on-t3/project');
  assert.deepEqual(requested,{tag:'filesystem.getMetadata',input:{paths:['/only-on-t3/project']}});
  await assert.rejects(a.validateFolder('relative/path'),/absolute/);
  const provider={driver:'codex',instanceId:'c',enabled:true,installed:true,auth:{status:'authenticated',profileId:'remote-profile'},usageLimits:{windows:[]}};
  const [account]=await a.normalize({providers:[provider],settings:{providerInstances:{c:{config:{homePath:'/remote/codex'}}}}});
  assert.equal(account.capabilities.resetCredits,false);
  assert.equal(account.instances[0].home,'/remote/codex');
  const optedIn=new T3Adapter({tokenFile:'unused',providerLocal:true});
  const [withoutHome]=await optedIn.normalize({providers:[provider],settings:{providerInstances:{c:{config:{}}}}});
  assert.equal(withoutHome.capabilities.resetCredits,false,'remote access never falls back to an unrelated local default home');
  a.rpc=async()=>({entries:[null]});await assert.rejects(a.validateFolder('/missing'),/existing folder/);
});

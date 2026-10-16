import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {T3Adapter} from '../server/t3.mjs';
import {ROOT} from '../server/paths.mjs';
const t3=new T3Adapter();
try{
  await t3.connect(false);
  const instance=t3.accounts.flatMap(a=>a.instances).find(i=>i.id==='claudeAgent'&&i.driver==='claudeAgent');
  if(!instance)throw Error('Enable the default Claude instance in T3 first.');
  const env={...process.env};
  if(instance.accountConfigPath===join(instance.home,'.claude.json'))env.CLAUDE_CONFIG_DIR=instance.home;
  else delete env.CLAUDE_CONFIG_DIR;
  console.log('Sign in to your Claude subscription in the browser opened by Claude Code.');
  const login=spawnSync(instance.binary||join(ROOT,'node_modules','@anthropic-ai','claude-code-win32-x64','claude.exe'),['auth','login'],{cwd:ROOT,env,stdio:'inherit'});
  if(login.error||login.status!==0)throw Error('Claude sign-in was not completed.');
  await t3.connect(true);
  console.log('Claude provider refreshed. Open Quota Burn and click Refresh.');
}catch(e){console.error(e.message);process.exitCode=1;}finally{await t3.close();}

import { spawnSync } from 'node:child_process';
import { mkdir,writeFile,rename } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { T3_BINARY,T3_HOME } from '../server/paths.mjs';

// Run on the T3 host. Keep stdout credentials in memory and write a private file.
const output=process.argv[2],ttl=process.argv[3]||'30d';
try {
  if(!output)throw Error('Usage: npm run t3:session -- <private-output-file> [ttl, default 30d]');
  const scopes=['orchestration:read','orchestration:operate','settings:write','providers:manage','filesystem:read'];
  const result=spawnSync(T3_BINARY,['auth','session','issue','--base-dir',T3_HOME,'--ttl',ttl,'--label','Quota Burn server',...scopes.flatMap(s=>['--scope',s]),'--json'],{encoding:'utf8',windowsHide:true,timeout:30000});
  if(result.status!==0||result.error)throw Error('Could not issue the T3 credential. Check the T3 binary, home and TTL.');
  const session=JSON.parse(result.stdout);if(typeof session.token!=='string'||!session.token)throw Error('Unexpected T3 session response.');
  const file=resolve(output);await mkdir(dirname(file),{recursive:true});
  const temporary=file+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(session,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temporary,file);
  console.log('T3 server credential written. Keep the file private and renew it before expiration.');
}catch(e){console.error(e.message);process.exitCode=1;}

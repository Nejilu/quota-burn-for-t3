import { randomBytes } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';
try{
  if(!process.argv[2])throw Error('Usage: npm run access:password -- <private-output-file>');
  const file=resolve(process.argv[2]);await mkdir(dirname(file),{recursive:true});
  await writeFile(file,randomBytes(32).toString('base64url')+'\n',{flag:'wx',mode:0o600});
  console.log('Access password written. Read the private file when signing in as admin.');
}catch(e){console.error(e.code==='EEXIST'?'Password file already exists; it was preserved.':e.message);process.exitCode=1;}

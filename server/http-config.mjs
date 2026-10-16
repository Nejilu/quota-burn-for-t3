import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const digest=value=>createHash('sha256').update(value).digest();
export async function httpConfig(env=process.env) {
  const port=Number(env.QP_PORT||4317),host=env.QP_HOST||'127.0.0.1';
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('QP_PORT must be a valid TCP port.');
  if(!['127.0.0.1','localhost','::1','0.0.0.0','::'].includes(host))throw Error('Invalid QP_HOST.');
  const url=new URL(env.QP_PUBLIC_ORIGIN||`http://127.0.0.1:${port}`);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)
    throw Error('QP_PUBLIC_ORIGIN must be an HTTP(S) origin without a path or credentials.');
  let password=null;
  if(env.QP_ACCESS_PASSWORD_FILE){try{password=(await readFile(env.QP_ACCESS_PASSWORD_FILE,'utf8')).trim();}catch{throw Error('Cannot read QP_ACCESS_PASSWORD_FILE.');}if(password.length<16)throw Error('Access password must have at least 16 characters.');}
  const remote=!['127.0.0.1','localhost','::1'].includes(host)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  if(remote&&!password)throw Error('Hosted access requires QP_ACCESS_PASSWORD_FILE.');
  const expected=password?digest(`${env.QP_ACCESS_USER||'admin'}:${password}`):null;
  const origin=url.origin,localOrigins=[`http://127.0.0.1:${port}`,`http://localhost:${port}`];
  return {host,port,origin,secure:url.protocol==='https:',hosts:new Set([url.host,...localOrigins.map(v=>new URL(v).host)]),
    origins:new Set([origin,...(remote?[]:localOrigins)]),
    authorized(header){if(!expected)return true;if(!/^Basic [A-Za-z0-9+/]+=*$/.test(header||''))return false;return timingSafeEqual(expected,digest(Buffer.from(header.slice(6),'base64').toString('utf8')));}};
}

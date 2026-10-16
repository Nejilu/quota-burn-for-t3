import { join, win32, posix } from 'node:path';

export function bundledBinary(root, kind, platform=process.platform, arch=process.arch) {
  if (!['win32','linux'].includes(platform) || !['x64','arm64'].includes(arch))
    throw new Error(`Unsupported platform: ${platform}/${arch}. Use Windows or Linux x64/arm64.`);
  if (kind==='t3') return join(root,'node_modules','@t3code',`t3-${platform}-${arch}`,platform==='win32'?'t3.exe':'t3');
  if (kind==='claude') return join(root,'node_modules','@anthropic-ai',`claude-code-${platform}-${arch}`,platform==='win32'?'claude.exe':'claude');
  if (kind==='codex') {
    const target=(arch==='x64'?'x86_64':'aarch64')+(platform==='win32'?'-pc-windows-msvc':'-unknown-linux-musl');
    return join(root,'node_modules','@openai',`codex-${platform}-${arch}`,'vendor',target,'bin',platform==='win32'?'codex.exe':'codex');
  }
  throw new Error('Unknown binary.');
}

// A remote Windows path must not be resolved against the Linux container's cwd.
export function workspaceKey(path) {
  if (typeof path!=='string'||!path.trim()) return '';
  if (/^(?:[a-z]:[\\/]|\\\\)/i.test(path)) return win32.normalize(path).replace(/[\\/]+$/,'').toLowerCase();
  return posix.normalize(path).replace(/\/$/,'')||'/';
}
export function sameWorkspace(a,b) {return !!workspaceKey(a)&&workspaceKey(a)===workspaceKey(b);}

export function overlappingWorkspace(a,b) {
  const x=workspaceKey(a),y=workspaceKey(b);if(!x||!y)return false;
  const sep=/^[a-z]:|^\\\\/i.test(x)?'\\':'/';
  return x===y||x.startsWith(y.endsWith(sep)?y:y+sep)||y.startsWith(x.endsWith(sep)?x:x+sep);
}

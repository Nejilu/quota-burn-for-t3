// Keep one-time credentials out of console output and persistent files.
import { spawnSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = join(root, 'node_modules', '@t3code', 't3-win32-x64', 't3.exe');
const result = spawnSync(binary, ['auth', 'pairing', 'create', '--base-dir', join(root, '.runtime', 't3'), '--base-url', 'http://127.0.0.1:3773', '--ttl', '2m', '--label', 'Windows local browser', '--json'], { windowsHide: true, encoding: 'utf8', timeout: 30_000 });
if (result.error || result.status !== 0) throw new Error('Could not create the local browser pairing. Start T3 first.');
const pairing = JSON.parse(result.stdout);
const destination = new URL(pairing.pairUrl);
if (destination.origin !== 'http://127.0.0.1:3773') throw new Error('Unexpected pairing destination.');
let redeemed = false;
const server = createServer((request, response) => {
  if (redeemed || request.method !== 'GET' || request.url !== '/') {
    response.writeHead(404); response.end(); return;
  }
  redeemed = true;
  response.writeHead(302, { Location: destination.href, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  response.end();
  clearTimeout(expiry);
  server.close();
});
const expiry = setTimeout(() => { console.error('Local pairing link expired. Run the command again.'); server.close(); }, 90_000);
server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  console.log(`Open this one-time local link: ${url}`);
  if (process.argv.includes('--open')) {
    const browser = spawn('powershell.exe', ['-NoProfile', '-Command', 'Start-Process -FilePath $env:T3_LOCAL_BROWSER_URL'], { windowsHide: true, env: { ...process.env, T3_LOCAL_BROWSER_URL: url }, stdio: 'ignore' });
    browser.on('error', () => console.error('Open the printed local link manually.'));
  }
});

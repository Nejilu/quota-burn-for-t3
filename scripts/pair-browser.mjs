import { openBrowser } from './process-control.mjs';
import { T3_BINARY, T3_HOME, T3_ORIGIN } from '../server/paths.mjs';
// Keep one-time credentials out of console output and persistent files.
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = T3_BINARY;
const result = spawnSync(binary, ['auth', 'pairing', 'create', '--base-dir', T3_HOME, '--base-url', T3_ORIGIN, '--ttl', '2m', '--label', 'Quota Burn browser', '--json'], { windowsHide: true, encoding: 'utf8', timeout: 30_000 });
if (result.error || result.status !== 0) throw new Error('Could not create the local browser pairing. Start T3 first.');
const pairing = JSON.parse(result.stdout);
const destination = new URL(pairing.pairUrl);
if (destination.origin !== T3_ORIGIN) throw new Error('Unexpected pairing destination.');
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
    openBrowser(url);
  }
});

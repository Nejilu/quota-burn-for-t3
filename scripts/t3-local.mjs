import { processIdentity, stopOwnedProcess } from './process-control.mjs';
import { T3_BINARY, CODEX_BINARY, T3_HOME } from '../server/paths.mjs';
import { sameWorkspace } from '../server/platform.mjs';
import { negotiateT3 } from '../server/t3-compat.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = join(root, '.runtime');
const baseDir = T3_HOME;
const origin = 'http://127.0.0.1:3773';
const stateFile = join(runtime, 'server.json');
const t3 = T3_BINARY;
const codex = CODEX_BINARY;
const codexHome = resolve(process.env.CODEX_HOME || join(homedir(), '.codex'));
const environment = { ...process.env, PATH: `${dirname(codex)}${delimiter}${join(root, 'node_modules', '.bin')}${delimiter}${process.env.PATH || ''}` };
let wireProtocol = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cli(args) {
  const result = spawnSync(t3, args, { cwd: root, env: environment, windowsHide: true, encoding: 'utf8', timeout: 30_000 });
  if (result.error || result.status !== 0) throw new Error(`T3 ${args[0]} failed; inspect the local runtime logs.`);
  return result.stdout;
}

async function request(path, token, body) {
  const response = await fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', Origin: origin, 'x-t3-orchestration-protocol': String(wireProtocol) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`T3 request failed (${response.status}, ${path}).`);
  return response.json();
}

async function descriptor() {
  const result = await request('/.well-known/t3/environment');
  wireProtocol = negotiateT3(result).protocol;
  return result;
}

async function rpc(token, tag, payload) {
  const { ticket } = await request('/api/auth/websocket-ticket', token, {});
  return new Promise((resolveResult, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:3773/ws?wsTicket=${encodeURIComponent(ticket)}&orchestrationProtocol=${wireProtocol}`);
    let done = false;
    const finish = (value, error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(new Error(error)); else resolveResult(value);
    };
    const timer = setTimeout(() => finish(null, `T3 RPC timeout: ${tag}`), 30_000);
    socket.onopen = () => socket.send(JSON.stringify({ _tag: 'Request', id: '1', tag, payload, headers: [] }));
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        for (const frame of Array.isArray(data) ? data : [data]) {
          if (frame._tag === 'Ping') socket.send(JSON.stringify({ _tag: 'Pong' }));
          if (frame._tag === 'Exit' && frame.requestId === '1') finish(frame.exit.value, frame.exit._tag === 'Success' ? null : `T3 RPC failed: ${tag}`);
        }
      } catch { finish(null, 'Invalid T3 RPC response.'); }
    };
    socket.onerror = () => finish(null, 'T3 WebSocket connection failed.');
    socket.onclose = () => finish(null, 'T3 WebSocket closed before its response.');
  });
}

async function withSession(action) {
  const session = JSON.parse(cli(['auth', 'session', 'issue', '--base-dir', baseDir, '--ttl', '5m', '--label', 'Quota Burn local verification', '--json']));
  try { return await action(session.token); }
  finally { cli(['auth', 'session', 'revoke', session.sessionId, '--base-dir', baseDir]); }
}

async function portInUse() {
  return new Promise((r) => {
    const socket = createConnection({ host: '127.0.0.1', port: 3773 });
    const finish = (busy) => { socket.destroy(); r(busy); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1500, () => finish(true));
  });
}

async function start() {
  await mkdir(join(baseDir, 'userdata'), { recursive: true });
  if (await portInUse()) {
    await descriptor();
    const saved = JSON.parse(await readFile(stateFile, 'utf8'));
    if (saved.baseDir !== baseDir) throw new Error('Port 3773 belongs to another T3 installation.');
    await withSession((token) => request('/api/orchestration/shell', token));
    console.log(`T3 is already running: ${origin}`);
    return;
  }
  const settingsFile = join(baseDir, 'userdata', 'settings.json');
  try { await readFile(settingsFile); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(settingsFile, JSON.stringify({
      enableProviderUpdateChecks: false,
      defaultRuntimeMode: 'approval-required',
      defaultModelSelection: { instanceId: 'codex', model: 'gpt-6.1-sol' },
      providerInstances: { codex: { driver: 'codex', displayName: 'Codex', enabled: true, config: { binaryPath: codex, homePath: codexHome } } },
    }, null, 2) + '\n', { flag: 'wx' });
  }
  const out = await open(join(runtime, 't3.stdout.log'), 'a');
  const err = await open(join(runtime, 't3.stderr.log'), 'a');
  let child;
  try {
    child = spawn(t3, ['serve', '--mode', 'web', '--host', '127.0.0.1', '--port', '3773', '--base-dir', baseDir, root], {
      cwd: root, env: environment, detached: true, windowsHide: true, stdio: ['ignore', out.fd, err.fd],
    });
    await new Promise((r, j) => { child.once('spawn', r); child.once('error', j); });
    child.unref();
  } finally { await out.close(); await err.close(); }
  await writeFile(stateFile, JSON.stringify({ pid: child.pid, ...await processIdentity(child.pid), executable: t3, baseDir, origin, startedAt: new Date().toISOString() }, null, 2) + '\n');
  for (let i = 0; i < 45; i++) {
    try { await descriptor(); console.log(`T3 started: ${origin}`); return; }
    catch { await sleep(1000); }
  }
  throw new Error('T3 startup did not complete; inspect .runtime/t3.stderr.log.');
}

async function check() {
  const desc = await descriptor();
  await withSession(async (token) => {
    await rpc(token, 'server.refreshProviders', { instanceId: 'codex', refreshModels: false });
    const config = await rpc(token, 'server.getConfig', {});
    const provider = config.providers.find((p) => p.instanceId === 'codex');
    if (provider?.auth?.status !== 'authenticated') {
      console.error(JSON.stringify({ version: provider?.version, authStatus: provider?.auth?.status, status: provider?.status, message: provider?.message }));
      throw new Error('The Codex provider is not authenticated.');
    }
    if (!provider.models?.length) throw new Error('T3 did not report a Codex model catalog.');
    let shell = await request('/api/orchestration/shell', token);
    let project = shell.projects.find((p) => sameWorkspace(p.workspaceRoot,root));
    if (!project) {
      await (wireProtocol===2 ? ((command)=>rpc(token,'projects.mutate',command)) : ((command)=>request('/api/orchestration/dispatch',token,command)))({ type: 'project.create', commandId: randomUUID(), projectId: 'quota-burn', title: 'Quota Burn', workspaceRoot: root, createdAt: new Date().toISOString() });
      shell = await request('/api/orchestration/shell', token);
      project = shell.projects.find((p) => p.id === 'quota-burn');
    }
    if (!project) throw new Error('Local project registration failed.');
    const summary = {
      serverVersion: desc.serverVersion, orchestrationProtocolVersion: desc.orchestrationProtocolVersion,
      origin, codexVersion: provider.version, authStatus: provider.auth.status,
      modelCount: provider.models.length, modelIds: provider.models.map((m) => m.slug),
      defaultRuntimeMode: config.settings.defaultRuntimeMode,
      quotaCheckedAt: provider.usageLimits?.checkedAt,
      windows: provider.usageLimits?.windows,
      quotaUnavailable: provider.usageLimits?.unavailable?.reason,
      project: { id: project.id, title: project.title, workspaceRoot: project.workspaceRoot },
      checkedAt: new Date().toISOString(),
    };
    await writeFile(join(runtime, 'verification.json'), JSON.stringify(summary, null, 2) + '\n');
    console.log(JSON.stringify(summary, null, 2));
  });
  console.log('Temporary verification credential revoked. No model turn was started.');
}

async function stop() {
  const saved=JSON.parse(await readFile(stateFile,'utf8'));
  await stopOwnedProcess({...saved,file:stateFile},root,'t3');
  console.log('Local T3 stopped. Its project data is preserved.');
}

try {
  const command = process.argv[2] || 'status';
  if (command === 'start') await start();
  else if (command === 'stop') await stop();
  else if (command === 'check') await check();
  else if (command === 'status') {
    await descriptor();
    await withSession((token) => request('/api/orchestration/shell', token));
    console.log(`T3 is running and its local API responds: ${origin}`);
  } else throw new Error('Use start, stop, status or check.');
} catch (error) { console.error(error.message); process.exitCode = 1; }

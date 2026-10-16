import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = resolve(process.env.QP_DATA_DIR || join(ROOT, '.runtime', 'pilot'));
export const T3_HOME = resolve(process.env.QP_T3_HOME || join(ROOT, '.runtime', 't3'));
export const T3_ORIGIN = process.env.QP_T3_ORIGIN || 'http://127.0.0.1:3773';
export const T3_BINARY = process.env.QP_T3_BINARY || join(ROOT, 'node_modules', '@t3code', `t3-${process.platform}-${process.arch}`, process.platform === 'win32' ? 't3.exe' : 't3');
export const CODEX_BINARY = process.env.QP_CODEX_BINARY || (process.platform === 'win32' ? join(ROOT, 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe') : 'codex');

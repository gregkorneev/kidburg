// npm run verify: тесты + запуск сервера на случайном порту + проверка /health.
// Общий лимит времени 30 секунд.

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOTAL_LIMIT_MS = 30_000;
const started = Date.now();
const left = () => Math.max(1, TOTAL_LIMIT_MS - (Date.now() - started));

const children = new Set();
function fail(msg) {
  console.error(`verify: ОШИБКА: ${msg}`);
  for (const c of children) c.kill('SIGKILL');
  process.exit(1);
}
const timer = setTimeout(() => fail('превышен общий лимит 30 секунд'), TOTAL_LIMIT_MS);

function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { cwd: ROOT, ...opts });
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function runTests() {
  console.log('verify: тесты (node --test)');
  const child = run(process.execPath, ['--test'], { stdio: 'inherit' });
  const code = await new Promise((resolve) => child.on('exit', resolve));
  if (code !== 0) fail('тесты не прошли');
}

async function checkHealth() {
  const port = await freePort();
  console.log(`verify: сервер на порту ${port}`);
  const server = run(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(port), DB_PATH: ':memory:', LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  server.on('exit', (code) => {
    if (code) fail(`сервер завершился с кодом ${code}`);
  });

  let body;
  while (Date.now() - started < TOTAL_LIMIT_MS) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(left()) });
      body = await res.json();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  server.removeAllListeners('exit');
  server.kill('SIGTERM');
  if (!body || body.ok !== true) fail(`/health вернул ${JSON.stringify(body)}`);
  console.log('verify: /health ok');
}

await runTests();
await checkHealth();
clearTimeout(timer);
console.log(`verify: всё прошло за ${((Date.now() - started) / 1000).toFixed(1)} с`);
process.exit(0);

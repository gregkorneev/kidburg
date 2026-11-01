// Мини-драйвер Chrome DevTools Protocol для проверки игры без внешних зависимостей (только ws из проекта).
// Запускает отдельный headless-Chrome с GPU (Metal/ANGLE) и временным профилем; профиль игрока не затрагивается.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port = 9333, width = 1280, height = 800, extra = [] } = {}) {
  const profile = mkdtempSync(path.join(tmpdir(), 'kb-chrome-'));
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--enable-gpu', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--autoplay-policy=no-user-gesture-required',
    `--window-size=${width},${height}`, ...extra, 'about:blank',
  ], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 60; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((t) => t.type === 'page')) break; } catch { /* ждём запуска */ }
    await sleep(250);
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((r) => ws.once('open', r));
  let id = 0;
  const pending = new Map();
  const consoleLog = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
    else if (msg.method === 'Runtime.consoleAPICalled') consoleLog.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    else if (msg.method === 'Runtime.exceptionThrown') consoleLog.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const api = {
    send, consoleLog,
    async goto(url) { await send('Page.navigate', { url }); await sleep(1500); },
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    async shot(file) { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(r.data, 'base64')); },
    async key(code, key, down = true) { await send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', code, key, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0), text: down && key.length === 1 ? key : undefined }); },
    async press(code, key, hold = 60) { await api.key(code, key, true); await sleep(hold); await api.key(code, key, false); },
    sleep,
    async close() { try { await send('Browser.close'); } catch { /* уже закрыт */ } ws.close(); proc.kill(); },
  };
  return api;
}

/** Вход по имени и коду комнаты: токен кладётся в sessionStorage, как делает клиент. */
export async function login(browser, base, name, room) {
  await browser.goto(`${base}/`);
  await browser.eval(`(async () => {
    const r = await fetch('/api/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: ${JSON.stringify(name)}, room: ${JSON.stringify(room)} }) });
    const j = await r.json(); sessionStorage.setItem('city.token', j.token); sessionStorage.setItem('city.user', JSON.stringify(j.user)); return r.status;
  })()`);
}

export { sleep };

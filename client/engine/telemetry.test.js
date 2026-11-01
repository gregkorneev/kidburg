import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameMeter, makeSessionId, startTelemetry } from './telemetry.js';

function fakeEnv({ visibility = 'visible', token = 'tok' } = {}) {
  let clock = 0;
  const timers = [];
  const listeners = { win: {}, doc: {} };
  const requests = [];
  const win = {
    setTimeout: (fn, ms) => {
      const t = { fn, at: clock + ms, id: timers.length + 1 };
      timers.push(t);
      return t.id;
    },
    clearTimeout: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    addEventListener: (type, fn) => void (listeners.win[type] = fn),
    removeEventListener: (type) => void delete listeners.win[type],
  };
  const doc = {
    visibilityState: visibility,
    addEventListener: (type, fn) => void (listeners.doc[type] = fn),
    removeEventListener: (type) => void delete listeners.doc[type],
  };
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    if (url === '/health') {
      clock += 7;
      return { ok: true };
    }
    return { ok: true, json: async () => ({ ok: true, intervalMs: 2000 }) };
  };
  const session = { token: () => token };
  /** Продвигает время и запускает сработавшие таймеры. */
  const advance = async (ms) => {
    clock += ms;
    for (const t of [...timers].sort((a, b) => a.at - b.at)) {
      if (t.at <= clock) {
        timers.splice(timers.indexOf(t), 1);
        await t.fn();
      }
    }
  };
  return { win, doc, fetchImpl, session, requests, listeners, advance, now: () => clock, timers, setVisibility: (v) => void (doc.visibilityState = v) };
}

test('makeSessionId: случайный допустимый идентификатор', () => {
  const a = makeSessionId();
  const b = makeSessionId();
  assert.match(a, /^[A-Za-z0-9_-]{8,64}$/);
  assert.notEqual(a, b);
});

test('ID телеметрии сохраняется при переходе между страницами в той же вкладке', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const first = fakeEnv();
  first.win.sessionStorage = storage;
  const a = startTelemetry({ loc: 'bakery', ...first });
  a.stop();

  const nextPage = fakeEnv();
  nextPage.win.sessionStorage = storage;
  const b = startTelemetry({ loc: 'city', ...nextPage });
  assert.equal(b.sid, a.sid);
  b.stop();
});

test('счётчик кадров считает среднее за окно, а не мгновенное значение', () => {
  let t = 0;
  const meter = createFrameMeter(() => t);
  for (let i = 0; i < 90; i++) meter.mark();
  t = 1500;
  const sample = meter.take();
  assert.equal(sample.frames, 90);
  assert.equal(Math.round(sample.fps), 60);
  assert.equal(Math.round(sample.frameMs * 10) / 10, 16.7);
  t = 1550;
  assert.equal(meter.take().fps, null, 'слишком короткое окно не даёт ложного значения');
});

test('отчёт: усреднённые FPS и ping, локация, качество, render и чанки; интервал берётся у сервера', async () => {
  const env = fakeEnv();
  const t = startTelemetry({
    loc: 'city',
    externalFrames: true,
    getQuality: () => 'high',
    getRenderInfo: () => ({ calls: 120, triangles: 45000, geometries: 80, textures: 12 }),
    getChunks: () => ({ loaded: 9, max: 14 }),
    ...env,
    sid: 'sid-test-0001',
  });
  for (let i = 0; i < 90; i++) t.markFrame();
  await env.advance(1500);
  const post = env.requests.find((r) => r.url === '/api/telemetry');
  assert.ok(post, 'отчёт отправлен');
  assert.equal(post.init.headers.authorization, 'Bearer tok');
  assert.deepEqual(
    { sid: post.body.sid, loc: post.body.loc, state: post.body.state, quality: post.body.quality, ping: post.body.ping },
    { sid: 'sid-test-0001', loc: 'city', state: 'active', quality: 'high', ping: 7 },
  );
  assert.equal(Math.round(post.body.fps), 60);
  assert.deepEqual(post.body.render, { calls: 120, triangles: 45000, geometries: 80, textures: 12 });
  assert.deepEqual(post.body.chunks, { loaded: 9, max: 14 });
  assert.equal(env.timers.length, 1);
  assert.equal(env.timers[0].at - env.now(), 2000, 'следующий отчёт через интервал, заданный сервером');
  t.stop();
});

test('скрытая вкладка и остановка рендеринга отражаются состоянием, а не ложным FPS', async () => {
  const env = fakeEnv({ visibility: 'hidden' });
  const t = startTelemetry({ loc: 'florist', externalFrames: true, ...env, sid: 'sid-test-0002' });
  await env.advance(1500);
  let post = env.requests.filter((r) => r.url === '/api/telemetry').at(-1);
  assert.equal(post.body.state, 'hidden');
  assert.equal(post.body.fps, null);

  env.setVisibility('visible');
  await env.advance(2000); // кадры не отмечались: рендеринг приостановлен
  post = env.requests.filter((r) => r.url === '/api/telemetry').at(-1);
  assert.equal(post.body.state, 'paused');
  assert.equal(post.body.fps, null);
  t.stop();
});

test('без токена отчёты не уходят; при закрытии страницы отправляется bye с keepalive', async () => {
  const guest = fakeEnv({ token: null });
  const g = startTelemetry({ loc: 'bakery', externalFrames: true, ...guest, sid: 'sid-test-0003' });
  await guest.advance(1500);
  assert.equal(guest.requests.filter((r) => r.url === '/api/telemetry').length, 0);
  g.stop();

  const env = fakeEnv();
  const t = startTelemetry({ loc: 'firefighter', externalFrames: true, ...env, sid: 'sid-test-0004' });
  env.listeners.win.pagehide({ persisted: false });
  const bye = env.requests.find((r) => r.body?.bye);
  assert.equal(bye.body.sid, 'sid-test-0004');
  assert.equal(bye.init.keepalive, true);
  t.stop();
  assert.equal(env.listeners.win.pagehide, undefined, 'слушатели сняты');
  assert.equal(env.listeners.doc.visibilitychange, undefined);
});

test('сбой сети не ломает цикл отчётов', async () => {
  const env = fakeEnv();
  let calls = 0;
  const failing = async (url, init) => {
    calls += 1;
    if (url === '/api/telemetry') throw new TypeError('fetch failed');
    return env.fetchImpl(url, init);
  };
  const t = startTelemetry({ loc: 'city', externalFrames: true, ...env, fetchImpl: failing, sid: 'sid-test-0005' });
  await env.advance(1500);
  assert.ok(calls >= 2);
  assert.equal(env.timers.length, 1, 'следующий отчёт запланирован');
  t.stop();
});

test('внеочередной отчёт при скрытии вкладки не нарушает минимальный зазор сервера', async () => {
  const env = fakeEnv();
  const t = startTelemetry({ loc: 'city', externalFrames: true, ...env, sid: 'sid-test-0006' });
  await env.advance(1500); // обычный отчёт
  env.setVisibility('hidden');
  env.listeners.doc.visibilitychange();
  const delay = env.timers[0].at - env.now();
  assert.ok(delay >= 400, `отчёт отложен минимум на зазор сервера, а не ${delay} мс`);
  t.stop();
});

test('кадры считаются по счётчику реально отрисованных кадров сцены, а не по requestAnimationFrame', async () => {
  const env = fakeEnv();
  let rendered = 0;
  let rafCalls = 0;
  env.win.requestAnimationFrame = () => void (rafCalls += 1);
  const t = startTelemetry({ loc: 'florist', getFrameCount: () => rendered, ...env, sid: 'sid-test-0007' });
  assert.equal(rafCalls, 0, 'собственный цикл requestAnimationFrame не запускается');

  rendered += 90; // сцена отрисовала 90 кадров за 1,5 с
  await env.advance(1500);
  let post = env.requests.filter((r) => r.url === '/api/telemetry').at(-1);
  assert.equal(post.body.state, 'active');
  assert.equal(Math.round(post.body.fps), 60);

  // рендер остановился (сцена не вызывает render), а браузер продолжает вызывать rAF: активным значение оставаться не должно
  await env.advance(2000);
  post = env.requests.filter((r) => r.url === '/api/telemetry').at(-1);
  assert.equal(post.body.state, 'paused');
  assert.equal(post.body.fps, null);
  t.stop();
});

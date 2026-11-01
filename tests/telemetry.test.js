// Телеметрия клиентов: разбор отчётов, статусы, история, политика хранения и HTTP-маршрут.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelemetry, parseReport } from '../server/telemetry/index.js';
import { ADMIN_PASSWORD, adminLogin, adminRequest, join, joinGame, listen, makeAdminApp, tempWorld } from './helpers.js';

const SID_A = 'sid-aaaaaaaa';
const SID_B = 'sid-bbbbbbbb';
const user = (id, name = `u${id}`) => ({ id, name });
const report = (sid, extra = {}) => parseReport({ sid, loc: 'city', quality: 'medium', fps: 60, ping: 5, ...extra }).report;

function clock() {
  let t = 1_000_000;
  return { now: () => t, tick: (ms) => void (t += ms) };
}

test('parseReport: строгая проверка и отказ от ложных значений', () => {
  assert.equal(parseReport({ sid: 'x' }).ok, false);
  assert.equal(parseReport({ sid: SID_A, fps: -1 }).ok, false);
  assert.equal(parseReport({ sid: SID_A, fps: 'много' }).ok, false);
  assert.equal(parseReport({ sid: SID_A, ping: 1e9 }).ok, false);
  assert.equal(parseReport({ sid: SID_A, state: 'sleeping' }).ok, false);
  assert.equal(parseReport({ sid: SID_A, loc: 'Город!' }).ok, false);
  assert.equal(parseReport({ sid: SID_A, render: { calls: -3 } }).ok, false);
  assert.equal(parseReport(null).ok, false);
  assert.equal(parseReport([]).ok, false);
  const hidden = parseReport({ sid: SID_A, state: 'hidden', fps: 55 });
  assert.equal(hidden.report.fps, null, 'у скрытой вкладки FPS не принимается');
  assert.deepEqual(parseReport({ sid: SID_A, bye: true }).report, { sid: SID_A, bye: true });
});

test('две сессии считаются отдельно, у каждой свои FPS и ping', () => {
  const { now, tick } = clock();
  const tel = createTelemetry({ now });
  tel.report(user(1, 'Аня'), report(SID_A, { fps: 60, ping: 4 }));
  tel.report(user(2, 'Борис'), report(SID_B, { fps: 24, ping: 180, loc: 'firefighter', quality: 'low' }));
  tick(3000);
  tel.report(user(1, 'Аня'), report(SID_A, { fps: 58, ping: 6 }));
  const clients = tel.clients();
  const a = clients.find((c) => c.sid === SID_A);
  const b = clients.find((c) => c.sid === SID_B);
  assert.deepEqual([a.name, a.fps, a.ping, a.loc, a.status], ['Аня', 58, 6, 'city', 'online']);
  assert.deepEqual([b.name, b.fps, b.ping, b.loc, b.quality], ['Борис', 24, 180, 'firefighter', 'low']);
  assert.equal(a.fpsAvg, 59);
  assert.equal(a.pingKind, 'http');
  const s = tel.summary(clients);
  assert.equal(s.playersOnline, 2);
  assert.equal(s.fpsMin, 24);
  assert.equal(s.pingMax, 180);
});

test('одна учётная запись с двумя вкладками даёт две сессии, но одного игрока', () => {
  const { now, tick } = clock();
  const tel = createTelemetry({ now });
  tel.report(user(1), report(SID_A));
  tick(500);
  tel.report(user(1), report(SID_B, { loc: 'florist' }));
  const s = tel.summary(tel.clients());
  assert.equal(s.sessionsOnline, 2);
  assert.equal(s.playersOnline, 1);
});

test('скрытая вкладка — «неактивна» без FPS; отсутствие данных — null, а не 0', () => {
  const { now } = clock();
  const tel = createTelemetry({ now });
  assert.equal(tel.summary(tel.clients()).fpsAvg, null);
  tel.report(user(1), report(SID_A, { state: 'hidden', fps: 99 }));
  const [c] = tel.clients();
  assert.deepEqual([c.status, c.state, c.fps], ['inactive', 'hidden', null]);
  const s = tel.summary(tel.clients());
  assert.equal(s.fpsAvg, null);
  assert.equal(s.sessionsInactive, 1);
});

test('тишина: отключён через три интервала и удаляется из списка по политике хранения', () => {
  const { now, tick } = clock();
  const tel = createTelemetry({ now, intervalMs: 1000, retainOfflineMs: 10_000 });
  tel.report(user(1), report(SID_A));
  tick(2500);
  assert.equal(tel.clients()[0].status, 'online');
  tick(1000);
  const [off] = tel.clients();
  assert.deepEqual([off.status, off.fps, off.ping], ['offline', null, null]);
  tick(9000);
  assert.equal(tel.clients().length, 1, 'ещё в списке');
  tick(2000);
  assert.equal(tel.clients().length, 0, 'удалён');
  assert.equal(tel.size, 0);
});

test('bye закрывает сессию сразу, новая отправка с тем же sid переподключает', () => {
  const { now, tick } = clock();
  const tel = createTelemetry({ now });
  tel.report(user(1), report(SID_A));
  tel.report(user(1), { sid: SID_A, bye: true });
  assert.equal(tel.clients()[0].status, 'offline');
  tick(1000);
  tel.report(user(1), report(SID_A, { fps: 50 }));
  assert.deepEqual([tel.clients()[0].status, tel.clients()[0].fps], ['online', 50]);
});

test('история ограничена по размеру; чужой sid и частые отчёты отклоняются; лимиты вкладок и сессий', () => {
  const { now, tick } = clock();
  const tel = createTelemetry({ now, historySize: 5, maxSessionsPerUser: 2, maxSessions: 3 });
  for (let i = 0; i < 12; i++) {
    assert.equal(tel.report(user(1), report(SID_A, { fps: 30 + i })).ok, true);
    tick(1000);
  }
  const [c] = tel.clients({ history: true });
  assert.equal(c.history.length, 5);
  assert.equal(c.history.at(-1).fps, 41);

  assert.equal(tel.report(user(2), report(SID_A)).code, 'foreign_session');
  tel.report(user(1), report(SID_B));
  assert.equal(tel.report(user(1), report(SID_B)).code, 'too_fast');
  assert.equal(tel.report(user(1), report('sid-cccccccc')).code, 'too_many_sessions');
  tel.report(user(2), report('sid-dddddddd'));
  assert.equal(tel.report(user(3), report('sid-eeeeeeee')).code, 'full');
});

test('POST /api/telemetry: нужен токен игрока, данные проверяются, ответ несёт интервал', async () => {
  const app = await makeAdminApp();
  const { token } = await join(app, 'Аня');
  const post = (payload, headers = {}) => app.inject({ method: 'POST', url: '/api/telemetry', payload, headers });

  assert.equal((await post({ sid: SID_A, fps: 60 })).statusCode, 401);
  assert.equal((await post({ sid: SID_A, fps: 60 }, { authorization: 'Bearer wrong' })).statusCode, 401);
  const auth = { authorization: `Bearer ${token}` };
  assert.equal((await post({ sid: 'x', fps: 60 }, auth)).statusCode, 400);
  assert.equal((await post({ sid: SID_A, fps: 5000 }, auth)).statusCode, 400);
  const big = await post({ sid: SID_A, junk: 'x'.repeat(5000) }, auth);
  assert.equal(big.statusCode, 413);
  const ok = await post({ sid: SID_A, loc: 'city', quality: 'high', fps: 61.5, frameMs: 16.2, ping: 3.4, chunks: { loaded: 9, max: 14 }, render: { calls: 10, triangles: 100, geometries: 5, textures: 2 } }, auth);
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json(), { ok: true, intervalMs: 3000 });
  await app.close();
});

test('админ видит телеметрию двух игроков, игрок — нет; данные WebSocket добавляются к строке', async () => {
  const { worldDir, cleanup } = tempWorld();
  const { app, port } = await listen({ worldDir, adminPassword: ADMIN_PASSWORD });
  try {
    const a = await joinGame(app, port, 'Аня');
    const b = await joinGame(app, port, 'Борис');
    const send = (token, sid, extra) =>
      app.inject({ method: 'POST', url: '/api/telemetry', headers: { authorization: `Bearer ${token}` }, payload: { sid, loc: 'city', ...extra } });
    assert.equal((await send(a.token, SID_A, { fps: 60, ping: 4 })).statusCode, 200);
    assert.equal((await send(b.token, SID_B, { fps: 30, ping: 90, loc: 'florist' })).statusCode, 200);

    const asPlayer = await app.inject({ method: 'GET', url: '/api/admin/clients', headers: { authorization: `Bearer ${a.token}`, host: 'localhost:3000' } });
    assert.equal(asPlayer.statusCode, 401);

    const admin = await adminLogin(app);
    const res = await adminRequest(app, admin, 'GET', '/api/admin/clients');
    assert.equal(res.statusCode, 200);
    const { clients, summary } = res.json();
    assert.equal(clients.length, 2);
    const ana = clients.find((c) => c.name === 'Аня');
    assert.equal(ana.wsConnected, true);
    assert.ok(ana.chunks && ana.chunks.loaded >= 9, 'число чанков берётся у игрового сервера');
    assert.equal(ana.chunksSource, 'server');
    assert.equal(summary.playersOnline, 2);
    assert.equal(summary.fpsMin, 30);
    assert.equal(clients.find((c) => c.name === 'Борис').loc, 'florist');

    const overview = (await adminRequest(app, admin, 'GET', '/api/admin/overview')).json();
    assert.equal(overview.playersWs, 2);
    assert.equal(overview.world.count, 0);
    await Promise.all([a.client.close(), b.client.close()]);
  } finally {
    await app.close();
    cleanup();
  }
});

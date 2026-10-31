import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { SPAWN, MAX_SPEED, SPEED_TOLERANCE } from '../shared/constants.js';
import { CLOSE } from '../server/net/game.js';
import { TestClient, getTicket, joinGame, listen, readPlayerState, register, seedPlayerState, tempDb, tempWorld } from './helpers.js';

const pos = (x, z, seq = 1) => ({ t: 'pos', x, y: 0, z, ry: 0, anim: 1, seq });
const isPlayers = (m) => m.t === 'players';

/** Ответ на попытку upgrade: статус HTTP или 'open', если соединение принято. */
async function upgradeStatus(port, query) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`);
  ws.on('error', () => {});
  const [result] = await Promise.race([
    once(ws, 'unexpected-response').then(([, res]) => [res.statusCode]),
    once(ws, 'open').then(() => ['open']),
  ]);
  if (result === 'open') ws.close();
  return result;
}

test('WebSocket без тикета, с чужим и повторным тикетом: 401 до upgrade', async () => {
  const { app, port } = await listen();
  assert.equal(await upgradeStatus(port, ''), 401);
  assert.equal(await upgradeStatus(port, '?ticket=bogus'), 401);

  const { token } = await register(app, 'Аня');
  const ticket = await getTicket(app, token);
  assert.equal(await upgradeStatus(port, `?ticket=${ticket}`), 'open');
  assert.equal(await upgradeStatus(port, `?ticket=${ticket}`), 401, 'тикет одноразовый');
  await app.close();
});

test('просроченный тикет не принимается', async () => {
  let t = 1_000_000;
  const { app, port } = await listen({ now: () => t });
  const { token } = await register(app, 'Аня');
  const ticket = await getTicket(app, token);
  t += 30_000;
  assert.equal(await upgradeStatus(port, `?ticket=${ticket}`), 401);
  await app.close();
});

test('hello: welcome с позицией, константами и прогрессом; spawn для нового игрока', async () => {
  const { app, port } = await listen();
  const { welcome, user } = await joinGame(app, port, 'Аня');
  assert.equal(welcome.proto, 1);
  assert.equal(welcome.playerId, user.id);
  assert.equal(welcome.name, 'Аня');
  assert.deepEqual(
    [welcome.state.x, welcome.state.y, welcome.state.z, welcome.state.ry],
    [SPAWN.x, SPAWN.y, SPAWN.z, SPAWN.ry],
  );
  assert.deepEqual(welcome.state.progress, {});
  assert.equal(welcome.consts.CACHE_MAX_CHUNKS, 14);
  await app.close();
});

test('до hello принимается только hello; неверный proto закрывает соединение', async () => {
  const { app, port } = await listen();
  const a = await register(app, 'Аня');
  const early = await TestClient.connect(port, await getTicket(app, a.token));
  early.send(pos(1, 1));
  assert.equal((await early.nextOfType('error')).code, 'unauth');
  assert.equal(await early.closed, CLOSE.UNAUTH);

  const b = await register(app, 'Борис');
  const old = await TestClient.connect(port, await getTicket(app, b.token));
  old.send({ t: 'hello', ticket: 'x', proto: 99 });
  assert.equal((await old.nextOfType('error')).code, 'bad_msg');
  assert.equal(await old.closed, CLOSE.BAD_PROTO);
  await app.close();
});

test('hello не пришёл вовремя: соединение закрывается', async () => {
  const { app, port } = await listen({ helloTimeoutMs: 100 });
  const { token } = await register(app, 'Аня');
  const client = await TestClient.connect(port, await getTicket(app, token));
  assert.equal(await client.closed, CLOSE.UNAUTH);
  await app.close();
});

test('мусор и текстовые кадры дают bad_msg, а не падение', async () => {
  const { app, port } = await listen();
  const { client } = await joinGame(app, port, 'Аня');
  client.ws.send('text frame');
  assert.equal((await client.nextOfType('error')).code, 'bad_msg');
  client.ws.send(Buffer.from([0xc1])); // зарезервированный байт msgpack
  assert.equal((await client.nextOfType('error')).code, 'bad_msg');
  client.send({ t: 'pos', x: 'a' });
  assert.equal((await client.nextOfType('error')).code, 'bad_msg');
  client.send({ t: 'hello', ticket: 'x', proto: 1 });
  assert.equal((await client.nextOfType('error')).code, 'bad_msg', 'повторный hello');
  await app.close();
});

test('два клиента видят друг друга: player_join и позиции', async () => {
  const { app, port } = await listen();
  const a = await joinGame(app, port, 'Аня');
  const b = await joinGame(app, port, 'Борис');

  const join = await a.client.nextOfType('player_join');
  assert.equal(join.id, b.user.id);
  assert.equal(join.name, 'Борис');
  assert.deepEqual(join.appearance, {});

  b.client.send({ ...pos(SPAWN.x + 0.2, SPAWN.z + 0.1, 5), ry: 1.5, anim: 2 });
  const seen = await a.client.next((m) => isPlayers(m) && m.list[0][1] === SPAWN.x + 0.2);
  assert.deepEqual(seen.list, [[b.user.id, SPAWN.x + 0.2, 0, SPAWN.z + 0.1, 1.5, 2]]);
  assert.ok(Number.isInteger(seen.tick));
  assert.ok(seen.list.every((row) => row[0] !== a.user.id), 'себя в списке нет');
  await app.close();
});

test('игрок в далёком чанке не виден; соседний чанк виден', async () => {
  const { dbPath, cleanup } = tempDb();
  const { app, port } = await listen({ dbPath });
  try {
    await register(app, 'Далеко');
    await register(app, 'Рядом');
    seedPlayerState(dbPath, 'Далеко', { x: 5, y: 0, z: 5 }); // чанк (0, 0)
    seedPlayerState(dbPath, 'Рядом', { x: SPAWN.x + 64, y: 0, z: SPAWN.z }); // чанк (7, 6)

    const a = await joinGame(app, port, 'Аня');
    for (const name of ['Далеко', 'Рядом']) {
      const login = await app.inject({ method: 'POST', url: '/api/login', payload: { name, password: 'secret' } });
      const c = await TestClient.connect(port, await getTicket(app, login.json().token));
      c.send({ t: 'hello', ticket: 'x', proto: 1 });
      await c.nextOfType('welcome');
    }
    const join = await a.client.nextOfType('player_join');
    assert.equal(join.name, 'Рядом');
    await a.client.next((m) => isPlayers(m) && m.list.length === 1);
    assert.equal(a.client.inbox.filter((m) => m.t === 'player_join').length, 0, 'дальнего не видно');
  } finally {
    await app.close();
    cleanup();
  }
});

test('границы мира: координаты за краем прижимаются, клиенту приходит correct', async () => {
  const { dbPath, cleanup } = tempDb();
  const { app, port } = await listen({ dbPath });
  try {
    await register(app, 'Край');
    seedPlayerState(dbPath, 'Край', { x: 0.2, y: 0, z: 0.2 });
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { name: 'Край', password: 'secret' } });
    const client = await TestClient.connect(port, await getTicket(app, login.json().token));
    client.send({ t: 'hello', ticket: 'x', proto: 1 });
    await client.nextOfType('welcome');
    client.send(pos(-0.3, 0.3));
    const fix = await client.nextOfType('correct');
    assert.deepEqual([fix.x, fix.z], [0, 0.3]);
  } finally {
    await app.close();
    cleanup();
  }
});

test('превышение скорости даёт correct и возврат к последней допустимой позиции', async () => {
  const { app, port } = await listen();
  const { client } = await joinGame(app, port, 'Аня');

  client.send(pos(SPAWN.x + 0.1, SPAWN.z, 1));
  client.send(pos(SPAWN.x + 100, SPAWN.z, 2));
  const fix = await client.nextOfType('correct');
  assert.equal(fix.x, SPAWN.x + 0.1);
  assert.equal(fix.z, SPAWN.z);
  assert.ok(MAX_SPEED * SPEED_TOLERANCE * 2 < 100);
  await app.close();
});

test('вертикальный телепорт: расстояние считается с Y, приходит correct', async () => {
  const { app, port } = await listen();
  const { client } = await joinGame(app, port, 'Аня');
  client.send({ ...pos(SPAWN.x, SPAWN.z, 1), y: 100 });
  const fix = await client.nextOfType('correct');
  assert.deepEqual([fix.x, fix.y, fix.z], [SPAWN.x, SPAWN.y, SPAWN.z]);
  client.send({ ...pos(SPAWN.x, SPAWN.z, 2), y: 0.2 });
  await client.next((m) => isPlayers(m) || m.t === 'correct', 150).catch(() => {});
  assert.equal(client.inbox.filter((m) => m.t === 'correct').length, 0, 'небольшой подъём допустим');
  await app.close();
});

test('лимит pos: 30 в секунду, остальное отбрасывается с rate_limit', async () => {
  const { app, port } = await listen();
  const { client } = await joinGame(app, port, 'Аня');
  for (let i = 0; i < 80; i++) client.send(pos(SPAWN.x, SPAWN.z, i));
  const err = await client.nextOfType('error');
  assert.equal(err.code, 'rate_limit');
  await app.close();
});

test('один активный сокет на пользователя: новое подключение отключает старое', async () => {
  const { app, port } = await listen();
  const first = await joinGame(app, port, 'Аня');
  const second = await TestClient.connect(port, await getTicket(app, first.token));
  assert.equal(await first.client.closed, CLOSE.REPLACED);
  second.send({ t: 'hello', ticket: 'x', proto: 1 });
  assert.equal((await second.nextOfType('welcome')).playerId, first.user.id);
  await app.close();
});

test('переподключение: позиция сохраняется, соседи получают player_leave', async () => {
  const { app, port } = await listen();
  const a = await joinGame(app, port, 'Аня');
  const b = await joinGame(app, port, 'Борис');
  await a.client.nextOfType('player_join');

  b.client.send(pos(SPAWN.x + 0.3, SPAWN.z + 0.3, 1));
  await a.client.next((m) => isPlayers(m) && m.list[0][1] === SPAWN.x + 0.3);
  await b.client.close();
  assert.equal((await a.client.nextOfType('player_leave')).id, b.user.id);

  const again = await TestClient.connect(port, await getTicket(app, b.token));
  again.send({ t: 'hello', ticket: 'x', proto: 1 });
  const welcome = await again.nextOfType('welcome');
  assert.equal(welcome.state.x, SPAWN.x + 0.3);
  assert.equal(welcome.state.z, SPAWN.z + 0.3);
  assert.equal((await a.client.nextOfType('player_join')).id, b.user.id);
  await app.close();
});

test('молчащий клиент отключается по ping/pong', async () => {
  const { app, port } = await listen({ pingMs: 50 });
  const { token } = await register(app, 'Аня');
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${await getTicket(app, token)}`, { autoPong: false });
  await once(ws, 'open');
  const client = new TestClient(ws);
  client.send({ t: 'hello', ticket: 'x', proto: 1 });
  await client.nextOfType('welcome');
  await client.closed;
  await app.close();
});

test('остановка сервера сохраняет позиции подключённых игроков', async () => {
  const { dbPath, cleanup } = tempDb();
  const { app, port } = await listen({ dbPath });
  try {
    const { client } = await joinGame(app, port, 'Аня');
    client.send(pos(SPAWN.x + 0.4, SPAWN.z, 1));
    await new Promise((r) => setTimeout(r, 100));
    await app.close();
    const saved = readPlayerState(dbPath, 'Аня');
    assert.equal(saved.x, SPAWN.x + 0.4);
    assert.equal(saved.z, SPAWN.z);
  } finally {
    cleanup();
  }
});

const CHUNK_TYPES = new Set(['chunk_unload', 'chunk_load', 'cache_stats']);
const isChunkMsg = (m) => CHUNK_TYPES.has(m.t);

/** Все сообщения чанков до очередного cache_stats включительно. */
async function nextChunkBatch(client) {
  const batch = [];
  for (;;) {
    const m = await client.next(isChunkMsg);
    batch.push(m);
    if (m.t === 'cache_stats') return batch;
  }
}

test('чанки: после welcome идут chunk_load и cache_stats в пределах лимитов', async () => {
  const { worldDir, cleanup } = tempWorld();
  const { app, port } = await listen({ worldDir });
  try {
    const { client } = await joinGame(app, port, 'Аня');
    const batch = await nextChunkBatch(client);
    const stats = batch.at(-1);
    const loads = batch.filter((m) => m.t === 'chunk_load');
    assert.equal(batch.filter((m) => m.t === 'chunk_unload').length, 0);
    assert.equal(loads.length, stats.loaded);
    assert.ok(loads.length >= 9 && stats.loaded <= stats.max);
    assert.ok(stats.bytes <= stats.bytesMax);
    assert.equal(stats.worldTotal, 144);
    assert.ok(loads.every((m) => m.data instanceof Uint8Array && m.data.length > 0));
    const sum = loads.reduce((acc, m) => acc + m.data.length, 0);
    assert.equal(sum, stats.bytes, 'байты в cache_stats совпадают с отправленными');
  } finally {
    await app.close();
    cleanup();
  }
});

test('чанки: переход, после которого набор не меняется, ничего не отправляет', async () => {
  const { worldDir, cleanup } = tempWorld();
  const { dbPath, cleanup: cleanupDb } = tempDb();
  const { app, port } = await listen({ worldDir, dbPath });
  try {
    await register(app, 'Тишина');
    seedPlayerState(dbPath, 'Тишина', { x: 7 * 64 - 0.2, y: 0, z: 6.5 * 64 }); // граница чанков 6 и 7
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { name: 'Тишина', password: 'secret' } });
    const client = await TestClient.connect(port, await getTicket(app, login.json().token));
    client.send({ t: 'hello', ticket: 'x', proto: 1 });
    await client.nextOfType('welcome');
    await nextChunkBatch(client);
    client.send(pos(7 * 64 + 0.2, 6.5 * 64, 1)); // чанк сменился, а нужный набор тот же
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(client.inbox.filter(isChunkMsg).length, 0);
  } finally {
    await app.close();
    cleanup();
    cleanupDb();
  }
});

test('чанки: при пересечении границы chunk_unload раньше chunk_load, cache_stats последний; в том же чанке тишина', async () => {
  const { worldDir, cleanup } = tempWorld();
  const { dbPath, cleanup: cleanupDb } = tempDb();
  const { app, port } = await listen({ worldDir, dbPath });
  try {
    await register(app, 'Граница');
    seedPlayerState(dbPath, 'Граница', { x: 10 * 64 - 0.2, y: 0, z: 6.5 * 64 }); // у края чанков 9 и 10
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { name: 'Граница', password: 'secret' } });
    const client = await TestClient.connect(port, await getTicket(app, login.json().token));
    client.send({ t: 'hello', ticket: 'x', proto: 1 });
    await client.nextOfType('welcome');
    const first = await nextChunkBatch(client);
    const loadedBefore = new Set(first.filter((m) => m.t === 'chunk_load').map((m) => `${m.cx}_${m.cz}`));

    client.send(pos(10 * 64 + 0.2, 6.5 * 64, 1));
    const batch = await nextChunkBatch(client);
    const types = batch.map((m) => m.t);
    const lastUnload = types.lastIndexOf('chunk_unload');
    const firstLoad = types.indexOf('chunk_load');
    assert.ok(lastUnload >= 0 && firstLoad >= 0, JSON.stringify(types));
    assert.ok(lastUnload < firstLoad, 'выгрузки идут раньше загрузок');
    assert.equal(types.at(-1), 'cache_stats');
    for (const m of batch.filter((x) => x.t === 'chunk_load')) {
      assert.ok(!loadedBefore.has(`${m.cx}_${m.cz}`), `чанк ${m.cx},${m.cz} отправлен повторно`);
    }
    const stats = batch.at(-1);
    assert.ok(stats.loaded <= stats.max && stats.bytes <= stats.bytesMax);

    // Шаг внутри того же чанка: новых сообщений о чанках нет.
    client.send(pos(10 * 64 + 0.4, 6.5 * 64, 2));
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(client.inbox.filter(isChunkMsg).length, 0);
  } finally {
    await app.close();
    cleanup();
    cleanupDb();
  }
});

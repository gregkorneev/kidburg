import test from 'node:test';
import assert from 'node:assert/strict';
import { listen, joinGame, seedPlayerState, tempDb, TestClient, getTicket } from './helpers.js';
import { BALL_HOMES, PROP_HOMES } from '../shared/interaction-contracts.js';
import { MECHANISMS } from '../shared/mechanisms.js';

const home = (id) => PROP_HOMES.find((p) => p.id === id);
const ball1 = BALL_HOMES[0];

/** Регистрирует игроков, затем запускает сервер заново с заданными позициями (как в ws-mechanisms.test.js). */
async function boot(places, options = {}) {
  const db = tempDb();
  let server = await listen({ dbPath: db.dbPath, ...options });
  for (const name of Object.keys(places)) await (await joinGame(server.app, server.port, name)).client.close();
  await server.app.close();
  for (const [name, state] of Object.entries(places)) seedPlayerState(db.dbPath, name, { y: 0, ry: 0, ...state });
  server = await listen({ dbPath: db.dbPath, ...options });
  const clients = {};
  for (const name of Object.keys(places)) clients[name] = (await joinGame(server.app, server.port, name)).client;
  return {
    db, server, clients,
    async stop() {
      await Promise.all(Object.values(clients).map((c) => c.close()));
      await server.app.close();
      db.cleanup();
    },
  };
}

let seq = 0;
const interact = async (client, id, action) => {
  client.send({ t: 'interact', id, action, seq: ++seq });
  return client.next((m) => m.t === 'interact_result' && m.seq === seq);
};
const propState = async (client, id, match = () => true) => (await client.next((m) => m.t === 'prop_state' && m.prop.id === id && match(m.prop))).prop;

test('hello: игрок получает все предметы и мячи', async () => {
  const w = await boot({ Ася: { x: 372, z: 429 } });
  try {
    const { list } = await w.clients.Ася.nextOfType('prop_snapshot');
    assert.equal(list.length, PROP_HOMES.length);
    assert.ok(list.every((p) => p.state === 'available' && p.holder === 0));
    assert.ok(list.some((p) => p.type === 'crate') && list.some((p) => p.type === 'cone') && list.some((p) => p.type === 'pot'));
  } finally { await w.stop(); }
});

test('предмет: взял — другой не может, поставил — другой взял; все видят владельца', async () => {
  const c = home('crate-1');
  const w = await boot({ Ася: { x: c.x + 1, z: c.z, ry: Math.PI / 2 }, Боря: { x: c.x, z: c.z + 1.2 } });
  const { Ася, Боря } = w.clients;
  try {
    const taken = Promise.all([propState(Ася, 'crate-1', (p) => p.state === 'held'), propState(Боря, 'crate-1', (p) => p.state === 'held')]);
    const r1 = await interact(Ася, 'crate-1', 'take');
    assert.equal(r1.ok, true);
    const [seenByA, seenByB] = await taken;
    assert.equal(seenByA.holder, seenByB.holder);
    assert.ok(seenByB.holder > 0);

    const r2 = await interact(Боря, 'crate-1', 'take');
    assert.equal(r2.ok, false);
    assert.equal(r2.code, 'busy');

    const r3 = await interact(Боря, 'cone-1', 'take');
    assert.equal(r3.code, 'too_far');

    const placed = propState(Боря, 'crate-1', (p) => p.state === 'placed');
    const r4 = await interact(Ася, 'crate-1', 'place');
    assert.equal(r4.ok, true, r4.message);
    const p = await placed;
    assert.equal(p.holder, 0);
    // Ася смотрит в −X (ry = π/2): ящик встал перед ней
    assert.ok(p.x < c.x + 1, `предмет впереди игрока: ${p.x}`);

    const r5 = await interact(Боря, 'crate-1', 'take');
    assert.equal(r5.ok, true);
    assert.equal((await interact(Боря, 'crate-1', 'place')).ok, true);
  } finally { await w.stop(); }
});

test('одновременное взятие двумя игроками: успешно ровно одно', async () => {
  const c = home('crate-2');
  const w = await boot({ Ася: { x: c.x + 1, z: c.z }, Боря: { x: c.x, z: c.z + 1 } });
  try {
    seq += 1;
    const mine = seq;
    w.clients.Ася.send({ t: 'interact', id: 'crate-2', action: 'take', seq: mine });
    w.clients.Боря.send({ t: 'interact', id: 'crate-2', action: 'take', seq: mine });
    const results = await Promise.all([w.clients.Ася, w.clients.Боря].map((cl) => cl.next((m) => m.t === 'interact_result' && m.seq === mine)));
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(results.filter((r) => !r.ok && r.code === 'busy').length, 1);
  } finally { await w.stop(); }
});

test('руки заняты: второй предмет взять нельзя; положить нечего — отказ', async () => {
  const c = home('crate-1');
  const w = await boot({ Ася: { x: c.x + 0.8, z: c.z - 0.9 } });
  const { Ася } = w.clients;
  try {
    assert.equal((await interact(Ася, 'crate-1', 'place')).code, 'not_holding');
    assert.equal((await interact(Ася, 'crate-1', 'take')).ok, true);
    assert.equal((await interact(Ася, 'crate-2', 'take')).code, 'hands_full');
  } finally { await w.stop(); }
});

test('недопустимая точка: предмет остаётся в руках', async () => {
  // Игрок стоит у края мира: перед ним запрещённая зона. Берёт предмет и пытается поставить.
  const c = home('crate-1');
  const w = await boot({ Ася: { x: c.x + 1, z: c.z } });
  const { Ася } = w.clients;
  try {
    assert.equal((await interact(Ася, 'crate-1', 'take')).ok, true);
    // Встаём к краю мира (позиция телепортом не допускается, поэтому проверяем через серверную логику напрямую).
    const prop = w.server.app.interactive.heldBy(w.server.app.interactive.props().find((p) => p.id === 'crate-1').holder);
    assert.equal(prop.id, 'crate-1');
    const refused = w.server.app.interactive.place({ id: prop.holder, x: 2, z: 2, ry: 0 }, 'crate-1');
    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'blocked');
    assert.equal(w.server.app.interactive.heldBy(prop.holder)?.id, 'crate-1', 'предмет не потерян');
  } finally { await w.stop(); }
});

test('отключение с предметом: он возвращается на безопасное место и виден остальным', async () => {
  const c = home('pot-1');
  const w = await boot({ Ася: { x: c.x + 1, z: c.z }, Боря: { x: c.x + 2, z: c.z + 1 } });
  try {
    assert.equal((await interact(w.clients.Ася, 'pot-1', 'take')).ok, true);
    await propState(w.clients.Боря, 'pot-1', (p) => p.state === 'held');
    const released = propState(w.clients.Боря, 'pot-1', (p) => p.holder === 0);
    await w.clients.Ася.close();
    const p = await released;
    assert.equal(p.state, 'available');
    assert.deepEqual([p.x, p.z], [c.x, c.z]);
    assert.equal((await interact(w.clients.Боря, 'pot-1', 'take')).ok, true, 'предмет снова доступен');
  } finally { await w.stop(); }
});

test('поставленный предмет сохраняется после перезапуска сервера; предмет в руках — нет', async () => {
  const c = home('crate-1');
  const w = await boot({ Ася: { x: c.x + 1, z: c.z, ry: Math.PI / 2 } });
  let placed;
  try {
    await interact(w.clients.Ася, 'crate-1', 'take');
    const r = await interact(w.clients.Ася, 'crate-1', 'place');
    assert.equal(r.ok, true, r.message);
    placed = w.server.app.interactive.propRows().find((p) => p.id === 'crate-1');
    assert.equal(placed.state, 'placed');
    await interact(w.clients.Ася, 'crate-2', 'take').catch(() => null);
  } finally {
    await Promise.all(Object.values(w.clients).map((cl) => cl.close()));
    await w.server.app.close();
  }
  const again = await listen({ dbPath: w.db.dbPath });
  try {
    const rows = again.app.interactive.propRows();
    const crate1 = rows.find((p) => p.id === 'crate-1');
    assert.deepEqual([crate1.x, crate1.z, crate1.state], [placed.x, placed.z, 'placed']);
    assert.ok(rows.every((p) => p.holder === 0 && p.state !== 'held'));
  } finally {
    await again.app.close();
    w.db.cleanup();
  }
});

test('футбол: двое поочерёдно бьют один мяч, оба видят общее состояние', async () => {
  const places = {
    Ася: { x: ball1.x - 1, z: ball1.z, ry: -Math.PI / 2 }, // смотрит в +X
    Боря: { x: ball1.x + 6, z: ball1.z, ry: Math.PI / 2 }, // смотрит в −X
  };
  const w = await boot(places);
  const { Ася, Боря } = w.clients;
  try {
    const startA = await Ася.nextOfType('ball_snapshot');
    const startB = await Боря.nextOfType('ball_snapshot');
    assert.equal(startA.list.length, BALL_HOMES.length);
    assert.equal(startA.list[0][7] & 1, 1, 'мячи стоят');
    assert.deepEqual(startA.list, startB.list);

    const kickA = Боря.next((m) => m.t === 'ball_event' && m.kind === 'kick');
    const r1 = await interact(Ася, 'ball-1', 'kick');
    assert.equal(r1.ok, true, r1.message);
    const ev1 = await kickA;
    assert.equal(ev1.id, 'ball-1');
    assert.ok(ev1.by > 0);

    // оба получают движущийся мяч с положительной скоростью по X
    const flyingA = await Ася.next((m) => m.t === 'ball_snapshot' && m.list.some((r) => r[0] === 'ball-1' && r[4] > 3));
    const flyingB = await Боря.next((m) => m.t === 'ball_snapshot' && m.list.some((r) => r[0] === 'ball-1' && r[4] > 3));
    assert.ok(flyingA && flyingB);

    // Боря бьёт, когда мяч доходит до него
    const near = await Боря.next((m) => m.t === 'ball_snapshot' && m.list.some((r) => r[0] === 'ball-1' && r[1] > ball1.x + 3));
    void near;
    const r2 = await interact(Боря, 'ball-1', 'kick');
    assert.equal(r2.ok, true, r2.message);
    const back = await Ася.next((m) => m.t === 'ball_snapshot' && m.list.some((r) => r[0] === 'ball-1' && r[4] < -3));
    const row = back.list.find((r) => r[0] === 'ball-1');
    assert.ok(row[1] > ball1.x - 5 && row[1] < ball1.x + 30, 'координаты правдоподобны');
    for (const v of row.slice(1, 7)) assert.ok(Number.isFinite(v));
  } finally { await w.stop(); }
});

test('футбол: удар вдалеке, чужой id, частота и произвольные поля не действуют', async () => {
  const w = await boot({ Ася: { x: ball1.x + 12, z: ball1.z }, Боря: { x: ball1.x - 1, z: ball1.z, ry: -Math.PI / 2 } });
  const { Ася, Боря } = w.clients;
  try {
    assert.equal((await interact(Ася, 'ball-1', 'kick')).code, 'too_far');
    assert.equal((await interact(Ася, 'ball-99', 'kick')).code, 'unknown');
    // клиентская «сила»/«координаты» игнорируются: берётся только id и действие
    seq += 1;
    Боря.send({ t: 'interact', id: 'ball-1', action: 'kick', seq, vx: 9999, vy: 9999, x: 0, z: 0, power: 1e9 });
    const r = await Боря.next((m) => m.t === 'interact_result' && m.seq === seq);
    assert.equal(r.ok, true);
    const ball = w.server.app.interactive.balls.get('ball-1');
    assert.ok(Math.hypot(ball.vx, ball.vy, ball.vz) <= 20, 'скорость в пределах физики сервера');
    assert.equal((await interact(Боря, 'ball-1', 'kick')).code, 'cooldown', 'частые удары отбрасываются');
  } finally { await w.stop(); }
});

test('поздний игрок получает актуальное движущееся состояние мяча', async () => {
  const w = await boot({ Ася: { x: ball1.x - 1, z: ball1.z, ry: -Math.PI / 2 }, Поздний: { x: ball1.x + 5, z: ball1.z + 4 } });
  try {
    // Поздний уже в игре из boot(); отключаем его и подключаем заново во время движения мяча
    await w.clients.Поздний.close();
    assert.equal((await interact(w.clients.Ася, 'ball-1', 'kick')).ok, true);
    await new Promise((r) => setTimeout(r, 150));
    const late = (await joinGame(w.server.app, w.server.port, 'Поздний')).client;
    w.clients.Поздний = late;
    const snap = await late.nextOfType('ball_snapshot');
    const row = snap.list.find((r) => r[0] === 'ball-1');
    assert.equal(row[7] & 1, 0, 'мяч в движении');
    assert.ok(row[1] > ball1.x, 'мяч уже покатился');
  } finally { await w.stop(); }
});

test('interact без hello и с неверной схемой отклоняется', async () => {
  const w = await boot({ Ася: { x: 372, z: 429 } });
  try {
    const res = await w.server.app.inject({ method: 'POST', url: '/api/join', payload: { name: 'Гость', room: w.server.app.room.code } });
    const { token } = res.json();
    const raw = await TestClient.connect(w.server.port, await getTicket(w.server.app, token));
    raw.send({ t: 'interact', id: 'ball-1', action: 'kick', seq: 1 });
    const err = await raw.nextOfType('error');
    assert.equal(err.code, 'unauth');
    await raw.closed;

    w.clients.Ася.send({ t: 'interact', id: 'ball-1', action: 'teleport', seq: 1 });
    assert.equal((await w.clients.Ася.nextOfType('error')).code, 'bad_msg');
    w.clients.Ася.send({ t: 'interact', id: 'x'.repeat(200), action: 'take', seq: 1 });
    assert.equal((await w.clients.Ася.nextOfType('error')).code, 'bad_msg');
  } finally { await w.stop(); }
});

test('дверь: открывается рядом, не открывается издали, закрывается сама', async () => {
  let clock = 1_000_000;
  const spec = MECHANISMS['door-bakery'];
  const w = await boot({ Ася: { x: spec.x, z: spec.z }, Боря: { x: 10, z: 10 } }, { now: () => clock });
  const { Ася, Боря } = w.clients;
  try {
    Боря.send({ t: 'mech_set', id: 'door-bakery', active: true });
    assert.equal((await Боря.nextOfType('error')).code, 'too_far');
    const seen = Боря.nextOfType('mech_state');
    Ася.send({ t: 'mech_set', id: 'door-bakery', active: true });
    const open = await Ася.nextOfType('mech_state');
    assert.equal(open.active, true);
    assert.equal((await seen).id, 'door-bakery');
    clock += 13_000;
    const closed = await Ася.next((m) => m.t === 'mech_state' && m.id === 'door-bakery' && m.active === false, 3000);
    assert.equal(closed.active, false);
  } finally { await w.stop(); }
});

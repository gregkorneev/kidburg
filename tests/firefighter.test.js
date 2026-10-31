// Задание станции «Пожарный» по WebSocket: прогресс в SQLite, владелец и позиция берутся у сервера.

import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db/index.js';
import { FIREFIGHTER_TASK_ID } from '../server/tasks/firefighter_station_v1.js';
import { WORLD_POINTS } from '../client/stations/firefighter/layout.js';
import { TestClient, getTicket, join, listen, readPlayerState, seedPlayerState, tempDb } from './helpers.js';

const isTaskState = (m) => m.t === 'task_state' && m.taskId === FIREFIGHTER_TASK_ID;
const yawTo = (from, to) => Math.atan2(-(to.x - from.x), -(to.z - from.z));
const at = (p, dx = 0, dz = 0) => ({ x: p.x + dx, y: 0, z: p.z + dz });
const answer = (action, extra = {}) => ({ t: 'task_answer', taskId: FIREFIGHTER_TASK_ID, payload: { action, ...extra } });

/** Сервер снимает игрока с учёта чуть позже, чем клиент видит закрытие сокета: имя ненадолго занято. */
async function joinWhenFree(app, name) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await join(app, name);
    } catch (err) {
      if (attempt >= 40 || !String(err.message).includes('name_taken')) throw err;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

/** Подключает игрока (вход по коду комнаты; имя создаётся при первом входе); позиция из базы — перед hello. */
async function connect(app, port, name, { dbPath, position, ry = 0 } = {}) {
  const session = await joinWhenFree(app, name);
  if (position) seedPlayerState(dbPath, name, { ...position, ry });
  const client = await TestClient.connect(port, await getTicket(app, session.token));
  client.send({ t: 'hello', ticket: 'x', proto: 1 });
  const welcome = await client.nextOfType('welcome');
  const initial = await client.next(isTaskState);
  return { client, welcome, initial, user: session.user };
}

async function ask(client, action, extra) {
  client.send(answer(action, extra));
  return (await client.next(isTaskState)).state;
}

const readProgress = (dbPath, name) => {
  const db = openDb(dbPath);
  const row = db.getTaskProgress(db.findUserByName(name).id, FIREFIGHTER_TASK_ID);
  db.close();
  return row;
};

async function withServer(overrides, run) {
  const { dbPath, cleanup } = tempDb();
  const { app, port } = await listen({ dbPath, ...overrides });
  const clients = [];
  try {
    await run({ app, port, dbPath, track: (c) => (clients.push(c), c) });
  } finally {
    for (const c of clients) c.ws.terminate();
    await app.close();
    cleanup();
  }
}

test('после hello сервер присылает task_state; новый игрок начинает с not_started', async () => {
  await withServer({}, async ({ app, port, track }) => {
    const { client, initial } = await connect(app, port, 'Аня');
    track(client);
    assert.equal(initial.t, 'task_state');
    assert.equal(initial.state.stage, 'not_started');
    assert.equal(initial.state.done, false);
    assert.deepEqual(Object.keys(initial.state).sort(), ['carryingMannequin', 'changed', 'done', 'equipped', 'feedback', 'fireHits', 'mannequinDelivered', 'stage']);
  });
});

test('прогресс сохраняется и восстанавливается: перезагрузка страницы, другое соединение, перезапуск сервера', async () => {
  const { dbPath, cleanup } = tempDb();
  try {
    const first = await listen({ dbPath });
    const a = await connect(first.app, first.port, 'Аня', { dbPath, position: at(WORLD_POINTS.npc) });
    assert.equal((await ask(a.client, 'start')).stage, 'briefing');
    assert.equal((await ask(a.client, 'accept_briefing')).stage, 'equipping');
    await a.client.close();

    // Перезагрузка страницы: то же имя, новое соединение, тот же сервер.
    const b = await connect(first.app, first.port, 'Аня');
    assert.equal(b.initial.state.stage, 'equipping');
    assert.equal(b.initial.state.changed, false);
    await b.client.close();
    await first.app.close();

    // Перезапуск сервера: прогресс в файле базы.
    const second = await listen({ dbPath });
    const c = await connect(second.app, second.port, 'Аня');
    assert.equal(c.initial.state.stage, 'equipping');
    assert.equal(readProgress(dbPath, 'Аня').state.stage, 'equipping');
    c.client.ws.terminate();
    await second.app.close();
  } finally {
    cleanup();
  }
});

test('два аккаунта: прогресс изолирован, одновременная игра не смешивает состояния', async () => {
  await withServer({}, async ({ app, port, dbPath, track }) => {
    const anna = track((await connect(app, port, 'Аня', { dbPath, position: at(WORLD_POINTS.npc) })).client);
    const boris = track((await connect(app, port, 'Борис', { dbPath, position: at(WORLD_POINTS.npc, 1, 0) })).client);
    assert.equal((await ask(anna, 'start')).stage, 'briefing');
    assert.equal((await ask(anna, 'accept_briefing')).stage, 'equipping');
    assert.equal((await ask(boris, 'start')).stage, 'briefing');
    assert.equal(readProgress(dbPath, 'Аня').state.stage, 'equipping');
    assert.equal(readProgress(dbPath, 'Борис').state.stage, 'briefing');
    assert.equal((await ask(anna, 'resume')).stage, 'equipping');
    assert.equal((await ask(boris, 'resume')).stage, 'briefing');
  });
});

test('подмена через payload: userId, состояние, done и координаты не принимаются', async () => {
  await withServer({}, async ({ app, port, dbPath, track }) => {
    const borisConn = await connect(app, port, 'Борис', { dbPath, position: at(WORLD_POINTS.npc, 300, 0) });
    track(borisConn.client);
    const anna = track((await connect(app, port, 'Аня', { dbPath, position: at(WORLD_POINTS.npc, 300, 0) })).client);

    const forged = {
      userId: borisConn.user.id,
      state: { stage: 'completed', equipped: true, fireHits: 18, carryingMannequin: false, mannequinDelivered: true },
      done: true,
      progress: 1,
      x: WORLD_POINTS.npc.x,
      y: 0,
      z: WORLD_POINTS.npc.z,
      position: at(WORLD_POINTS.npc),
    };
    // Аня далеко от Маруси: подставленная позиция не работает.
    const far = await ask(anna, 'start', forged);
    assert.equal(far.stage, 'not_started');
    assert.equal(far.changed, false);
    assert.equal(readProgress(dbPath, 'Аня'), null);
    assert.equal(readProgress(dbPath, 'Борис'), null);

    // Поддельное состояние вместо action тоже ничего не делает.
    anna.send({ t: 'task_answer', taskId: FIREFIGHTER_TASK_ID, payload: forged });
    assert.equal((await anna.next(isTaskState)).state.stage, 'not_started');
    anna.send({ t: 'task_answer', taskId: FIREFIGHTER_TASK_ID, payload: 'completed', userId: borisConn.user.id, state: forged.state });
    assert.equal((await anna.next(isTaskState)).state.stage, 'not_started');
    assert.equal(readProgress(dbPath, 'Борис'), null);
  });
});

test('нельзя телепортироваться к Марусе через pos: сервер вернёт игрока и не засчитает действие', async () => {
  await withServer({}, async ({ app, port, dbPath, track }) => {
    const { client } = await connect(app, port, 'Аня', { dbPath, position: at(WORLD_POINTS.npc, 200, 0) });
    track(client);
    const npc = at(WORLD_POINTS.npc);
    client.send({ t: 'pos', ...npc, ry: 0, anim: 0, seq: 1 });
    const fix = await client.nextOfType('correct');
    assert.ok(Math.abs(fix.x - (WORLD_POINTS.npc.x + 200)) < 1e-9, 'сервер оставил игрока на прежнем месте');
    const state = await ask(client, 'start');
    assert.equal(state.stage, 'not_started');
    assert.equal(state.changed, false);
  });
});

test('позиция и порядок этапов: действия вне зоны и не по порядку не меняют прогресс', async () => {
  await withServer({}, async ({ app, port, dbPath, track }) => {
    const { client } = await connect(app, port, 'Аня', { dbPath, position: at(WORLD_POINTS.locker) });
    track(client);
    // У шкафа: до инструктажа экипироваться нельзя.
    assert.equal((await ask(client, 'equip')).stage, 'not_started');
    // У шкафа, а не у Маруси: start не засчитывается.
    assert.equal((await ask(client, 'start')).stage, 'not_started');
    // Остальные этапы вне очереди.
    for (const action of ['accept_briefing', 'fire_hit', 'pickup_mannequin', 'deliver_mannequin', 'report', 'completed', 'nope']) {
      const s = await ask(client, action);
      assert.equal(s.stage, 'not_started', action);
      assert.equal(s.changed, false, action);
    }
    assert.equal(readProgress(dbPath, 'Аня'), null, 'ничего не записано');
  });
});

test('тушение: нужны зона у рукава и взгляд на мишень, до этапа rescue', async () => {
  await withServer({}, async ({ app, port, dbPath, track }) => {
    const spot = at(WORLD_POINTS.hose, 1.5, 0);
    const aimed = yawTo(spot, WORLD_POINTS.target);
    // Игрок у Маруси проходит инструктаж, потом переходит (позиции шлёт обычным pos).
    const { client } = await connect(app, port, 'Аня', { dbPath, position: at(WORLD_POINTS.npc) });
    track(client);
    await ask(client, 'start');
    await ask(client, 'accept_briefing');

    // pos в пределах скорости: идём к шкафу короткими шагами (около 8 м в секунду, лимит 30 pos/с).
    let seq = 0;
    const walk = async (from, to) => {
      const steps = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.25);
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        client.send({ t: 'pos', x: from.x + (to.x - from.x) * k, y: 0, z: from.z + (to.z - from.z) * k, ry: aimed, anim: 1, seq: ++seq });
        await new Promise((r) => setTimeout(r, 40));
      }
    };
    await walk(at(WORLD_POINTS.npc), at(WORLD_POINTS.locker));
    assert.equal((await ask(client, 'equip')).stage, 'fire_drill');
    await walk(at(WORLD_POINTS.locker), spot);

    // Смотрим мимо мишени: не засчитывается.
    client.send({ t: 'pos', ...spot, ry: aimed + 1.5, anim: 0, seq: ++seq });
    assert.equal((await ask(client, 'fire_hit')).fireHits, 0);
    // Смотрим на мишень: засчитывается; ограничение частоты не даёт набрать быстрее раза в 120 мс.
    client.send({ t: 'pos', ...spot, ry: aimed, anim: 0, seq: ++seq });
    const first = await ask(client, 'fire_hit');
    assert.equal(first.fireHits, 1);
    assert.equal(first.changed, true);
    const quick = await ask(client, 'fire_hit');
    assert.equal(quick.fireHits, 1, 'второе попадание сразу же не засчитывается');
    for (let i = 0; i < 17; i++) {
      await new Promise((r) => setTimeout(r, 130));
      await ask(client, 'fire_hit');
    }
    const rescue = await ask(client, 'resume');
    assert.equal(rescue.stage, 'rescue');
    assert.equal(rescue.fireHits, 18);
    assert.equal(readProgress(dbPath, 'Аня').state.stage, 'rescue');
    assert.equal(readProgress(dbPath, 'Аня').done, false);
  });
});

test('ошибка базы данных: клиент получает error и прежнее состояние, ложного подтверждения нет', async () => {
  const db = openDb(':memory:');
  const control = { failSave: false, failRead: false };
  const flaky = new Proxy(db, {
    get(target, prop) {
      if (prop === 'saveTaskProgress' && control.failSave) return () => { throw new Error('disk full'); };
      if (prop === 'getTaskProgress' && control.failRead) return () => { throw new Error('db locked'); };
      return target[prop];
    },
  });
  const { app, port } = await listen({ db: flaky });
  let client;
  try {
    const user = await join(app, 'Аня');
    db.savePlayerState({ userId: user.user.id, ...at(WORLD_POINTS.npc), ry: 0 });
    client = await TestClient.connect(port, await getTicket(app, user.token));
    client.send({ t: 'hello', ticket: 'x', proto: 1 });
    await client.nextOfType('welcome');
    await client.next(isTaskState);

    assert.equal((await ask(client, 'start')).stage, 'briefing');
    control.failSave = true;
    const failed = await ask(client, 'accept_briefing');
    assert.equal(failed.error, 'storage');
    assert.equal(failed.changed, false);
    assert.equal(failed.stage, 'briefing', 'клиент не видит неподтверждённого перехода');
    assert.equal(db.getTaskProgress(user.user.id, FIREFIGHTER_TASK_ID).state.stage, 'briefing');

    control.failSave = false;
    control.failRead = true;
    client.send(answer('accept_briefing'));
    const unreadable = (await client.next(isTaskState)).state;
    assert.equal(unreadable.error, 'storage');
    assert.equal(unreadable.stage, undefined, 'при недоступной базе состояние не выдумывается');

    control.failRead = false;
    assert.equal((await ask(client, 'accept_briefing')).stage, 'equipping', 'после починки базы всё работает');
  } finally {
    client?.ws.terminate();
    await app.close();
  }
});

test('некорректные сообщения: неизвестное задание, нет payload, лимит частоты', async () => {
  await withServer({}, async ({ app, port, dbPath, track }) => {
    const { client } = await connect(app, port, 'Аня', { dbPath, position: at(WORLD_POINTS.npc) });
    track(client);
    client.send({ t: 'task_answer', taskId: 'other_task', payload: { action: 'start' } });
    assert.equal((await client.nextOfType('error')).code, 'bad_msg');
    client.send({ t: 'task_answer', taskId: FIREFIGHTER_TASK_ID });
    assert.equal((await client.nextOfType('error')).code, 'bad_msg');
    client.send({ t: 'task_answer', payload: { action: 'start' } });
    assert.equal((await client.nextOfType('error')).code, 'bad_msg');
    assert.equal(readProgress(dbPath, 'Аня'), null);

    for (let i = 0; i < 40; i++) client.send(answer('resume'));
    assert.equal((await client.nextOfType('error')).code, 'rate_limit');
    assert.equal(readPlayerState(dbPath, 'Аня') !== null, true);
  });
});

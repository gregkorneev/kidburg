// Задание станции «Пожарный» по WebSocket: прогресс в SQLite, владелец и позиция берутся у сервера.

import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db/index.js';
import { FIREFIGHTER_TASK_ID } from '../server/tasks/firefighter_station_v1.js';
import { WORLD_POINTS, WORLD_WINDOWS, toWorld } from '../client/stations/firefighter/layout.js';
import { WINDOW_COUNT, WINDOW_HIT_LIMIT } from '../client/stations/firefighter/state.js';
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
async function connect(app, port, name, { dbPath, position, ry = 0, progress } = {}) {
  const session = await joinWhenFree(app, name);
  if (position) seedPlayerState(dbPath, name, { ...position, ry });
  if (progress) seedProgress(dbPath, name, progress);
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

/** Записывает состояние задания, как если бы игрок уже дошёл до этого места (старый или новый формат). */
function seedProgress(dbPath, name, state, done = false) {
  const db = openDb(dbPath);
  db.saveTaskProgress(db.findUserByName(name).id, FIREFIGHTER_TASK_ID, { state, done });
  db.close();
}

const drill = (windows) => ({ stage: 'fire_drill', equipped: true, windows, carryingMannequin: false, mannequinDelivered: false });
/** Место у рукава за линией безопасности и взгляд на окно (yaw: 0 вдоль −Z). */
const spotAtHose = () => ({ ...toWorld(3.5, 6.5), y: 0 });
const aimAt = (spot, index) => yawTo(spot, WORLD_WINDOWS[index]);

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
    assert.deepEqual(initial.state.windows, [0, 0, 0, 0]);
    assert.deepEqual(Object.keys(initial.state).sort(), ['carryingMannequin', 'changed', 'done', 'equipped', 'feedback', 'mannequinDelivered', 'stage', 'windows']);
  });
});

test('подтверждённая экипировка сразу рассылается игрокам в зоне видимости', async () => {
  await withServer({}, async ({ app, port, dbPath, track }) => {
    const equipping = {
      stage: 'equipping', equipped: false, windows: [0, 0, 0, 0],
      carryingMannequin: false, mannequinDelivered: false,
    };
    const anna = await connect(app, port, 'Аня', {
      dbPath,
      position: at(WORLD_POINTS.locker),
      progress: equipping,
    });
    track(anna.client);
    const boris = await connect(app, port, 'Борис', { dbPath, position: at(WORLD_POINTS.locker, 1, 0) });
    track(boris.client);
    const join = await boris.client.next((m) => m.t === 'player_join' && m.id === anna.user.id);
    assert.equal(join.appearance.firefighterEquipped, false);

    assert.equal((await ask(anna.client, 'equip')).equipped, true);
    const changed = await boris.client.next((m) => m.t === 'player_appearance' && m.id === anna.user.id);
    assert.equal(changed.appearance.firefighterEquipped, true);
  });
});

test('поздний вход и переподключение получают экипировку из сохранённого состояния', async () => {
  await withServer({}, async ({ app, port, dbPath, track }) => {
    const equipped = {
      stage: 'fire_drill', equipped: true, windows: [0, 0, 0, 0],
      carryingMannequin: false, mannequinDelivered: false,
    };
    const anna = await connect(app, port, 'Аня', { dbPath, position: at(WORLD_POINTS.locker) });
    track(anna.client);
    const boris = await connect(app, port, 'Борис', {
      dbPath,
      position: at(WORLD_POINTS.locker, 1, 0),
      progress: equipped,
    });
    track(boris.client);
    let join = await anna.client.next((m) => m.t === 'player_join' && m.id === boris.user.id);
    assert.equal(join.appearance.firefighterEquipped, true);

    await boris.client.close();
    await anna.client.next((m) => m.t === 'player_leave' && m.id === boris.user.id);
    const reconnected = await connect(app, port, 'Борис', { dbPath, position: at(WORLD_POINTS.locker, 1, 0) });
    track(reconnected.client);
    join = await anna.client.next((m) => m.t === 'player_join' && m.id === reconnected.user.id);
    assert.equal(join.appearance.firefighterEquipped, true);
  });
});

test('отклонённая экипировка не меняет внешность удалённых игроков', async () => {
  await withServer({}, async ({ app, port, dbPath, track }) => {
    const equipping = {
      stage: 'equipping', equipped: false, windows: [0, 0, 0, 0],
      carryingMannequin: false, mannequinDelivered: false,
    };
    const anna = await connect(app, port, 'Аня', { dbPath, position: at(WORLD_POINTS.npc), progress: equipping });
    track(anna.client);
    const boris = await connect(app, port, 'Борис', { dbPath, position: at(WORLD_POINTS.npc, 1, 0) });
    track(boris.client);
    await boris.client.next((m) => m.t === 'player_join' && m.id === anna.user.id);

    const result = await ask(anna.client, 'equip');
    assert.equal(result.equipped, false);
    assert.equal(boris.client.inbox.some((m) => m.t === 'player_appearance' && m.id === anna.user.id), false);
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
      state: { stage: 'completed', equipped: true, windows: [12, 12, 12, 12], carryingMannequin: false, mannequinDelivered: true },
      windows: [12, 12, 12, 12],
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
    for (const action of ['accept_briefing', 'window_hit', 'fire_hit', 'pickup_mannequin', 'deliver_mannequin', 'report', 'completed', 'nope']) {
      const s = await ask(client, action);
      assert.equal(s.stage, 'not_started', action);
      assert.equal(s.changed, false, action);
    }
    assert.equal(readProgress(dbPath, 'Аня'), null, 'ничего не записано');
  });
});

test('тушение: нужны зона у рукава, индекс и взгляд на окно; до этапа rescue', async () => {
  await withServer({}, async ({ app, port, dbPath, track }) => {
    const spot = spotAtHose();
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
        client.send({ t: 'pos', x: from.x + (to.x - from.x) * k, y: 0, z: from.z + (to.z - from.z) * k, ry: 0, anim: 1, seq: ++seq });
        await new Promise((r) => setTimeout(r, 40));
      }
    };
    await walk(at(WORLD_POINTS.npc), at(WORLD_POINTS.locker));
    assert.equal((await ask(client, 'equip')).stage, 'fire_drill');
    await walk(at(WORLD_POINTS.locker), spot);

    const look = (index, delta = 0) => client.send({ t: 'pos', ...spot, ry: aimAt(spot, index) + delta, anim: 0, seq: ++seq });

    // Взгляд мимо окна, индекс вне диапазона и без индекса: не засчитывается.
    look(0, 1.5);
    assert.deepEqual((await ask(client, 'window_hit', { index: 0 })).windows, [0, 0, 0, 0]);
    look(0);
    for (const index of [-1, 4, 1.5, '0', null]) {
      const bad = await ask(client, 'window_hit', { index });
      assert.equal(bad.changed, false, String(index));
      assert.deepEqual(bad.windows, [0, 0, 0, 0]);
    }
    assert.equal((await ask(client, 'window_hit')).changed, false, 'без индекса');
    // Смотрим на левое окно, а бьём по правому.
    assert.equal((await ask(client, 'window_hit', { index: 1 })).changed, false);

    // Смотрим на окно 0: засчитывается; ограничение частоты не даёт набрать быстрее раза в 120 мс.
    const first = await ask(client, 'window_hit', { index: 0 });
    assert.deepEqual(first.windows, [1, 0, 0, 0]);
    assert.equal(first.changed, true);
    assert.equal(first.feedback, '');
    const quick = await ask(client, 'window_hit', { index: 0 });
    assert.deepEqual(quick.windows, [1, 0, 0, 0], 'второе попадание сразу же не засчитывается');
    for (let i = 1; i < WINDOW_HIT_LIMIT; i++) {
      await new Promise((r) => setTimeout(r, 130));
      await ask(client, 'window_hit', { index: 0 });
    }
    const afterFirst = await ask(client, 'resume');
    assert.equal(afterFirst.stage, 'fire_drill', 'одно окно из четырёх — этап не завершён');
    assert.deepEqual(afterFirst.windows, [WINDOW_HIT_LIMIT, 0, 0, 0]);
    await new Promise((r) => setTimeout(r, 130));
    assert.equal((await ask(client, 'window_hit', { index: 0 })).changed, false, 'потушенное окно');
    assert.deepEqual(readProgress(dbPath, 'Аня').state.windows, [WINDOW_HIT_LIMIT, 0, 0, 0]);
    assert.equal(readProgress(dbPath, 'Аня').done, false);
  });
});

test('состояние окон сохраняется и восстанавливается: перезагрузка страницы и перезапуск сервера', async () => {
  const { dbPath, cleanup } = tempDb();
  const spot = spotAtHose();
  try {
    const first = await listen({ dbPath });
    const a = await connect(first.app, first.port, 'Аня', { dbPath, position: spot, ry: aimAt(spot, 2), progress: drill([12, 0, 5, 0]) });
    assert.deepEqual(a.initial.state.windows, [12, 0, 5, 0], 'после входа сервер присылает окна');
    const hit = await ask(a.client, 'window_hit', { index: 2 });
    assert.deepEqual(hit.windows, [12, 0, 6, 0]);
    await a.client.close();

    // Перезагрузка страницы / вход с другого клиента: то же имя, новое соединение.
    const b = await connect(first.app, first.port, 'Аня');
    assert.equal(b.initial.state.stage, 'fire_drill');
    assert.deepEqual(b.initial.state.windows, [12, 0, 6, 0]);
    assert.equal(b.initial.state.changed, false);
    assert.deepEqual((await ask(b.client, 'resume')).windows, [12, 0, 6, 0]);
    await b.client.close();
    await first.app.close();

    // Перезапуск сервера: состояние окон в файле базы.
    const second = await listen({ dbPath });
    const c = await connect(second.app, second.port, 'Аня');
    assert.deepEqual(c.initial.state.windows, [12, 0, 6, 0]);
    assert.deepEqual(readProgress(dbPath, 'Аня').state.windows, [12, 0, 6, 0]);
    c.client.ws.terminate();
    await second.app.close();
  } finally {
    cleanup();
  }
});

test('окна разных аккаунтов изолированы при одновременной игре', async () => {
  await withServer({}, async ({ app, port, dbPath, track }) => {
    const spot = spotAtHose();
    const near = { ...spot, x: spot.x + 0.5 };
    const anna = track((await connect(app, port, 'Аня', { dbPath, position: spot, ry: aimAt(spot, 0), progress: drill([3, 0, 0, 0]) })).client);
    const boris = track((await connect(app, port, 'Борис', { dbPath, position: near, ry: aimAt(near, 3), progress: drill([0, 0, 0, 8]) })).client);
    assert.deepEqual((await ask(anna, 'window_hit', { index: 0 })).windows, [4, 0, 0, 0]);
    assert.deepEqual((await ask(boris, 'window_hit', { index: 3 })).windows, [0, 0, 0, 9]);
    assert.deepEqual(readProgress(dbPath, 'Аня').state.windows, [4, 0, 0, 0]);
    assert.deepEqual(readProgress(dbPath, 'Борис').state.windows, [0, 0, 0, 9]);
  });
});

test('к спасению ведёт только тушение последнего окна; подмена окон в payload не работает', async () => {
  await withServer({}, async ({ app, port, dbPath, track }) => {
    const spot = spotAtHose();
    const { client } = await connect(app, port, 'Аня', {
      dbPath,
      position: spot,
      ry: aimAt(spot, 3),
      progress: drill([WINDOW_HIT_LIMIT, WINDOW_HIT_LIMIT, WINDOW_HIT_LIMIT, WINDOW_HIT_LIMIT - 1]),
    });
    track(client);
    // Манекен недоступен, пока не потушены все окна; клиентское «все потушены» ничего не меняет.
    const forged = { windows: [12, 12, 12, 12], state: { stage: 'rescue' }, stage: 'rescue', position: at(WORLD_POINTS.mannequin) };
    const early = await ask(client, 'pickup_mannequin', forged);
    assert.equal(early.stage, 'fire_drill');
    assert.equal(early.changed, false);
    assert.equal(readProgress(dbPath, 'Аня').state.stage, 'fire_drill');

    const last = await ask(client, 'window_hit', { index: 3, ...forged });
    assert.equal(last.changed, true);
    assert.equal(last.stage, 'rescue');
    assert.deepEqual(last.windows, [12, 12, 12, 12]);
    assert.equal(last.done, false);
    assert.equal(readProgress(dbPath, 'Аня').state.stage, 'rescue');
    assert.equal(WINDOW_COUNT, 4);
  });
});

test('запись старого формата (fireHits) читается по сети и переписывается новым при первом действии', async () => {
  await withServer({}, async ({ app, port, dbPath, track }) => {
    const spot = spotAtHose();
    const legacy = { stage: 'fire_drill', equipped: true, fireHits: 9, carryingMannequin: false, mannequinDelivered: false };
    const { client, initial } = await connect(app, port, 'Аня', { dbPath, position: spot, ry: aimAt(spot, 2), progress: legacy });
    track(client);
    assert.equal(initial.state.stage, 'fire_drill');
    assert.deepEqual(initial.state.windows, [12, 12, 0, 0]);
    assert.equal('fireHits' in initial.state, false);
    assert.equal(readProgress(dbPath, 'Аня').state.fireHits, 9, 'чтение базу не меняет');

    const hit = await ask(client, 'window_hit', { index: 2 });
    assert.deepEqual(hit.windows, [12, 12, 1, 0]);
    const row = readProgress(dbPath, 'Аня').state;
    assert.deepEqual(row.windows, [12, 12, 1, 0]);
    assert.equal('fireHits' in row, false);
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

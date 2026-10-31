import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { WINDOW_COUNT, WINDOW_HIT_LIMIT } from '../../client/stations/firefighter/state.js';
import { HOSE_REACH, SERVER_MARGIN, WORLD_POINTS, WORLD_WINDOWS, toWorld } from '../../client/stations/firefighter/layout.js';
import { SAFETY_ZONE } from '../../client/stations/firefighter/safety-zone.js';
import { FIREFIGHTER_TASK_ID, FIRE_HIT_COOLDOWN_MS, createFirefighterTask, restoreState } from './firefighter_station_v1.js';

const quietLog = { error() {}, warn() {} };

function setup() {
  let t = 1_000_000;
  const db = openDb(':memory:');
  const anna = db.createUser({ name: 'Анна', passHash: 'h', salt: 's' });
  const boris = db.createUser({ name: 'Борис', passHash: 'h', salt: 's' });
  const make = (overrides = {}) => createFirefighterTask({ db, now: () => t, log: quietLog, ...overrides });
  return { db, anna, boris, make, task: make(), tick: (ms) => (t += ms) };
}

const at = (point, dx = 0, dz = 0) => ({ x: point.x + dx, y: 0, z: point.z + dz });
const atLocal = (x, z) => ({ ...toWorld(x, z), y: 0 });
/** Игрок стоит в `position` и смотрит на точку (yaw: 0 вдоль −Z). */
const facing = (position, point) => ({ position, yaw: Math.atan2(-(point.x - position.x), -(point.z - position.z)) });
const act = (task, userId, action, context, extra = {}) => task.handle(userId, { action, ...extra }, context);
const stored = (db, userId) => db.getTaskProgress(userId, FIREFIGHTER_TASK_ID);

/** Доводит игрока до этапа fire_drill. */
function toFireDrill(task, userId) {
  act(task, userId, 'start', { position: at(WORLD_POINTS.npc) });
  act(task, userId, 'accept_briefing', { position: at(WORLD_POINTS.npc) });
  return act(task, userId, 'equip', { position: at(WORLD_POINTS.locker) });
}

/** Место у рукава за линией безопасности (локально x = 3.5, z = 6.5): от стойки ближе её длины. */
const hoseSpot = () => atLocal(3.5, 6.5);
const windowContext = (index) => facing(hoseSpot(), WORLD_WINDOWS[index]);

/** Одно попадание по окну; cooldown выдерживается автоматически. */
function hitWindow(task, userId, tick, index, times = 1) {
  let last;
  for (let i = 0; i < times; i++) {
    tick(FIRE_HIT_COOLDOWN_MS);
    last = act(task, userId, 'window_hit', windowContext(index), { index });
  }
  return last;
}

const extinguishAll = (task, userId, tick) => {
  let last;
  for (let index = 0; index < WINDOW_COUNT; index++) last = hitWindow(task, userId, tick, index, WINDOW_HIT_LIMIT);
  return last;
};

test('полный сценарий: каждый шаг сохраняется в SQLite, done только в конце', () => {
  const { db, anna, task, tick } = setup();
  assert.equal(task.getState(anna.id).state.stage, 'not_started');
  assert.deepEqual(task.getState(anna.id).state.windows, [0, 0, 0, 0]);
  assert.equal(toFireDrill(task, anna.id).state.stage, 'fire_drill');
  assert.equal(stored(db, anna.id).state.stage, 'fire_drill');
  assert.equal(stored(db, anna.id).done, false);

  for (let index = 0; index < WINDOW_COUNT; index++) {
    const r = hitWindow(task, anna.id, tick, index, WINDOW_HIT_LIMIT);
    assert.equal(r.changed, true);
    assert.equal(r.state.windows[index], WINDOW_HIT_LIMIT);
    assert.equal(r.state.stage, index === WINDOW_COUNT - 1 ? 'rescue' : 'fire_drill');
  }
  assert.equal(stored(db, anna.id).state.stage, 'rescue');
  act(task, anna.id, 'pickup_mannequin', { position: at(WORLD_POINTS.mannequin) });
  act(task, anna.id, 'deliver_mannequin', { position: at(WORLD_POINTS.safe_zone) });
  assert.equal(stored(db, anna.id).done, false);
  const finish = act(task, anna.id, 'report', { position: at(WORLD_POINTS.npc) });
  assert.equal(finish.state.stage, 'completed');
  assert.equal(finish.done, true);
  assert.equal(stored(db, anna.id).done, true);
});

test('состояние всех окон сохраняется в SQLite и восстанавливается новым обработчиком', () => {
  const { db, anna, make, task, tick } = setup();
  toFireDrill(task, anna.id);
  hitWindow(task, anna.id, tick, 0, WINDOW_HIT_LIMIT); // потушено
  hitWindow(task, anna.id, tick, 1, 5); // в процессе
  hitWindow(task, anna.id, tick, 3, 1); // едва тронуто
  // окно 2 нетронуто

  // Формат в базе: массив числа попаданий по окнам, без дублирующих полей.
  assert.deepEqual(stored(db, anna.id).state, {
    stage: 'fire_drill',
    equipped: true,
    windows: [WINDOW_HIT_LIMIT, 5, 0, 1],
    carryingMannequin: false,
    mannequinDelivered: false,
  });

  const again = make(); // перезапуск сервера или вход с другого компьютера
  const restored = again.getState(anna.id);
  assert.deepEqual(restored.state, task.getState(anna.id).state);
  assert.deepEqual(restored.state.windows, [WINDOW_HIT_LIMIT, 5, 0, 1]);
  assert.equal(restored.state.stage, 'fire_drill');
  assert.equal(restored.changed, false);

  // Прогресс продолжается с того же места, а не с нуля.
  tick(FIRE_HIT_COOLDOWN_MS);
  assert.equal(act(again, anna.id, 'window_hit', windowContext(1), { index: 1 }).state.windows[1], 6);
  // Потушенное окно после восстановления не принимает попаданий.
  tick(FIRE_HIT_COOLDOWN_MS);
  assert.equal(act(again, anna.id, 'window_hit', windowContext(0), { index: 0 }).changed, false);
  db.close();
});

test('прогресс разных пользователей изолирован, включая окна', () => {
  const { db, anna, boris, task, tick } = setup();
  toFireDrill(task, anna.id);
  hitWindow(task, anna.id, tick, 2, 4);
  assert.equal(task.getState(boris.id).state.stage, 'not_started');
  assert.deepEqual(task.getState(boris.id).state.windows, [0, 0, 0, 0]);
  assert.equal(act(task, boris.id, 'start', { position: at(WORLD_POINTS.npc) }).state.stage, 'briefing');
  // Попадание Бориса по окну не влияет на Анну (и не засчитывается ему: он ещё на инструктаже).
  assert.equal(act(task, boris.id, 'window_hit', windowContext(2), { index: 2 }).changed, false);
  assert.deepEqual(task.getState(anna.id).state.windows, [0, 0, 4, 0]);
  assert.equal(db.listTaskProgress(anna.id).length, 1);
  assert.equal(db.listTaskProgress(boris.id).length, 1);
  assert.deepEqual(stored(db, boris.id).state.windows, [0, 0, 0, 0]);
});

test('payload не задаёт владельца, состояние, окна, результат и координаты', () => {
  const { db, anna, boris, task } = setup();
  const forged = {
    userId: boris.id,
    user: { id: boris.id },
    state: { stage: 'completed', equipped: true, windows: [12, 12, 12, 12], carryingMannequin: false, mannequinDelivered: true },
    windows: [12, 12, 12, 12],
    progress: 100,
    done: true,
    fireHits: 48,
    stage: 'completed',
    x: WORLD_POINTS.npc.x,
    y: 0,
    z: WORLD_POINTS.npc.z,
    position: at(WORLD_POINTS.npc),
    yaw: 0,
    interactionPoints: { npc: { x: 0, y: 0, z: 0, radius: 9999 } },
  };
  // Игрок далеко от Маруси: подставленные координаты ничего не дают.
  const far = act(task, anna.id, 'start', { position: at(WORLD_POINTS.npc, 200, 200) }, forged);
  assert.equal(far.changed, false);
  assert.equal(far.state.stage, 'not_started');
  assert.equal(stored(db, anna.id), null);

  // Рядом: засчитывается ровно одно действие, прогресс записан Анне, а не Борису.
  const near = act(task, anna.id, 'start', { position: at(WORLD_POINTS.npc) }, forged);
  assert.equal(near.state.stage, 'briefing');
  assert.equal(near.done, false);
  assert.deepEqual(near.state.windows, [0, 0, 0, 0]);
  assert.equal(stored(db, anna.id).state.stage, 'briefing');
  assert.equal(stored(db, boris.id), null);
  assert.equal(stored(db, anna.id).done, false);

  // action и index — единственные прочитанные поля; действие «resume» и мусор ничего не меняют.
  for (const payload of [forged, 'start', null, 42, [], { action: 7 }, { action: 'completed' }, { action: '__proto__' }, { action: 'toString' }]) {
    const r = task.handle(anna.id, payload, { position: at(WORLD_POINTS.npc) });
    assert.equal(r.changed, false, JSON.stringify(payload));
    assert.equal(r.state.stage, 'briefing');
  }
});

test('window_hit: подмена состояния, позиции и результата в payload не помогает', () => {
  const { db, anna, task, tick } = setup();
  toFireDrill(task, anna.id);
  tick(FIRE_HIT_COOLDOWN_MS);
  const forged = {
    index: 0,
    windows: [12, 12, 12, 12],
    state: { stage: 'rescue', windows: [12, 12, 12, 12] },
    stage: 'rescue',
    done: true,
    hits: 12,
    count: 99,
    position: hoseSpot(),
    x: hoseSpot().x,
    z: hoseSpot().z,
    yaw: windowContext(0).yaw,
  };
  // Сервер знает позицию из соединения: игрок далеко от рукава, координаты из payload игнорируются.
  const awayContext = facing(at(WORLD_POINTS.npc, 30, 30), WORLD_WINDOWS[0]);
  assert.equal(act(task, anna.id, 'window_hit', awayContext, forged).changed, false);
  assert.equal(task.getState(anna.id).state.stage, 'fire_drill');
  assert.deepEqual(task.getState(anna.id).state.windows, [0, 0, 0, 0]);

  // Из соединения всё правильно: засчитывается одно попадание, а не «12» из payload.
  const ok = act(task, anna.id, 'window_hit', windowContext(0), forged);
  assert.equal(ok.changed, true);
  assert.deepEqual(ok.state.windows, [1, 0, 0, 0]);
  assert.equal(ok.state.stage, 'fire_drill');
  assert.equal(ok.done, false);
  assert.deepEqual(stored(db, anna.id).state.windows, [1, 0, 0, 0]);
});

test('window_hit: некорректный индекс окна отклоняется без записи', () => {
  const { db, anna, task, tick } = setup();
  toFireDrill(task, anna.id);
  const before = stored(db, anna.id);
  for (const index of [-1, WINDOW_COUNT, 99, 0.5, NaN, Infinity, '0', '1', null, undefined, {}, [0], true, 2 ** 53]) {
    tick(FIRE_HIT_COOLDOWN_MS);
    const r = act(task, anna.id, 'window_hit', windowContext(0), { index });
    assert.equal(r.changed, false, String(index));
    assert.equal(r.error, undefined);
    assert.equal(r.state.stage, 'fire_drill');
  }
  assert.equal(act(task, anna.id, 'window_hit', windowContext(0)).changed, false, 'без индекса вообще');
  assert.deepEqual(stored(db, anna.id), before, 'запись в базе не менялась');
});

test('window_hit: допустимое направление засчитывается, недопустимое отклоняется', () => {
  const { db, anna, task, tick } = setup();
  toFireDrill(task, anna.id);
  const spot = hoseSpot();

  // Взгляд на каждое из окон засчитывает именно его.
  for (let index = 0; index < WINDOW_COUNT; index++) {
    tick(FIRE_HIT_COOLDOWN_MS);
    assert.equal(act(task, anna.id, 'window_hit', windowContext(index), { index }).state.windows[index], 1, `окно ${index}`);
  }
  tick(FIRE_HIT_COOLDOWN_MS);
  const base = windowContext(0);
  // Взгляд на левое окно, но удар заявлен по правому окну той же стены.
  assert.equal(act(task, anna.id, 'window_hit', base, { index: 1 }).changed, false, 'другое окно');
  assert.equal(act(task, anna.id, 'window_hit', { ...base, yaw: base.yaw + Math.PI }, { index: 0 }).changed, false, 'спиной к стене');
  assert.equal(act(task, anna.id, 'window_hit', { ...base, yaw: base.yaw + 1 }, { index: 0 }).changed, false, 'мимо окна');
  assert.equal(act(task, anna.id, 'window_hit', { ...base, yaw: Number.NaN }, { index: 0 }).changed, false);
  assert.equal(act(task, anna.id, 'window_hit', { ...base, yaw: undefined }, { index: 0 }).changed, false);
  assert.equal(act(task, anna.id, 'window_hit', { position: spot }, { index: 0 }).changed, false, 'нет yaw');
  assert.equal(act(task, anna.id, 'window_hit', undefined, { index: 0 }).changed, false, 'нет контекста');
  assert.match(act(task, anna.id, 'window_hit', { ...base, yaw: base.yaw + 1 }, { index: 0 }).feedback, /окно/);

  // Точно под окном направление не определено.
  const under = { x: WORLD_WINDOWS[0].x, y: 0, z: WORLD_WINDOWS[0].z };
  assert.equal(act(task, anna.id, 'window_hit', { position: under, yaw: 0 }, { index: 0 }).changed, false);
  assert.deepEqual(stored(db, anna.id).state.windows, [1, 1, 1, 1], 'неудачные попытки ничего не записали');
});

test('window_hit: дальность рукава, зона безопасности и частота', () => {
  const { db, anna, task, tick } = setup();
  toFireDrill(task, anna.id);
  const hit = () => act(task, anna.id, 'window_hit', windowContext(0), { index: 0 });

  tick(FIRE_HIT_COOLDOWN_MS);
  assert.equal(hit().state.windows[0], 1);
  assert.equal(hit().changed, false, 'тот же момент: слишком часто');
  tick(FIRE_HIT_COOLDOWN_MS - 1);
  assert.equal(hit().changed, false);
  tick(1);
  assert.equal(hit().state.windows[0], 2);

  // Дальше длины рукава от стойки.
  tick(1000);
  const far = facing(at(WORLD_POINTS.hose, HOSE_REACH + SERVER_MARGIN + 1, 0), WORLD_WINDOWS[0]);
  assert.equal(act(task, anna.id, 'window_hit', far, { index: 0 }).changed, false);

  // За линией безопасности (в зоне перед стеной) попадания не засчитываются.
  const inside = atLocal((SAFETY_ZONE.minX + SAFETY_ZONE.maxX) / 2, (SAFETY_ZONE.minZ + SAFETY_ZONE.maxZ) / 2);
  const refused = act(task, anna.id, 'window_hit', facing(inside, WORLD_WINDOWS[0]), { index: 0 });
  assert.equal(refused.changed, false);
  assert.match(refused.feedback, /линию/);
  // На самой линии (граница) ещё можно.
  const edge = atLocal(3.5, SAFETY_ZONE.maxZ);
  assert.equal(act(task, anna.id, 'window_hit', facing(edge, WORLD_WINDOWS[0]), { index: 0 }).changed, true);

  assert.equal(stored(db, anna.id).state.windows[0], 3);
});

test('к спасению ведёт только тушение всех четырёх окон', () => {
  const { db, anna, task, tick } = setup();
  toFireDrill(task, anna.id);
  const mannequin = { position: at(WORLD_POINTS.mannequin) };

  for (const index of [0, 1, 2]) hitWindow(task, anna.id, tick, index, WINDOW_HIT_LIMIT);
  assert.equal(task.getState(anna.id).state.stage, 'fire_drill', 'три окна из четырёх');
  assert.equal(act(task, anna.id, 'pickup_mannequin', mannequin).changed, false, 'манекен недоступен');

  // Четвёртое окно потушено почти до конца — этап всё ещё прежний.
  const almost = hitWindow(task, anna.id, tick, 3, WINDOW_HIT_LIMIT - 1);
  assert.equal(almost.state.stage, 'fire_drill');
  assert.equal(act(task, anna.id, 'pickup_mannequin', mannequin).changed, false);
  assert.equal(stored(db, anna.id).state.stage, 'fire_drill');

  const last = hitWindow(task, anna.id, tick, 3, 1);
  assert.equal(last.state.stage, 'rescue');
  assert.deepEqual(last.state.windows, [12, 12, 12, 12]);
  assert.match(last.feedback, /Все окна потушены/);
  assert.equal(stored(db, anna.id).state.stage, 'rescue');
  assert.equal(act(task, anna.id, 'pickup_mannequin', mannequin).changed, true);
});

test('действия нельзя выполнить вне допустимой позиции', () => {
  const { db, anna, task } = setup();
  const npc = { position: at(WORLD_POINTS.npc, WORLD_POINTS.npc.radius + 0.5) };
  assert.equal(act(task, anna.id, 'start', npc).changed, false);
  assert.equal(act(task, anna.id, 'start', { position: at(WORLD_POINTS.npc, 0, 0) }).changed, true);
  act(task, anna.id, 'accept_briefing', { position: at(WORLD_POINTS.npc) });

  // Шкаф: нужен именно шкаф, а не Маруся; высота «взлёта» тоже не подходит.
  assert.equal(act(task, anna.id, 'equip', { position: at(WORLD_POINTS.npc) }).changed, false);
  assert.equal(act(task, anna.id, 'equip', { position: { ...at(WORLD_POINTS.locker), y: 50 } }).changed, false);
  for (const bad of [undefined, null, {}, { x: NaN, y: 0, z: 0 }, { x: '1', y: 0, z: 0 }]) {
    assert.equal(act(task, anna.id, 'equip', { position: bad }).changed, false, JSON.stringify(bad));
  }
  assert.equal(act(task, anna.id, 'equip').changed, false, 'нет контекста');
  assert.equal(stored(db, anna.id).state.stage, 'equipping');
});

test('порядок этапов нельзя обойти; завершённое задание не меняется', () => {
  const { db, anna, task, tick } = setup();
  const npc = { position: at(WORLD_POINTS.npc) };
  const everywhere = {
    start: npc,
    accept_briefing: npc,
    equip: { position: at(WORLD_POINTS.locker) },
    window_hit: windowContext(0),
    pickup_mannequin: { position: at(WORLD_POINTS.mannequin) },
    deliver_mannequin: { position: at(WORLD_POINTS.safe_zone) },
    report: npc,
  };
  const run = (action) => act(task, anna.id, action, everywhere[action], action === 'window_hit' ? { index: 0 } : {});
  // На старте допустим только start.
  for (const action of Object.keys(everywhere).filter((a) => a !== 'start')) {
    const r = run(action);
    assert.equal(r.changed, false, action);
    assert.equal(r.state.stage, 'not_started');
  }
  assert.equal(stored(db, anna.id), null, 'ничего не записано');

  // Повтор уже засчитанного действия не двигает прогресс.
  run('start');
  assert.equal(run('start').changed, false);
  assert.equal(run('report').changed, false);

  // Проходим до конца и проверяем, что completed не меняется.
  run('accept_briefing');
  run('equip');
  extinguishAll(task, anna.id, tick);
  for (let i = 0; i < 5; i++) {
    tick(FIRE_HIT_COOLDOWN_MS);
    assert.equal(run('window_hit').changed, false, 'сверх лимита окно не принимает попаданий');
  }
  assert.deepEqual(task.getState(anna.id).state.windows, [12, 12, 12, 12]);
  assert.equal(run('deliver_mannequin').changed, false, 'без манекена');
  run('pickup_mannequin');
  assert.equal(run('pickup_mannequin').changed, false);
  run('deliver_mannequin');
  run('report');
  const before = stored(db, anna.id);
  tick(FIRE_HIT_COOLDOWN_MS);
  for (const action of Object.keys(everywhere)) assert.equal(run(action).changed, false);
  assert.deepEqual(stored(db, anna.id), before);
});

test('старый action fire_hit больше не принимается', () => {
  const { db, anna, task } = setup();
  toFireDrill(task, anna.id);
  const r = act(task, anna.id, 'fire_hit', windowContext(0), { index: 0 });
  assert.equal(r.changed, false);
  assert.deepEqual(r.state.windows, [0, 0, 0, 0]);
  assert.deepEqual(stored(db, anna.id).state.windows, [0, 0, 0, 0]);
});

test('ошибка записи в базу: клиент получает error и прежнее состояние, запись не меняется', () => {
  const { db, anna } = setup();
  const logged = [];
  let failing = false;
  const flaky = {
    getTaskProgress: (...a) => db.getTaskProgress(...a),
    saveTaskProgress(...a) {
      if (failing) throw new Error('disk I/O error');
      return db.saveTaskProgress(...a);
    },
  };
  const task = createFirefighterTask({ db: flaky, log: { error: (...a) => logged.push(a) } });
  act(task, anna.id, 'start', { position: at(WORLD_POINTS.npc) });
  const before = stored(db, anna.id);

  failing = true;
  const r = act(task, anna.id, 'accept_briefing', { position: at(WORLD_POINTS.npc) });
  assert.equal(r.error, 'storage');
  assert.equal(r.changed, false, 'успех не подтверждается');
  assert.equal(r.state.stage, 'briefing', 'клиент видит последнее сохранённое состояние');
  assert.match(r.feedback, /не засчитано/);
  assert.equal(logged.length, 1);
  assert.deepEqual(stored(db, anna.id), before);

  failing = false;
  assert.equal(act(task, anna.id, 'accept_briefing', { position: at(WORLD_POINTS.npc) }).state.stage, 'equipping', 'повтор после сбоя проходит');
});

test('ошибка записи при тушении окна не засчитывает попадание', () => {
  const { db, anna } = setup();
  let failing = false;
  const flaky = {
    getTaskProgress: (...a) => db.getTaskProgress(...a),
    saveTaskProgress(...a) {
      if (failing) throw new Error('disk I/O error');
      return db.saveTaskProgress(...a);
    },
  };
  let t = 5_000_000;
  const task = createFirefighterTask({ db: flaky, now: () => (t += FIRE_HIT_COOLDOWN_MS), log: quietLog });
  toFireDrill(task, anna.id);
  assert.equal(act(task, anna.id, 'window_hit', windowContext(2), { index: 2 }).state.windows[2], 1);
  failing = true;
  const r = act(task, anna.id, 'window_hit', windowContext(2), { index: 2 });
  assert.equal(r.error, 'storage');
  assert.deepEqual(r.state.windows, [0, 0, 1, 0]);
  failing = false;
  assert.equal(act(task, anna.id, 'window_hit', windowContext(2), { index: 2 }).state.windows[2], 2);
});

test('повреждённая запись в базе не ломает задание: начинается заново', () => {
  const { db, anna, task } = setup();
  const good = { stage: 'rescue', equipped: true, windows: [12, 12, 12, 12], carryingMannequin: false, mannequinDelivered: false };
  const corrupted = [
    { stage: 'hacked' },
    { stage: 'completed' },
    'x',
    null,
    { ...good, windows: [12, 12, 12] },
    { ...good, windows: [12, 12, 12, 13] },
    { ...good, windows: [12, 12, 12, -1] },
    { ...good, windows: [12, 12, 12, 1.5] },
    { ...good, windows: [12, 12, 12, '12'] },
    { ...good, windows: 'oops' },
    { ...good, windows: [12, 12, 12, 11] }, // rescue при непотушенном окне
    { ...good, stage: 'fire_drill' }, // fire_drill при всех потушенных
    { ...good, stage: 'equipping', windows: [0, 1, 0, 0] }, // окна тронуты до fire_drill
    { ...good, equipped: 'yes' },
    // старый формат с повреждёнными полями
    { stage: 'rescue', equipped: true, fireHits: 99, carryingMannequin: false, mannequinDelivered: false },
    { stage: 'rescue', equipped: true, fireHits: 5, carryingMannequin: false, mannequinDelivered: false },
    { stage: 'fire_drill', equipped: true, fireHits: 18, carryingMannequin: false, mannequinDelivered: false },
    { stage: 'briefing', equipped: false, fireHits: 3, carryingMannequin: false, mannequinDelivered: false },
  ];
  for (const state of corrupted) {
    db.saveTaskProgress(anna.id, FIREFIGHTER_TASK_ID, { state, done: true });
    assert.equal(task.getState(anna.id).state.stage, 'not_started', JSON.stringify(state));
    assert.deepEqual(task.getState(anna.id).state.windows, [0, 0, 0, 0]);
    assert.equal(task.getState(anna.id).done, false);
  }
});

test('миграция: запись старого формата (fireHits без windows) читается и переписывается при следующем действии', () => {
  const { db, anna, task, tick } = setup();
  const legacy = (stage, fireHits, extra = {}) => ({
    stage,
    equipped: !['not_started', 'briefing', 'equipping'].includes(stage),
    fireHits,
    carryingMannequin: false,
    mannequinDelivered: false,
    ...extra,
  });
  const save = (state, done = false) => db.saveTaskProgress(anna.id, FIREFIGHTER_TASK_ID, { state, done });

  // До тушения окна нетронуты.
  save(legacy('equipping', 0));
  assert.deepEqual(task.getState(anna.id).state.windows, [0, 0, 0, 0]);
  assert.equal(task.getState(anna.id).state.stage, 'equipping');

  // Середина тушения: 9 из 18 попаданий -> 24 из 48, окна заполняются по порядку.
  save(legacy('fire_drill', 9));
  const mid = task.getState(anna.id);
  assert.equal(mid.state.stage, 'fire_drill');
  assert.deepEqual(mid.state.windows, [12, 12, 0, 0]);
  assert.equal('fireHits' in mid.state, false, 'старое поле клиенту не отдаётся');
  assert.deepEqual(stored(db, anna.id).state.fireHits, 9, 'чтение базу не меняет');

  // Начало тушения не превращается в потушенное окно, а конец — в завершённый этап.
  save(legacy('fire_drill', 1));
  assert.deepEqual(task.getState(anna.id).state.windows, [3, 0, 0, 0]);
  save(legacy('fire_drill', 17));
  const almost = task.getState(anna.id).state;
  assert.equal(almost.stage, 'fire_drill');
  assert.ok(almost.windows.some((hits) => hits < WINDOW_HIT_LIMIT), 'хотя бы одно окно ещё не потушено');

  // Действие игрока записывает новый формат (без fireHits).
  save(legacy('fire_drill', 9));
  tick(FIRE_HIT_COOLDOWN_MS);
  const r = act(task, anna.id, 'window_hit', windowContext(2), { index: 2 });
  assert.equal(r.changed, true);
  assert.deepEqual(r.state.windows, [12, 12, 1, 0]);
  assert.deepEqual(stored(db, anna.id).state, {
    stage: 'fire_drill',
    equipped: true,
    windows: [12, 12, 1, 0],
    carryingMannequin: false,
    mannequinDelivered: false,
  });

  // Пройденные этапы: все окна потушены; completed и done сохраняются.
  save(legacy('rescue', 18));
  assert.deepEqual(task.getState(anna.id).state.windows, [12, 12, 12, 12]);
  save(legacy('debrief', 18, { mannequinDelivered: true }));
  assert.equal(task.getState(anna.id).state.stage, 'debrief');
  save(legacy('completed', 18, { mannequinDelivered: true }), true);
  const done = task.getState(anna.id);
  assert.equal(done.state.stage, 'completed');
  assert.equal(done.done, true);
  assert.deepEqual(done.state.windows, [12, 12, 12, 12]);
});

test('restoreState: формат 2 принимается как есть, лишние поля отбрасываются', () => {
  const state = { stage: 'fire_drill', equipped: true, windows: [3, 0, 12, 7], carryingMannequin: false, mannequinDelivered: false };
  assert.deepEqual(restoreState({ ...state, secret: 'x', fireHits: 999 }), state);
  const copy = restoreState(state);
  copy.windows[0] = 99;
  assert.equal(state.windows[0], 3, 'восстановленное состояние не делит массив с записью');
});

test('в ответ попадают только известные поля состояния', () => {
  const { db, anna, task } = setup();
  db.saveTaskProgress(anna.id, FIREFIGHTER_TASK_ID, {
    state: { stage: 'briefing', equipped: false, windows: [0, 0, 0, 0], carryingMannequin: false, mannequinDelivered: false, secret: 'x' },
    done: false,
  });
  assert.deepEqual(Object.keys(task.getState(anna.id).state).sort(), ['carryingMannequin', 'equipped', 'mannequinDelivered', 'stage', 'windows']);
});

test('handle требует положительный целый userId', () => {
  const { task } = setup();
  for (const id of [0, -1, 1.5, '1', null, undefined]) assert.throws(() => task.handle(id, { action: 'start' }, {}), TypeError);
});

/** Доводит игрока до завершённой смены. */
function complete(task, userId, tick) {
  toFireDrill(task, userId);
  extinguishAll(task, userId, tick);
  act(task, userId, 'pickup_mannequin', { position: at(WORLD_POINTS.mannequin) });
  act(task, userId, 'deliver_mannequin', { position: at(WORLD_POINTS.safe_zone) });
  return act(task, userId, 'report', { position: at(WORLD_POINTS.npc) });
}

test('повтор: после завершения смена начинается заново с инструктажа, результат сохраняется в SQLite', () => {
  const { db, anna, boris, make, task, tick } = setup();
  assert.equal(complete(task, anna.id, tick).state.stage, 'completed');
  assert.equal(stored(db, anna.id).done, true);

  const again = act(task, anna.id, 'repeat', { position: at(WORLD_POINTS.npc) });
  assert.equal(again.changed, true);
  assert.equal(again.done, false);
  assert.deepEqual(again.state, {
    stage: 'briefing',
    equipped: false,
    windows: [0, 0, 0, 0],
    carryingMannequin: false,
    mannequinDelivered: false,
  });
  assert.equal(stored(db, anna.id).state.stage, 'briefing');
  assert.equal(stored(db, anna.id).done, false);
  // после перезапуска сервера состояние то же, а новая смена проходится как обычная
  const restarted = make();
  assert.equal(restarted.getState(anna.id).state.stage, 'briefing');
  assert.equal(act(restarted, anna.id, 'accept_briefing', { position: at(WORLD_POINTS.npc) }).state.stage, 'equipping');
  // чужой прогресс не затронут
  assert.equal(task.getState(boris.id).state.stage, 'not_started');
});

test('повтор: сбросить незавершённую смену нельзя ни на одном этапе', () => {
  const { db, anna, task, tick } = setup();
  const atNpc = { position: at(WORLD_POINTS.npc) };
  const check = (stage) => {
    const before = stored(db, anna.id)?.state ?? null;
    const r = act(task, anna.id, 'repeat', atNpc);
    assert.equal(r.changed, false, stage);
    assert.equal(r.state.stage, stage);
    assert.match(r.feedback, /только после её завершения/);
    assert.deepEqual(stored(db, anna.id)?.state ?? null, before, `база не изменилась на ${stage}`);
  };
  check('not_started');
  act(task, anna.id, 'start', atNpc);
  check('briefing');
  act(task, anna.id, 'accept_briefing', atNpc);
  check('equipping');
  act(task, anna.id, 'equip', { position: at(WORLD_POINTS.locker) });
  hitWindow(task, anna.id, tick, 0, 5);
  check('fire_drill');
  assert.equal(stored(db, anna.id).state.windows[0], 5, 'прогресс окна сохранился');
  hitWindow(task, anna.id, tick, 0, WINDOW_HIT_LIMIT - 5);
  extinguishAll(task, anna.id, tick);
  check('rescue');
  act(task, anna.id, 'pickup_mannequin', { position: at(WORLD_POINTS.mannequin) });
  check('rescue');
  act(task, anna.id, 'deliver_mannequin', { position: at(WORLD_POINTS.safe_zone) });
  check('debrief');
});

test('повтор: нужен подход к Марусе, а лишние поля payload и клиентское состояние игнорируются', () => {
  const { db, anna, task, tick } = setup();
  complete(task, anna.id, tick);
  const far = act(task, anna.id, 'repeat', { position: at(WORLD_POINTS.locker) });
  assert.equal(far.changed, false);
  assert.equal(far.state.stage, 'completed');
  assert.equal(stored(db, anna.id).state.stage, 'completed');

  const forged = task.handle(
    anna.id,
    { action: 'repeat', state: { stage: 'equipping', equipped: true }, stage: 'fire_drill', windows: [12, 12, 12, 12] },
    { position: at(WORLD_POINTS.npc) },
  );
  assert.equal(forged.state.stage, 'briefing', 'сервер сам решает, куда идти: всегда инструктаж');
  assert.equal(forged.state.equipped, false);
  assert.deepEqual(forged.state.windows, [0, 0, 0, 0]);
});

test('describe: ход задания собран из сохранённого состояния и не зависит от клиента', () => {
  const { anna, task, tick } = setup();
  assert.equal(task.agentId, 'marusya');
  const first = task.describe(anna.id);
  assert.equal(first.key, 'not_started');
  assert.match(first.text, /ещё не начата/);

  act(task, anna.id, 'start', { position: at(WORLD_POINTS.npc) });
  assert.equal(task.describe(anna.id).key, 'briefing');
  act(task, anna.id, 'accept_briefing', { position: at(WORLD_POINTS.npc) });
  assert.match(task.describe(anna.id).text, /ещё не надел/);
  act(task, anna.id, 'equip', { position: at(WORLD_POINTS.locker) });
  hitWindow(task, anna.id, tick, 0, WINDOW_HIT_LIMIT);
  hitWindow(task, anna.id, tick, 1, 3);
  const drill = task.describe(anna.id);
  assert.equal(drill.key, 'fire_drill');
  assert.match(drill.text, /экипировку игрок уже надел/);
  assert.match(drill.text, /окон потушено 1 из 4, ещё 1 в процессе/);

  // Попытка подделать состояние через payload ничего не меняет в описании.
  task.handle(anna.id, { action: 'resume', state: { stage: 'completed' } }, {});
  assert.equal(task.describe(anna.id).key, 'fire_drill');

  extinguishAll(task, anna.id, tick);
  assert.equal(task.describe(anna.id).key, 'rescue');
  act(task, anna.id, 'pickup_mannequin', { position: at(WORLD_POINTS.mannequin) });
  assert.match(task.describe(anna.id).text, /манекен поднят/);
  act(task, anna.id, 'deliver_mannequin', { position: at(WORLD_POINTS.safe_zone) });
  assert.equal(task.describe(anna.id).key, 'debrief');
  act(task, anna.id, 'report', { position: at(WORLD_POINTS.npc) });
  const finished = task.describe(anna.id);
  assert.equal(finished.key, 'completed');
  assert.match(finished.text, /полностью завершена/);
  assert.match(finished.text, /Повторить смену/);
  assert.match(finished.text, /выполняет только игрок/);
  assert.ok(finished.text.length <= 900, 'описание помещается в лимит контекста агента');
});

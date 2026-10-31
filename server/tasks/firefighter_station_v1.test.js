import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { FIRE_HIT_LIMIT } from '../../client/stations/firefighter/state.js';
import { HOSE_REACH, SERVER_MARGIN, WORLD_POINTS } from '../../client/stations/firefighter/layout.js';
import { FIREFIGHTER_TASK_ID, FIRE_HIT_COOLDOWN_MS, createFirefighterTask } from './firefighter_station_v1.js';

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
/** Игрок стоит в `position` и смотрит на точку (yaw: 0 вдоль −Z). */
const facing = (position, point) => ({ position, yaw: Math.atan2(-(point.x - position.x), -(point.z - position.z)) });
const act = (task, userId, action, context, extra = {}) => task.handle(userId, { action, ...extra }, context);

/** Доводит игрока до этапа fire_drill. */
function toFireDrill(task, userId) {
  act(task, userId, 'start', { position: at(WORLD_POINTS.npc) });
  act(task, userId, 'accept_briefing', { position: at(WORLD_POINTS.npc) });
  return act(task, userId, 'equip', { position: at(WORLD_POINTS.locker) });
}

const hoseSpot = () => at(WORLD_POINTS.hose, 1.5, 0);
const hoseContext = () => facing(hoseSpot(), WORLD_POINTS.target);

test('полный сценарий: каждый шаг сохраняется в SQLite, done только в конце', () => {
  const { db, anna, task, tick } = setup();
  assert.equal(task.getState(anna.id).state.stage, 'not_started');
  assert.equal(toFireDrill(task, anna.id).state.stage, 'fire_drill');
  assert.equal(db.getTaskProgress(anna.id, FIREFIGHTER_TASK_ID).state.stage, 'fire_drill');
  assert.equal(db.getTaskProgress(anna.id, FIREFIGHTER_TASK_ID).done, false);

  for (let i = 1; i <= FIRE_HIT_LIMIT; i++) {
    tick(FIRE_HIT_COOLDOWN_MS);
    const r = act(task, anna.id, 'fire_hit', hoseContext());
    assert.equal(r.changed, true);
    assert.equal(r.state.fireHits, i === FIRE_HIT_LIMIT ? FIRE_HIT_LIMIT : i);
  }
  assert.equal(db.getTaskProgress(anna.id, FIREFIGHTER_TASK_ID).state.stage, 'rescue');
  act(task, anna.id, 'pickup_mannequin', { position: at(WORLD_POINTS.mannequin) });
  act(task, anna.id, 'deliver_mannequin', { position: at(WORLD_POINTS.safe_zone) });
  assert.equal(db.getTaskProgress(anna.id, FIREFIGHTER_TASK_ID).done, false);
  const finish = act(task, anna.id, 'report', { position: at(WORLD_POINTS.npc) });
  assert.equal(finish.state.stage, 'completed');
  assert.equal(finish.done, true);
  assert.equal(db.getTaskProgress(anna.id, FIREFIGHTER_TASK_ID).done, true);
});

test('восстановление: новый обработчик и новое соединение читают прогресс из базы', () => {
  const { db, anna, make, task } = setup();
  toFireDrill(task, anna.id);
  const again = make(); // как после перезапуска или входа с другого компьютера
  assert.deepEqual(again.getState(anna.id).state, task.getState(anna.id).state);
  assert.equal(again.getState(anna.id).state.stage, 'fire_drill');
  assert.equal(again.getState(anna.id).state.equipped, true);
  // Прогресс продолжается с того же места.
  assert.equal(act(again, anna.id, 'fire_hit', hoseContext()).state.fireHits, 1);
  db.close();
});

test('прогресс разных пользователей изолирован', () => {
  const { db, anna, boris, task } = setup();
  toFireDrill(task, anna.id);
  assert.equal(task.getState(boris.id).state.stage, 'not_started');
  assert.equal(act(task, boris.id, 'start', { position: at(WORLD_POINTS.npc) }).state.stage, 'briefing');
  assert.equal(task.getState(anna.id).state.stage, 'fire_drill');
  assert.equal(db.listTaskProgress(anna.id).length, 1);
  assert.equal(db.listTaskProgress(boris.id).length, 1);
});

test('payload не задаёт владельца, состояние, прогресс, результат и координаты', () => {
  const { db, anna, boris, task } = setup();
  const forged = {
    userId: boris.id,
    user: { id: boris.id },
    state: { stage: 'completed', equipped: true, fireHits: 18, carryingMannequin: false, mannequinDelivered: true },
    progress: 100,
    done: true,
    fireHits: 18,
    stage: 'completed',
    x: WORLD_POINTS.npc.x,
    y: 0,
    z: WORLD_POINTS.npc.z,
    position: at(WORLD_POINTS.npc),
    interactionPoints: { npc: { x: 0, y: 0, z: 0, radius: 9999 } },
  };
  // Игрок далеко от Маруси: подставленные координаты ничего не дают.
  const far = act(task, anna.id, 'start', { position: at(WORLD_POINTS.npc, 200, 200) }, forged);
  assert.equal(far.changed, false);
  assert.equal(far.state.stage, 'not_started');
  assert.equal(db.getTaskProgress(anna.id, FIREFIGHTER_TASK_ID), null);

  // Рядом: засчитывается ровно одно действие, прогресс записан Анне, а не Борису.
  const near = act(task, anna.id, 'start', { position: at(WORLD_POINTS.npc) }, forged);
  assert.equal(near.state.stage, 'briefing');
  assert.equal(near.done, false);
  assert.equal(db.getTaskProgress(anna.id, FIREFIGHTER_TASK_ID).state.stage, 'briefing');
  assert.equal(db.getTaskProgress(boris.id, FIREFIGHTER_TASK_ID), null);
  assert.equal(db.getTaskProgress(anna.id, FIREFIGHTER_TASK_ID).done, false);

  // action — единственное прочитанное поле; действие «resume» и мусор ничего не меняют.
  for (const payload of [forged, 'start', null, 42, [], { action: 7 }, { action: 'completed' }, { action: '__proto__' }, { action: 'toString' }]) {
    const r = task.handle(anna.id, payload, { position: at(WORLD_POINTS.npc) });
    assert.equal(r.changed, false, JSON.stringify(payload));
    assert.equal(r.state.stage, 'briefing');
  }
});

test('действия вне допустимой позиции отклоняются без записи', () => {
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
  assert.equal(db.getTaskProgress(anna.id, FIREFIGHTER_TASK_ID).state.stage, 'equipping');
});

test('fire_hit: зона у рукава, взгляд на мишень и частота', () => {
  const { db, anna, task, tick } = setup();
  toFireDrill(task, anna.id);
  const hit = () => act(task, anna.id, 'fire_hit', hoseContext());

  assert.equal(hit().state.fireHits, 1);
  assert.equal(hit().changed, false, 'тот же момент: слишком часто');
  tick(FIRE_HIT_COOLDOWN_MS - 1);
  assert.equal(hit().changed, false);
  tick(1);
  assert.equal(hit().state.fireHits, 2);

  tick(1000);
  const away = facing(hoseSpot(), WORLD_POINTS.target);
  assert.equal(act(task, anna.id, 'fire_hit', { ...away, yaw: away.yaw + Math.PI }).changed, false, 'спиной к мишени');
  assert.equal(act(task, anna.id, 'fire_hit', { ...away, yaw: away.yaw + 1 }).changed, false, 'мимо мишени');
  assert.equal(act(task, anna.id, 'fire_hit', { ...away, yaw: Number.NaN }).changed, false);
  assert.equal(act(task, anna.id, 'fire_hit', { ...away, yaw: undefined }).changed, false);

  // Дальше, чем достаёт рукав от стойки.
  const far = facing(at(WORLD_POINTS.hose, HOSE_REACH + SERVER_MARGIN + 1, 0), WORLD_POINTS.target);
  assert.equal(act(task, anna.id, 'fire_hit', far).changed, false);
  // Под самой мишенью направление не определено.
  const inside = at(WORLD_POINTS.target);
  assert.equal(act(task, anna.id, 'fire_hit', { position: inside, yaw: 0 }).changed, false);
  assert.equal(db.getTaskProgress(anna.id, FIREFIGHTER_TASK_ID).state.fireHits, 2);
});

test('порядок этапов нельзя обойти; завершённое задание не меняется', () => {
  const { db, anna, task, tick } = setup();
  const npc = { position: at(WORLD_POINTS.npc) };
  const everywhere = {
    start: npc,
    accept_briefing: npc,
    equip: { position: at(WORLD_POINTS.locker) },
    fire_hit: hoseContext(),
    pickup_mannequin: { position: at(WORLD_POINTS.mannequin) },
    deliver_mannequin: { position: at(WORLD_POINTS.safe_zone) },
    report: npc,
  };
  // На старте допустим только start.
  for (const action of Object.keys(everywhere).filter((a) => a !== 'start')) {
    const r = act(task, anna.id, action, everywhere[action]);
    assert.equal(r.changed, false, action);
    assert.equal(r.state.stage, 'not_started');
  }
  assert.equal(db.getTaskProgress(anna.id, FIREFIGHTER_TASK_ID), null, 'ничего не записано');

  // Повтор уже засчитанного действия не двигает прогресс.
  act(task, anna.id, 'start', npc);
  assert.equal(act(task, anna.id, 'start', npc).changed, false);
  assert.equal(act(task, anna.id, 'report', npc).changed, false);

  // Проходим до конца и проверяем, что completed не меняется.
  act(task, anna.id, 'accept_briefing', npc);
  act(task, anna.id, 'equip', everywhere.equip);
  for (let i = 0; i < FIRE_HIT_LIMIT + 5; i++) {
    tick(FIRE_HIT_COOLDOWN_MS);
    act(task, anna.id, 'fire_hit', everywhere.fire_hit);
  }
  assert.equal(task.getState(anna.id).state.fireHits, FIRE_HIT_LIMIT, 'сверх лимита не засчитывается');
  assert.equal(act(task, anna.id, 'deliver_mannequin', everywhere.deliver_mannequin).changed, false, 'без манекена');
  act(task, anna.id, 'pickup_mannequin', everywhere.pickup_mannequin);
  assert.equal(act(task, anna.id, 'pickup_mannequin', everywhere.pickup_mannequin).changed, false);
  act(task, anna.id, 'deliver_mannequin', everywhere.deliver_mannequin);
  act(task, anna.id, 'report', npc);
  const before = db.getTaskProgress(anna.id, FIREFIGHTER_TASK_ID);
  for (const action of Object.keys(everywhere)) assert.equal(act(task, anna.id, action, everywhere[action]).changed, false);
  assert.deepEqual(db.getTaskProgress(anna.id, FIREFIGHTER_TASK_ID), before);
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
  const stored = db.getTaskProgress(anna.id, FIREFIGHTER_TASK_ID);

  failing = true;
  const r = act(task, anna.id, 'accept_briefing', { position: at(WORLD_POINTS.npc) });
  assert.equal(r.error, 'storage');
  assert.equal(r.changed, false, 'успех не подтверждается');
  assert.equal(r.state.stage, 'briefing', 'клиент видит последнее сохранённое состояние');
  assert.match(r.feedback, /не засчитано/);
  assert.equal(logged.length, 1);
  assert.deepEqual(db.getTaskProgress(anna.id, FIREFIGHTER_TASK_ID), stored);

  failing = false;
  assert.equal(act(task, anna.id, 'accept_briefing', { position: at(WORLD_POINTS.npc) }).state.stage, 'equipping', 'повтор после сбоя проходит');
});

test('повреждённая запись в базе не ломает задание: начинается заново', () => {
  const { db, anna, task } = setup();
  for (const state of [{ stage: 'hacked' }, { stage: 'completed' }, { stage: 'rescue', equipped: true, fireHits: 99, carryingMannequin: false, mannequinDelivered: false }, 'x', null]) {
    db.saveTaskProgress(anna.id, FIREFIGHTER_TASK_ID, { state, done: true });
    assert.equal(task.getState(anna.id).state.stage, 'not_started', JSON.stringify(state));
    assert.equal(task.getState(anna.id).done, false);
  }
});

test('в ответ попадают только известные поля состояния', () => {
  const { db, anna, task } = setup();
  db.saveTaskProgress(anna.id, FIREFIGHTER_TASK_ID, {
    state: { stage: 'briefing', equipped: false, fireHits: 0, carryingMannequin: false, mannequinDelivered: false, secret: 'x' },
    done: false,
  });
  assert.deepEqual(Object.keys(task.getState(anna.id).state).sort(), ['carryingMannequin', 'equipped', 'fireHits', 'mannequinDelivered', 'stage']);
});

test('handle требует положительный целый userId', () => {
  const { task } = setup();
  for (const id of [0, -1, 1.5, '1', null, undefined]) assert.throws(() => task.handle(id, { action: 'start' }, {}), TypeError);
});

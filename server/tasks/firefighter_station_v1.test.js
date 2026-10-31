import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { createInitialState, FIRE_HIT_LIMIT } from '../../client/stations/firefighter/state.js';
import {
  FIRE_HIT_COOLDOWN_MS,
  FIREFIGHTER_TASK_ID,
  getFirefighterTaskState,
  handleFirefighterTask,
} from './firefighter_station_v1.js';

const points = Object.freeze({
  npc: { x: 0, y: 0, z: 0, radius: 3 },
  locker: { x: 10, y: 0, z: 0, radius: 3 },
  target: { x: 20, y: 0, z: 0, radius: 3 },
  hose: { x: 22, y: 0, z: 1, radius: 3 },
  mannequin: { x: 30, y: 0, z: 0, radius: 3 },
  safe_zone: { x: 40, y: 0, z: 0, radius: 3 },
});

const at = (name) => ({ x: points[name].x, y: points[name].y, z: points[name].z });
const playerAt = (name) => name === 'hose'
  ? { x: points.hose.x, y: points.hose.y, z: points.hose.z }
  : at(name);
const invoke = (db, userId, action, object = 'npc', extra = {}, options = {}) => {
  const position = options.position ?? playerAt(object);
  const point = action === 'fire_hit' ? points.target : points[object];
  const playerYaw = options.playerYaw ?? (point
    ? Math.atan2(point.x - position.x, point.z - position.z)
    : 0);
  return handleFirefighterTask({
    db,
    userId,
    payload: { action, ...extra },
    playerPosition: position,
    playerYaw,
    interactionPoints: points,
    now: options.now ?? (() => 1000 + userId),
  });
};

function prepareFireDrill(db, userId) {
  invoke(db, userId, 'start');
  invoke(db, userId, 'accept_briefing');
  invoke(db, userId, 'equip', 'locker');
}

function setup() {
  const db = openDb(':memory:');
  const userA = db.createUser({ name: 'player-a', passHash: 'test', salt: 'test' }).id;
  const userB = db.createUser({ name: 'player-b', passHash: 'test', salt: 'test' }).id;
  return { db, userA, userB };
}

test('проверяет порядок этапов и отклоняет действие не по порядку', () => {
  const { db, userA } = setup();
  try {
    const outOfOrder = invoke(db, userA, 'equip', 'locker');
    assert.equal(outOfOrder.changed, false);
    assert.equal(outOfOrder.done, false);
    assert.equal(db.getTaskProgress(userA, FIREFIGHTER_TASK_ID), null);

    assert.equal(invoke(db, userA, 'start').state.stage, 'briefing');
    assert.equal(invoke(db, userA, 'accept_briefing').state.stage, 'equipping');
    assert.equal(invoke(db, userA, 'equip', 'locker').state.stage, 'fire_drill');
  } finally {
    db.close();
  }
});

test('повторные и недопустимые действия не записывают новый прогресс', () => {
  const { db, userA } = setup();
  try {
    invoke(db, userA, 'start');
    const before = db.getTaskProgress(userA, FIREFIGHTER_TASK_ID);
    const repeated = invoke(db, userA, 'start');
    assert.equal(repeated.changed, false);
    assert.deepEqual(repeated.state, before.state);
    assert.equal(db.getTaskProgress(userA, FIREFIGHTER_TASK_ID).updatedAt, before.updatedAt);
  } finally {
    db.close();
  }
});

test('отказывает без серверной позиции и при удалённом интерактивном объекте', () => {
  const { db, userA } = setup();
  try {
    const missingPosition = handleFirefighterTask({
      db, userId: userA, payload: { action: 'start' }, interactionPoints: points,
    });
    assert.equal(missingPosition.changed, false);
    assert.equal(db.getTaskProgress(userA, FIREFIGHTER_TASK_ID), null);

    const tooFar = handleFirefighterTask({
      db,
      userId: userA,
      payload: { action: 'start', position: at('npc'), progress: 100, done: true },
      playerPosition: { x: 100, y: 0, z: 100 },
      interactionPoints: points,
    });
    assert.equal(tooFar.done, false);
    assert.deepEqual(tooFar.state, createInitialState());
    assert.equal(db.getTaskProgress(userA, FIREFIGHTER_TASK_ID), null);
  } finally {
    db.close();
  }
});

test('fire_hit требует точного направления и ограничивает частоту зачёта', () => {
  const { db, userA } = setup();
  try {
    prepareFireDrill(db, userA);
    const aimed = playerAt('hose');
    const first = invoke(db, userA, 'fire_hit', 'hose', {}, { now: () => 5000 });
    assert.equal(first.state.fireHits, 1);

    const tooSoon = invoke(db, userA, 'fire_hit', 'hose', {}, { now: () => 5000 + FIRE_HIT_COOLDOWN_MS - 1 });
    assert.equal(tooSoon.changed, false);
    assert.equal(tooSoon.state.fireHits, 1);

    const wrongDirection = invoke(db, userA, 'fire_hit', 'hose', {}, {
      now: () => 5000 + FIRE_HIT_COOLDOWN_MS,
      position: aimed,
      playerYaw: 0,
    });
    assert.equal(wrongDirection.changed, false);
    assert.equal(wrongDirection.state.fireHits, 1);

    const ready = invoke(db, userA, 'fire_hit', 'hose', {}, {
      now: () => 5000 + FIRE_HIT_COOLDOWN_MS,
    });
    assert.equal(ready.state.fireHits, 2);
  } finally {
    db.close();
  }
});

test('игнорирует переданные клиентом state, done и процент выполнения', () => {
  const { db, userA } = setup();
  try {
    const spoofed = invoke(db, userA, 'report', 'npc', {
      state: { stage: 'completed', fireHits: FIRE_HIT_LIMIT, mannequinDelivered: true },
      done: true,
      progress: 100,
    });
    assert.equal(spoofed.done, false);
    assert.deepEqual(spoofed.state, createInitialState());
    assert.equal(db.getTaskProgress(userA, FIREFIGHTER_TASK_ID), null);
  } finally {
    db.close();
  }
});

test('SQLite восстанавливает прогресс после пересоздания обработчика', () => {
  const { db, userA } = setup();
  try {
    invoke(db, userA, 'start');
    invoke(db, userA, 'accept_briefing');
    invoke(db, userA, 'equip', 'locker');
    let timestamp = 2000;
    for (let hit = 0; hit < 7; hit++) {
      invoke(db, userA, 'fire_hit', 'hose', {}, { now: () => (timestamp += FIRE_HIT_COOLDOWN_MS) });
    }

    const restored = getFirefighterTaskState(db, userA);
    assert.equal(restored.state.stage, 'fire_drill');
    assert.equal(restored.state.fireHits, 7);
    assert.equal(restored.done, false);
  } finally {
    db.close();
  }
});

test('полный успех хранится один раз и повторный вход не сбрасывает результат', () => {
  const { db, userA } = setup();
  try {
    invoke(db, userA, 'start');
    invoke(db, userA, 'accept_briefing');
    invoke(db, userA, 'equip', 'locker');
    let timestamp = 2000;
    for (let hit = 0; hit < FIRE_HIT_LIMIT; hit++) {
      invoke(db, userA, 'fire_hit', 'hose', {}, { now: () => (timestamp += FIRE_HIT_COOLDOWN_MS) });
    }
    invoke(db, userA, 'pickup_mannequin', 'mannequin');
    invoke(db, userA, 'deliver_mannequin', 'safe_zone');
    const completed = invoke(db, userA, 'report');

    assert.equal(completed.state.stage, 'completed');
    assert.equal(completed.done, true);
    assert.equal(db.getTaskProgress(userA, FIREFIGHTER_TASK_ID).done, true);

    const repeat = invoke(db, userA, 'report');
    assert.equal(repeat.changed, false);
    assert.equal(getFirefighterTaskState(db, userA).done, true);
  } finally {
    db.close();
  }
});

test('два авторизованных игрока имеют независимые записи SQLite', () => {
  const { db, userA, userB } = setup();
  try {
    invoke(db, userA, 'start');
    invoke(db, userA, 'accept_briefing');
    invoke(db, userB, 'start');

    assert.equal(getFirefighterTaskState(db, userA).state.stage, 'equipping');
    assert.equal(getFirefighterTaskState(db, userB).state.stage, 'briefing');
    assert.equal(db.listTaskProgress(userA).length, 1);
    assert.equal(db.listTaskProgress(userB).length, 1);
  } finally {
    db.close();
  }
});

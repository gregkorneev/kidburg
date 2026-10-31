import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db/index.js';

const newUser = (db, name = 'Аня') => db.createUser({ name, passHash: 'h', salt: 's', now: 1000 });

test('схема применяется повторно без ошибок и без потери данных', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'city-db-'));
  const file = path.join(dir, 'nested', 'city.db');
  try {
    const first = openDb(file);
    assert.ok(existsSync(file), 'файл базы создаётся вместе с папкой');
    newUser(first);
    first.close();
    const second = openDb(file);
    assert.equal(second.findUserByName('Аня').name, 'Аня');
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('сырое соединение наружу не отдаётся', () => {
  const db = openDb(':memory:');
  for (const value of Object.values(db)) assert.equal(typeof value, 'function');
  db.close();
});

test('пользователи: создание, поиск без учёта регистра, дубликат', () => {
  const db = openDb(':memory:');
  const user = db.createUser({ name: 'Bob', passHash: 'hash', salt: 'salt', appearance: { hat: 1 }, now: 5 });
  assert.deepEqual(user, { id: user.id, name: 'Bob', appearance: { hat: 1 }, createdAt: 5 });
  assert.deepEqual(db.getUser(user.id), user);
  assert.equal(db.getUser(999), null);
  const found = db.findUserByName('bOB');
  assert.equal(found.id, user.id);
  assert.equal(found.passHash, 'hash');
  assert.equal(found.salt, 'salt');
  assert.equal(db.createUser({ name: 'BOB', passHash: 'x', salt: 'y' }), null);
  db.close();
});

test('сессии: срок жизни, удаление, очистка просроченных', () => {
  const db = openDb(':memory:');
  const { id } = newUser(db);
  db.createSession('live', id, 2000);
  db.createSession('old', id, 500);
  assert.deepEqual(db.findSession('live', 1500), { userId: id, expiresAt: 2000 });
  assert.equal(db.findSession('live', 2000), null, 'на границе срока сессия уже недействительна');
  assert.equal(db.findSession('nope', 0), null);
  assert.equal(db.purgeExpiredSessions(1000), 1);
  assert.equal(db.findSession('old', 0), null);
  db.deleteSession('live');
  assert.equal(db.findSession('live', 0), null);
  db.close();
});

test('позиция игрока: запись, обновление, чтение', () => {
  const db = openDb(':memory:');
  const { id } = newUser(db);
  assert.equal(db.getPlayerState(id), null);
  db.savePlayerState({ userId: id, x: 1, y: 2, z: 3, ry: 0.5, updatedAt: 10 });
  assert.deepEqual(db.getPlayerState(id), { x: 1, y: 2, z: 3, ry: 0.5, updatedAt: 10 });
  db.savePlayerState({ userId: id, x: 7, y: 0, z: 9, updatedAt: 11 });
  assert.deepEqual(db.getPlayerState(id), { x: 7, y: 0, z: 9, ry: 0, updatedAt: 11 });
  db.close();
});

test('пачка позиций пишется транзакцией: при ошибке не пишется ничего', () => {
  const db = openDb(':memory:');
  const a = newUser(db, 'user_a');
  const b = newUser(db, 'user_b');
  db.savePlayerStates([
    { userId: a.id, x: 1, y: 0, z: 1, ry: 0, updatedAt: 1 },
    { userId: b.id, x: 2, y: 0, z: 2, ry: 0, updatedAt: 1 },
  ]);
  assert.equal(db.getPlayerState(b.id).x, 2);

  assert.throws(() =>
    db.savePlayerStates([
      { userId: a.id, x: 100, y: 0, z: 100, ry: 0, updatedAt: 2 },
      { userId: 4242, x: 0, y: 0, z: 0, ry: 0, updatedAt: 2 }, // нет такого пользователя
    ]),
  );
  assert.equal(db.getPlayerState(a.id).x, 1, 'первая запись откатилась вместе со второй');
  db.close();
});

test('память агента: JSON туда и обратно, обновление', () => {
  const db = openDb(':memory:');
  const { id } = newUser(db);
  assert.equal(db.getAgentMemory(id, 'therapist'), null);
  db.saveAgentMemory(id, 'therapist', { toldCards: ['c1'], summary: 'итог', turns: [{ r: 'u', s: 'привет' }] }, 7);
  assert.deepEqual(db.getAgentMemory(id, 'therapist'), {
    userId: id,
    agentId: 'therapist',
    toldCards: ['c1'],
    summary: 'итог',
    turns: [{ r: 'u', s: 'привет' }],
    topics: {},
    updatedAt: 7,
  });
  db.saveAgentMemory(id, 'therapist', { toldCards: ['c1', 'c2'], topics: { a: 1 } }, 8);
  const mem = db.getAgentMemory(id, 'therapist');
  assert.deepEqual(mem.toldCards, ['c1', 'c2']);
  assert.deepEqual(mem.topics, { a: 1 });
  assert.equal(mem.summary, '');
  db.close();
});

test('прогресс задач: запись, обновление, список', () => {
  const db = openDb(':memory:');
  const { id } = newUser(db);
  assert.equal(db.getTaskProgress(id, 't1'), null);
  db.saveTaskProgress(id, 't1', { state: { step: 1 } }, 3);
  db.saveTaskProgress(id, 't2', { done: true }, 4);
  assert.deepEqual(db.getTaskProgress(id, 't1'), {
    userId: id,
    taskId: 't1',
    state: { step: 1 },
    done: false,
    updatedAt: 3,
  });
  db.saveTaskProgress(id, 't1', { state: { step: 2 }, done: true }, 5);
  assert.equal(db.getTaskProgress(id, 't1').done, true);
  assert.deepEqual(
    db.listTaskProgress(id).map((r) => [r.taskId, r.done]),
    [
      ['t1', true],
      ['t2', true],
    ],
  );
  db.close();
});

test('clearSessions удаляет все сессии, findUserByNameAnyCase не различает регистр кириллицы', () => {
  const db = openDb(':memory:');
  const user = newUser(db, 'Аня');
  db.createSession('a', user.id, 5000);
  db.createSession('b', user.id, 9000);
  assert.equal(db.clearSessions(), 2);
  assert.equal(db.findSession('a', 1000), null);
  assert.equal(db.findUserByName('аня'), null, 'точный поиск различает регистр кириллицы');
  assert.equal(db.findUserByNameAnyCase('аня').id, user.id);
  assert.equal(db.findUserByNameAnyCase('Никто'), null);
  db.close();
});

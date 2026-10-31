import test from 'node:test';
import assert from 'node:assert/strict';
import { ROOM_CODE_LENGTH, createAttemptLimiter, createRoom, generateRoomCode, normalizeRoomCode } from '../server/net/room.js';

test('generateRoomCode: четыре латинские заглавные буквы без гласных', () => {
  for (let i = 0; i < 200; i++) {
    const code = generateRoomCode();
    assert.equal(code.length, ROOM_CODE_LENGTH);
    assert.match(code, /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
  }
  const seen = new Set(Array.from({ length: 50 }, () => generateRoomCode()));
  assert.ok(seen.size > 1);
});

test('normalizeRoomCode: регистр и пробелы по краям не важны, остальное — отказ', () => {
  assert.equal(normalizeRoomCode(' bcdf '), 'BCDF');
  for (const bad of ['BCD', 'BCDFG', 'BC1F', 'ВСDF', 'BC F', '', null, undefined, 1234, ['BCDF']]) {
    assert.equal(normalizeRoomCode(bad), null, String(bad));
  }
});

test('createRoom: сравнение кода; чужой или кривой код не подходит', () => {
  const room = createRoom({ code: 'bcdf' });
  assert.equal(room.code, 'BCDF');
  assert.equal(room.matches('BCDF'), true);
  assert.equal(room.matches('bcdf'), true);
  assert.equal(room.matches('BCDG'), false);
  assert.equal(room.matches(undefined), false);
  assert.throws(() => createRoom({ code: 'AB1' }));
  assert.match(createRoom().code, /^[A-Z]{4}$/);
});

test('createAttemptLimiter: окно скользящее, ключи независимы', () => {
  let t = 0;
  const limiter = createAttemptLimiter({ max: 2, windowMs: 1000, now: () => t });
  limiter.fail('a');
  assert.equal(limiter.blocked('a'), false);
  t = 500;
  limiter.fail('a');
  assert.equal(limiter.blocked('a'), true);
  assert.equal(limiter.blocked('b'), false);
  t = 1000;
  assert.equal(limiter.blocked('a'), false, 'первая попытка вышла из окна');
});

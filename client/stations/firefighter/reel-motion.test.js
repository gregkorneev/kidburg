import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceReel, REEL_RADIUS, INITIAL_REEL_TURNS, woundTurns } from './reel-motion.js';

test('катушка неподвижна на месте, разматывается при удалении и наматывается при возвращении', () => {
  const initial = advanceReel(0, null, 2);
  assert.equal(advanceReel(initial, 2, 2), initial);
  const unwound = advanceReel(initial, 2, 4);
  assert.ok(Math.abs(unwound + 2 / REEL_RADIUS) < 1e-12);
  assert.ok(woundTurns(unwound) < INITIAL_REEL_TURNS);
  const returned = advanceReel(unwound, 4, 2);
  assert.ok(Math.abs(returned) < 1e-12);
  assert.ok(Math.abs(woundTurns(returned) - INITIAL_REEL_TURNS) < 1e-12);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { overlapsPlayerPath } from './player-collision.js';

const other = { x: 1, y: 0, z: 0, radius: 0.4, height: 1.8 };

test('player movement cannot cross another player or enter their space', () => {
  assert.equal(overlapsPlayerPath({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, other, 0.4), true);
  assert.equal(overlapsPlayerPath({ x: 0, y: 0, z: 0 }, { x: 0.5, y: 0, z: 0 }, other, 0.4), true);
  assert.equal(overlapsPlayerPath({ x: 0, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 }, other, 0.4), false);
});

test('vertical separation does not block and an existing overlap can be escaped', () => {
  assert.equal(overlapsPlayerPath({ x: 0, y: 3, z: 0 }, { x: 2, y: 3, z: 0 }, other, 0.4), false);
  assert.equal(overlapsPlayerPath({ x: 0.5, y: 0, z: 0 }, { x: 0.3, y: 0, z: 0 }, other, 0.4), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../shared/constants.js';

test('константы мира соответствуют спецификации', () => {
  assert.equal(C.CHUNK_SIZE, 64);
  assert.equal(C.WORLD_CHUNKS_TOTAL, 144);
  assert.equal(C.CACHE_MAX_CHUNKS, 14);
  assert.equal(C.TICK_HZ, 15);
  assert.equal(C.MAX_SPEED, 9);
  assert.equal(C.TALK_DISTANCE, 8);
});

test('SPAWN в центре чанка (6, 6)', () => {
  assert.equal(Math.floor(C.SPAWN.x / C.CHUNK_SIZE), 6);
  assert.equal(Math.floor(C.SPAWN.z / C.CHUNK_SIZE), 6);
});

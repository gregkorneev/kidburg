import test from 'node:test';
import assert from 'node:assert/strict';
import { turnNpcToward } from './npc-facing.js';

test('NPC поворачивается к игроку в радиусе и возвращается после ухода', () => {
  const npc = { rotation: { y: 0 } };
  const position = { x: 0, y: 0, z: 0 };
  assert.equal(turnNpcToward(npc, position, { x: 3, y: 0, z: 0 }, 1, 0), true);
  assert.ok(Math.abs(npc.rotation.y - Math.PI / 2) < 1e-9);
  assert.equal(turnNpcToward(npc, position, { x: 10, y: 0, z: 0 }, 1, 0), false);
  assert.ok(Math.abs(npc.rotation.y) < 1e-9);
  assert.equal(turnNpcToward(npc, position, { x: 1, y: 3, z: 0 }, 1, 0), false);
  assert.equal(turnNpcToward(npc, position, null, 1, 0), false);
});

test('учитывает направление модели и плавно поворачивает по короткому пути', () => {
  const npc = { rotation: { y: Math.PI - 0.1 } };
  const position = { x: 0, y: 0, z: 0 };
  turnNpcToward(npc, position, { x: 0, y: 0, z: 1 }, 0.1, 0, 10, Math.PI);
  assert.ok(npc.rotation.y > Math.PI - 0.1);
  assert.ok(npc.rotation.y < Math.PI);
});

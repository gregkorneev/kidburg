import test from 'node:test';
import assert from 'node:assert/strict';
import { cityGateColliders, pickCityInteraction } from './city-interactions.js';

test('ближайший NPC или механизм имеет единую цель E', () => {
  const entrances = { fire: { x: 10, z: 0, radius: 12, label: 'Вход' }, florist: { x: 100, z: 0, radius: 2 } };
  const npc = { x: 1, z: 0, radius: 3, id: 1 };
  const gate = { x: 2, z: 0, radius: 3, kind: 'gate', object: { label: 'Ворота' } };
  assert.equal(pickCityInteraction({ x: 0, z: 0 }, entrances, [gate], npc).kind, 'npc');
  assert.equal(pickCityInteraction({ x: 2, z: 0 }, entrances, [gate], npc).kind, 'mechanism');
  assert.equal(pickCityInteraction({ x: 10, z: 0 }, entrances, [gate], npc).kind, 'fire');
});

test('ворота добавляют коллизию до открытия и освобождают проход после подъёма', () => {
  const gate = { kind: 'gate', x: 10, z: 20, width: 4, depth: 0.2, minY: 0.5, maxY: 4.75, rotationY: 0, object: { blocking: true } };
  assert.deepEqual(cityGateColliders([gate]), [{
    x: 10, z: 20, minX: 8, maxX: 12, minY: 0.5, maxY: 4.75, minZ: 19.9, maxZ: 20.1,
    halfWidth: 2, halfDepth: 0.1, rotationY: 0,
  }]);
  gate.object.blocking = false;
  assert.deepEqual(cityGateColliders([gate]), []);
});

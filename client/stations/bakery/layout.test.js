import test from 'node:test';
import assert from 'node:assert/strict';
import { OBSTACLES, SPAWN, WALK_WAYPOINTS, ZONES, isWalkable } from './layout.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

test('план пекарни: зоны взаимодействия внутри комнаты, не пересекаются и доступны', () => {
  for (let i = 0; i < ZONES.length; i++) {
    const zone = ZONES[i];
    assert.ok(isWalkable(zone.x, zone.z), `${zone.id} должна быть доступна игроку`);
    assert.ok(Math.abs(zone.x) + zone.radius < 8.5, `${zone.id} внутри комнаты по X`);
    assert.ok(Math.abs(zone.z) + zone.radius < 6.5, `${zone.id} внутри комнаты по Z`);
    for (const other of ZONES.slice(i + 1)) {
      assert.ok(distance(zone, other) > zone.radius + other.radius, `${zone.id}/${other.id} не должны перекрываться`);
    }
  }
  assert.ok(isWalkable(SPAWN.x, SPAWN.z), 'стартовая точка свободна');
  for (const point of WALK_WAYPOINTS) assert.ok(isWalkable(point.x, point.z), `проход свободен: ${point.x},${point.z}`);
});

test('план пекарни: мебельные габариты не пересекаются', () => {
  for (let i = 0; i < OBSTACLES.length; i++) {
    const a = OBSTACLES[i];
    for (const b of OBSTACLES.slice(i + 1)) {
      const intersects = a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
      assert.equal(intersects, false, `${a.id}/${b.id} не должны пересекаться`);
    }
  }
});

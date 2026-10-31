import test from 'node:test';
import assert from 'node:assert/strict';
import { CHUNK_SIZE, SPAWN, WORLD_SIZE_X, WORLD_SIZE_Z } from '../../../shared/constants.js';
import { FIRE_ORIGIN, HOSE_REACH, LOCAL_POINTS, SERVER_MARGIN, START, WORLD_POINTS, toLocal, toWorld } from './layout.js';

test('преобразование: точка появления SPAWN — старт полигона, обратное преобразование точное', () => {
  assert.deepEqual(toWorld(START.x, START.z), { x: SPAWN.x, z: SPAWN.z });
  assert.deepEqual(toLocal(SPAWN.x, SPAWN.z), { x: START.x, z: START.z });
  for (const [x, z] of [[0, 0], [-7.6, 2.3], [43, -43], [9.2, 5.1]]) {
    const w = toWorld(x, z);
    const l = toLocal(w.x, w.z);
    assert.ok(Math.abs(l.x - x) < 1e-9 && Math.abs(l.z - z) < 1e-9);
  }
  assert.equal(toWorld(0, 0).x, FIRE_ORIGIN.x);
  assert.equal(toWorld(0, 0).z, FIRE_ORIGIN.z);
});

test('мировые точки станции: сдвиг без поворота и масштаба, внутри мира и рядом со спавном', () => {
  for (const [name, local] of Object.entries(LOCAL_POINTS)) {
    const world = WORLD_POINTS[name];
    assert.ok(Math.abs(world.x - (local.x + FIRE_ORIGIN.x)) < 1e-9, name);
    assert.ok(Math.abs(world.z - (local.z + FIRE_ORIGIN.z)) < 1e-9, name);
    assert.equal(world.y, 0);
    assert.ok(world.x > 0 && world.x < WORLD_SIZE_X && world.z > 0 && world.z < WORLD_SIZE_Z, name);
    // Вся станция в пределах одного соседнего чанка от спавна: игроки видят друг друга без догрузки.
    assert.ok(Math.abs(world.x - SPAWN.x) < CHUNK_SIZE && Math.abs(world.z - SPAWN.z) < CHUNK_SIZE, name);
    assert.equal(world.radius, local.radius > 0 ? local.radius + SERVER_MARGIN : 0, name);
  }
  assert.equal(LOCAL_POINTS.hose.radius, HOSE_REACH);
});

test('точки не пересекаются между собой радиусами взаимодействия там, где это сломало бы порядок', () => {
  const dist = (a, b) => Math.hypot(LOCAL_POINTS[a].x - LOCAL_POINTS[b].x, LOCAL_POINTS[a].z - LOCAL_POINTS[b].z);
  assert.ok(dist('locker', 'npc') > LOCAL_POINTS.locker.radius, 'шкаф и Маруся различимы');
  assert.ok(dist('mannequin', 'safe_zone') > 2.6, 'манекен и зона не совпадают');
});

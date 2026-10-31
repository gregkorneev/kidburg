import test from 'node:test';
import assert from 'node:assert/strict';
import { CHUNK_SIZE, SPAWN, WORLD_SIZE_X, WORLD_SIZE_Z } from '../../../shared/constants.js';
import {
  FIRE_ORIGIN,
  HOSE_REACH,
  LOCAL_POINTS,
  LOCAL_WINDOWS,
  SERVER_MARGIN,
  START,
  WALL,
  WINDOW_DEPTH,
  WORLD_POINTS,
  WORLD_WINDOWS,
  toLocal,
  toWorld,
} from './layout.js';
import { SAFETY_ZONE, insideSafetyZone } from './safety-zone.js';
import { WINDOW_COUNT } from './state.js';

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

test('окна учебной стены: четыре центра на лицевой стороне, мировые координаты — сдвиг локальных', () => {
  assert.equal(LOCAL_WINDOWS.length, WINDOW_COUNT);
  assert.equal(WORLD_WINDOWS.length, WINDOW_COUNT);
  LOCAL_WINDOWS.forEach((w, i) => {
    assert.equal(w.z, WALL.z + WINDOW_DEPTH, `окно ${i} на лицевой стороне`);
    const world = WORLD_WINDOWS[i];
    assert.ok(Math.abs(world.x - (w.x + FIRE_ORIGIN.x)) < 1e-9 && Math.abs(world.z - (w.z + FIRE_ORIGIN.z)) < 1e-9, `окно ${i}`);
    assert.equal(world.y, w.y);
    assert.ok(world.x > 0 && world.z > 0);
  });
  // Нижний ряд ниже верхнего; левые окна левее правых; все окна различны.
  assert.ok(LOCAL_WINDOWS[0].x < LOCAL_WINDOWS[1].x && LOCAL_WINDOWS[2].x < LOCAL_WINDOWS[3].x);
  assert.ok(LOCAL_WINDOWS[0].y < LOCAL_WINDOWS[2].y && LOCAL_WINDOWS[1].y < LOCAL_WINDOWS[3].y);
  assert.equal(new Set(LOCAL_WINDOWS.map((w) => `${w.x}:${w.y}`)).size, WINDOW_COUNT);
  assert.equal('target' in LOCAL_POINTS, false, 'отдельной мишени больше нет');
});

test('зона безопасности охватывает стену; шкаф, Маруся, рукав и старт — вне зоны, рукав достаёт до линии', () => {
  assert.ok(SAFETY_ZONE.minX <= WALL.x - 3.4 && SAFETY_ZONE.maxX >= WALL.x + 3.4);
  assert.ok(SAFETY_ZONE.minZ <= WALL.z - 0.4 && SAFETY_ZONE.maxZ >= WALL.z + WINDOW_DEPTH);
  for (const name of ['npc', 'locker', 'hose']) {
    assert.equal(insideSafetyZone(LOCAL_POINTS[name].x, LOCAL_POINTS[name].z), false, name);
  }
  assert.equal(insideSafetyZone(START.x, START.z), false);
  // Любая точка передней линии зоны (отсюда стреляют) не дальше длины рукава от стойки.
  for (let x = SAFETY_ZONE.minX; x <= SAFETY_ZONE.maxX; x += 0.5) {
    assert.ok(Math.hypot(x - LOCAL_POINTS.hose.x, SAFETY_ZONE.maxZ - LOCAL_POINTS.hose.z) <= HOSE_REACH, `x = ${x}`);
  }
});

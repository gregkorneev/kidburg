import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as THREE from 'three';
import { encode } from '@msgpack/msgpack';
import { makeFixtures } from '../../tools/fixtures/make-fixtures.mjs';
import { createChunkManager, heightInChunk, parseChunk } from './chunks.js';
import { createPool } from './pool.js';
import { collides } from './player.js';

const dir = mkdtempSync(path.join(tmpdir(), 'city-client-world-'));
makeFixtures(dir);
test.after(() => rmSync(dir, { recursive: true, force: true }));
const fixtureBytes = (cx, cz) => new Uint8Array(readFileSync(path.join(dir, 'chunks', `${cx}_${cz}.bin`)));

function makeManager() {
  const scene = new THREE.Scene();
  const pool = createPool();
  const removedLabels = [];
  const createLabel = () => {
    const label = new THREE.Object3D();
    label.element = { remove: () => removedLabels.push(true) };
    return label;
  };
  return { scene, pool, removedLabels, manager: createChunkManager({ scene, pool, createLabel }) };
}

/** Чанк с наклонной землёй и заданными инстансами. */
function syntheticChunk(cx, cz, { instances = [], npcs = [] } = {}) {
  const heights = new Float32Array(17 * 17);
  for (let iz = 0; iz < 17; iz++) for (let ix = 0; ix < 17; ix++) heights[iz * 17 + ix] = ix * 0.5;
  return encode({ v: 1, cx, cz, zone: 'plain', heights, instances, npcs });
}

test('parseChunk: разбирает настоящий файл фикстур, heights → Float32Array 17×17', () => {
  const chunk = parseChunk(fixtureBytes(6, 6));
  assert.equal(chunk.zone, 'hospital');
  assert.ok(chunk.heights instanceof Float32Array);
  assert.equal(chunk.heights.length, 289);
  assert.equal(chunk.instances[0].length, 6);
  assert.throws(() => parseChunk(encode({ v: 2, cx: 0, cz: 0 })), /формат/);
  assert.throws(() => parseChunk(encode({ v: 1, cx: 0, cz: 0, heights: new Float32Array(4) })), /17×17/);
});

test('heightInChunk: совпадает с узлами сетки и интерполирует внутри клетки', () => {
  const heights = new Float32Array(17 * 17);
  for (let iz = 0; iz < 17; iz++) for (let ix = 0; ix < 17; ix++) heights[iz * 17 + ix] = ix * 2; // склон по X: 0.5 м/м
  assert.equal(heightInChunk(heights, 0, 0), 0);
  assert.equal(heightInChunk(heights, 8, 20), 4);
  assert.ok(Math.abs(heightInChunk(heights, 6, 33) - 3) < 1e-6);
  assert.ok(Math.abs(heightInChunk(heights, 64, 64) - 32) < 1e-6, 'правый край чанка не выходит за сетку');
  assert.equal(heightInChunk(heights, -5, -5), 0, 'за краем берётся ближайшее значение');
});

test('загрузка: рельеф, одна InstancedMesh на префаб, коллайдеры и NPC', () => {
  const { manager, scene } = makeManager();
  manager.load(6, 6, fixtureBytes(6, 6));
  assert.equal(manager.size, 1);
  assert.equal(scene.children.length, 1);

  const entry = scene.children[0];
  const meshes = entry.children.filter((o) => o.isInstancedMesh);
  const chunk = parseChunk(fixtureBytes(6, 6));
  const prefabs = new Set(chunk.instances.map((i) => i[0]));
  assert.equal(meshes.length, prefabs.size, 'инстансы сгруппированы по префабам');
  assert.equal(
    meshes.reduce((n, m) => n + m.count, 0),
    chunk.instances.length,
  );
  assert.ok(manager.collidersNear(6.5 * 64, 6.5 * 64).length > 0);
  assert.equal(manager.heightAt(6.5 * 64, 6.5 * 64), 0);
  assert.equal(manager.heightAt(0, 0), null, 'чанк не загружен — высоты нет');

  const npc = manager.nearestNpc(6 * 64 + 40, 0, 6 * 64 + 32, 8);
  assert.equal(npc.agentId, 'therapist');
  assert.equal(manager.nearestNpc(6 * 64 + 40, 0, 6 * 64 + 32 + 20, 8), null, 'дальше TALK_DISTANCE');
  assert.equal(manager.nearestNpc(6 * 64 + 40, 50, 6 * 64 + 32, 8), null, 'другой этаж не считается');
});

test('коллайдер повернутой цветочной лавки пропускает к ее фасаду', () => {
  const { manager } = makeManager();
  const yaw = 2.37;
  const distance = 7.5;
  const x = 384 + Math.sin(yaw) * distance;
  const z = 449 + Math.cos(yaw) * distance;
  manager.load(6, 7, syntheticChunk(6, 7, { instances: [[13, 384, 0, 449, yaw, 1]] }));

  const colliders = manager.collidersNear(x, z);
  assert.equal(collides(colliders, x, 0, z), false, 'подход перед фасадом остаётся свободным');
  assert.equal(collides(colliders, 384, 0, 449), true, 'внутри здания остаётся коллизия');
  manager.dispose();
});

test('выгрузка освобождает геометрии, материалы и подписи', () => {
  const { manager, scene, pool, removedLabels } = makeManager();
  manager.load(6, 6, fixtureBytes(6, 6));
  const entry = scene.children[0];
  const disposed = [];
  const watch = (obj, name) => obj.addEventListener('dispose', () => disposed.push(name));
  const terrain = entry.children.find((o) => o.isMesh && !o.isInstancedMesh);
  watch(terrain.geometry, 'terrain-geo');
  for (const mesh of entry.children.filter((o) => o.isInstancedMesh)) {
    watch(mesh, 'instanced');
    watch(mesh.geometry, 'prefab-geo');
    watch(mesh.material, 'prefab-mat');
  }
  watch(terrain.material, 'terrain-mat');
  assert.ok(pool.size > 0);

  manager.unload(6, 6);
  assert.equal(manager.size, 0);
  assert.equal(scene.children.length, 0);
  assert.equal(pool.size, 0, 'общие ресурсы отпущены');
  for (const kind of ['terrain-geo', 'terrain-mat', 'instanced', 'prefab-geo', 'prefab-mat']) {
    assert.ok(disposed.includes(kind), `не освобождено: ${kind}`);
  }
  assert.ok(removedLabels.length >= 1, 'подписи NPC убраны из DOM');
  manager.unload(6, 6); // повторная выгрузка безопасна
});

test('общие геометрии живут, пока ими пользуется хотя бы один чанк', () => {
  const { manager, pool } = makeManager();
  const inst = [[1, 64 * 3 + 5, 0, 64 * 3 + 5, 0, 1]];
  manager.load(3, 3, syntheticChunk(3, 3, { instances: inst }));
  manager.load(4, 3, syntheticChunk(4, 3, { instances: [[1, 64 * 4 + 5, 0, 64 * 3 + 5, 0, 1]] }));
  const geo = [...manager.collidersNear(3.5 * 64, 3.5 * 64)];
  assert.equal(geo.length, 2);
  manager.unload(3, 3);
  assert.ok(pool.size > 0, 'второй чанк ещё использует префаб');
  manager.unload(4, 3);
  assert.equal(pool.size, 0);
});

test('повторная загрузка заменяет чанк, чужие координаты отклоняются, dispose чистит всё', () => {
  const { manager, scene, pool } = makeManager();
  manager.load(2, 2, syntheticChunk(2, 2));
  manager.load(2, 2, syntheticChunk(2, 2));
  assert.equal(manager.size, 1);
  assert.equal(scene.children.length, 1);
  assert.throws(() => manager.load(5, 5, syntheticChunk(2, 2)), /в данных/);
  assert.ok(Math.abs(manager.heightAt(2 * 64 + 8, 2 * 64 + 8) - 1) < 1e-6, 'склон 0,5 м на узел: на 8 м высота 1');
  manager.dispose();
  assert.equal(manager.size, 0);
  assert.equal(pool.size, 0);
});

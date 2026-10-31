import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { encode } from '@msgpack/msgpack';
import { buildCityHallGeometry } from './procedural-city.js';
import { getPrefab } from './prefabs.js';
import { createChunkManager } from './chunks.js';
import { createPool } from './pool.js';

test('мэрия: составная цветная геометрия, сохранён коллайдер', () => {
  const prefab = getPrefab(10);
  assert.equal(prefab.vertexColors, true);
  assert.deepEqual(prefab.collider, [22, 9, 14]);
  const geometry = buildCityHallGeometry();
  geometry.computeBoundingBox();
  assert.ok(geometry.boundingBox.max.y > 10);
  assert.ok(geometry.boundingBox.min.y >= -0.01);
  assert.ok(geometry.getAttribute('color'));
  const arr = geometry.getAttribute('color').array;
  const colors = new Set();
  for (let i = 0; i < arr.length; i += 3) colors.add(`${arr[i].toFixed(3)},${arr[i + 1].toFixed(3)},${arr[i + 2].toFixed(3)}`);
  assert.ok(colors.size >= 5, 'разные цвета фасада, окон, кровли и колонн');
  geometry.dispose();
});

test('чанк с мэрией использует vertexColors и освобождает ресурсы', () => {
  const scene = new THREE.Scene();
  const pool = createPool();
  const manager = createChunkManager({ scene, pool });
  const heights = new Float32Array(17 * 17);
  const bytes = encode({ v: 1, cx: 6, cz: 6, zone: 'plain', heights,
    instances: [[10, 416, 0, 387, 0, 1]], npcs: [] });
  manager.load(6, 6, bytes);
  const cityHall = scene.children[0].children.find(o => o.isInstancedMesh);
  assert.ok(cityHall);
  assert.equal(cityHall.material.vertexColors, true);
  assert.ok(cityHall.geometry.getAttribute('color'));
  manager.unload(6, 6);
  assert.equal(scene.children.length, 0);
  assert.equal(pool.size, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { encode } from '@msgpack/msgpack';
import { createChunkManager } from './chunks.js';
import { createSignDecor, decoratePlaza, disposeDecor } from './city-decor.js';
import { buildPathGeometry, pathIdAt } from './city-paths.js';
import { createPool } from './pool.js';
import { getPrefabVariant, variantKey } from './prefabs.js';
import { PATHS } from '../../tools/build-world/layout.js';
import { CITY_HALL_SIGNS } from './procedural-city.js';

const instance = { x: 32, y: 0, z: 32, ry: 0, scale: 1 };

test('декор площади: вода, струи, растения, подъезды и полное освобождение', () => {
  const group = new THREE.Group();
  const decor = decoratePlaza({ group, instance, quality: 'high' });
  const root = group.children[0];
  const meshes = [];
  root.traverse((o) => { if (o.isMesh || o.isPoints) meshes.push(o); });
  assert.ok(meshes.length >= 10, 'вода + струи + подъезды + растения');
  const jets = meshes.find((o) => o.isPoints);
  const high = jets.geometry.drawRange.count;
  decor.setQuality('low');
  assert.ok(jets.geometry.drawRange.count < high, 'на низкой графике частиц меньше');
  decor.update(0.016, 3);
  const water = meshes.find((o) => o.material?.uniforms?.uTime && o.isMesh);
  assert.equal(water.material.uniforms.uTime.value, 3);
  let disposed = 0;
  for (const m of meshes) {
    if (!m.geometry.userData.shared) m.geometry.addEventListener('dispose', () => { disposed += 1; });
  }
  decor.dispose();
  assert.equal(group.children.length, 0);
  assert.ok(disposed >= 3, 'собственные геометрии освобождены');
});

test('декор площади: общие геометрии растений не освобождаются при выгрузке', () => {
  const group = new THREE.Group();
  const decor = decoratePlaza({ group, instance, quality: 'medium' });
  const shared = [];
  group.traverse((o) => { if (o.isInstancedMesh) shared.push(o.geometry); });
  assert.ok(shared.length >= 5 && shared.every((g) => g.userData.shared));
  let events = 0;
  shared.forEach((g) => g.addEventListener('dispose', () => { events += 1; }));
  decor.dispose();
  assert.equal(events, 0);
});

test('вывески: рамка и табличка на здание, поворот инстанса, освобождение', () => {
  const group = new THREE.Group();
  const decor = createSignDecor(CITY_HALL_SIGNS)({ group, instance: { ...instance, ry: Math.PI / 2 } });
  const plate = group.children[0].children[0];
  assert.ok(plate.userData.isSign);
  assert.ok(Math.abs(plate.rotation.y - Math.PI / 2) < 1e-9);
  decor.dispose();
  assert.equal(group.children.length, 0);
  disposeDecor(new THREE.Group());
});

test('дорожки: вариант выбирается по положению, размеры совпадают с планом', () => {
  for (const p of PATHS) {
    assert.equal(pathIdAt(p.x, p.z), p.id);
    assert.equal(variantKey(21, p.x, p.z), p.id);
    const g = getPrefabVariant(21, p.id).build();
    g.computeBoundingBox();
    assert.ok(Math.abs(g.boundingBox.max.x - g.boundingBox.min.x - p.width) < 0.1, `${p.id}: ширина`);
    assert.ok(g.boundingBox.max.y < 0.095 && g.boundingBox.min.y >= -0.01, `${p.id}: лежит ниже мощения (0.1)`);
    g.dispose();
  }
  assert.equal(variantKey(21, 1, 1), '');
  assert.ok(buildPathGeometry({ width: 3, depth: 3 }).attributes.color);
});

test('чанк центра: площадь, здания и дорожки собираются и выгружаются без утечек', () => {
  const scene = new THREE.Scene();
  const pool = createPool();
  const manager = createChunkManager({ scene, pool });
  const instances = [[20, 416, 0, 416, 0, 1], [21, 416, 0, 400, 0, 1], [21, 395, 0, 416, 0, 1], [10, 416, 0, 387, 0, 1], [1, 400, 0, 400, 0.3, 1], [1, 410.4, 0, 402.2, 0, 1]];
  const bytes = encode({ v: 1, cx: 6, cz: 6, zone: 'plain', heights: new Float32Array(289), instances, npcs: [] });
  manager.load(6, 6, bytes);
  const group = scene.children[0];
  const instanced = group.children.filter((o) => o.isInstancedMesh);
  assert.ok(instanced.length >= 5, 'варианты дорожек и деревьев — отдельные меши');
  assert.ok(instanced.every((m) => m.material.vertexColors));
  assert.ok(group.children.length >= instanced.length + 3, 'декор добавлен в группу чанка');
  manager.setQuality('low');
  manager.update(0.016, 1, null);
  manager.unload(6, 6);
  assert.equal(scene.children.length, 0);
  assert.equal(pool.size, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WORLD_OBJECT_TYPE_IDS } from '../../shared/world-objects.js';
import { createDynamicObjects } from './dynamic-objects.js';
import { createPool } from './pool.js';

function setup(options = {}) {
  const scene = new THREE.Scene();
  const pool = createPool();
  const removedLabels = [];
  const createLabel = (text) => {
    const label = new THREE.Object3D();
    label.element = { textContent: text, remove: () => removedLabels.push(text) };
    return label;
  };
  return { scene, pool, removedLabels, dyn: createDynamicObjects({ scene, pool, createLabel, heightAt: () => 0.5, ...options }) };
}

const obj = (id, type, x, z, rev = 1, extra = {}) => ({ id, type, x, z, ry: 0, scale: 1, params: {}, rev, ...extra });
const withParams = (o) => ({ ...o, params: o.type === 'tree' ? { variant: 'round' } : o.type === 'sign' ? { text: 'Привет' } : o.type === 'flowerbed' || o.type === 'bush' || o.type === 'rock' ? { tone: 0 } : {} });

test('каждый разрешённый тип строится: меш в сцене, коллайдер, высота по рельефу', () => {
  const { dyn, scene } = setup();
  WORLD_OBJECT_TYPE_IDS.forEach((type, i) => assert.equal(dyn.upsert(withParams(obj(`o_${i}`, type, 100 + i * 5, 100))), true, type));
  assert.equal(dyn.size, WORLD_OBJECT_TYPE_IDS.length);
  const meshes = scene.children.filter((c) => c.isMesh);
  assert.equal(meshes.length, dyn.size);
  assert.ok(meshes.every((m) => m.position.y === 0.5 && m.geometry.attributes.color));
  assert.equal(dyn.collidersNear(100, 100).length, dyn.size);
  dyn.dispose();
});

test('неизвестный тип и устаревшие сообщения игнорируются, воскрешения удалённого нет', () => {
  const { dyn } = setup();
  assert.equal(dyn.upsert(obj('o_x', 'virus', 1, 1)), false);
  assert.equal(dyn.upsert({ id: 5 }), false);
  assert.equal(dyn.upsert(obj('o_a', 'lamp', 100, 100, 5)), true);
  assert.equal(dyn.upsert(obj('o_a', 'lamp', 120, 100, 4)), false, 'старая ревизия не заменяет новую');
  assert.equal(dyn.get('o_a').x, 100);
  assert.equal(dyn.upsert(obj('o_a', 'lamp', 120, 100, 6)), true);
  assert.equal(dyn.get('o_a').x, 120);
  assert.equal(dyn.remove('o_a', 6), true);
  assert.equal(dyn.has('o_a'), false);
});

test('перемещение и поворот обновляют меш и коллайдер, не плодя дубликатов', () => {
  const { dyn, scene } = setup();
  dyn.upsert(obj('o_a', 'bench', 100, 100));
  dyn.upsert(obj('o_a', 'bench', 430, 440, 2, { ry: 1, scale: 1.2 }));
  assert.equal(dyn.size, 1);
  assert.equal(scene.children.filter((c) => c.isMesh).length, 1);
  const mesh = scene.children.find((c) => c.isMesh);
  assert.deepEqual([mesh.position.x, mesh.position.z, mesh.rotation.y, mesh.scale.x], [430, 440, 1, 1.2]);
  assert.equal(dyn.collidersNear(100, 100).length, 0);
  assert.equal(dyn.collidersNear(430, 440).length, 1);
});

test('ресурсы освобождаются: удаление, выгрузка чанка и очистка возвращают пул в ноль', () => {
  const { dyn, scene, pool, removedLabels } = setup();
  dyn.upsert(obj('o_a', 'tree', 10, 10, 1, { params: { variant: 'pine' } }));
  dyn.upsert(obj('o_b', 'tree', 12, 10, 1, { params: { variant: 'pine' } }));
  dyn.upsert(obj('o_c', 'sign', 90, 10, 1, { params: { text: 'Вход' } })); // другой чанк (cx = 1)
  assert.ok(pool.size >= 3, 'геометрия дерева общая у двух экземпляров');
  const sizeWithTwoTrees = pool.size;
  dyn.remove('o_a');
  assert.equal(pool.size, sizeWithTwoTrees, 'второе дерево ещё держит геометрию');
  dyn.unloadChunk(0, 0);
  assert.equal(dyn.has('o_b'), false);
  assert.equal(dyn.has('o_c'), true);
  assert.ok(pool.size < sizeWithTwoTrees);
  dyn.clear();
  assert.equal(pool.size, 0, 'все геометрии и материалы освобождены');
  assert.equal(scene.children.length, 0);
  assert.deepEqual(removedLabels, ['Вход'], 'подпись снята из DOM');
});

test('снимок чанка убирает объекты, которых на сервере больше нет, и не трогает соседние чанки', () => {
  const { dyn } = setup();
  dyn.upsert(obj('o_a', 'lamp', 10, 10));
  dyn.upsert(obj('o_b', 'lamp', 20, 10));
  dyn.upsert(obj('o_far', 'lamp', 100, 10));
  dyn.snapshot(0, 0, [obj('o_a', 'lamp', 10, 10, 2)]);
  assert.deepEqual(dyn.ids().sort(), ['o_a', 'o_far']);
});

test('текст таблички меняется без пересоздания меша; смена вида дерева пересоздаёт геометрию', () => {
  const { dyn, removedLabels, scene } = setup();
  dyn.upsert(obj('o_s', 'sign', 50, 50, 1, { params: { text: 'А' } }));
  dyn.upsert(obj('o_s', 'sign', 50, 50, 2, { params: { text: 'Б' } }));
  assert.deepEqual(removedLabels, ['А']);
  dyn.upsert(obj('o_t', 'tree', 60, 60, 1, { params: { variant: 'round' } }));
  const before = scene.children.find((c) => c.name === 'dyn:o_t').geometry;
  dyn.upsert(obj('o_t', 'tree', 60, 60, 2, { params: { variant: 'birch' } }));
  const after = scene.children.find((c) => c.name === 'dyn:o_t').geometry;
  assert.notEqual(before, after);
  assert.equal(dyn.size, 2);
});

test('страховка размера: сверх лимита новые объекты не принимаются', () => {
  const { dyn } = setup({ maxObjects: 3 });
  for (let i = 0; i < 5; i++) dyn.upsert(obj(`o_${i}`, 'lamp', 10 + i * 4, 10));
  assert.equal(dyn.size, 3);
});

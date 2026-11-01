import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createView, worldToScreen, screenToWorld, zoomAt, panBy, fitView, clampView, SCALE_MAX, SCALE_MIN,
  emptyWorld, worldFromSnapshot, applyWorldEvent, needsReload, listObjects, defaultParams, clampObjectScale, hitObject, typeIndex, snap,
} from './world.js';

const size = { w: 800, h: 600 };
const obj = (id, rev, over = {}) => ({ id, type: 'bench', x: 10, z: 10, ry: 0, scale: 1, params: {}, rev, ...over });

test('преобразование координат туда и обратно', () => {
  const v = createView({ x: 416, z: 416 }, 4);
  const s = worldToScreen(v, size, 416, 416);
  assert.deepEqual(s, { sx: 400, sy: 300 });
  const w = screenToWorld(v, size, 480, 340);
  assert.deepEqual(w, { x: 436, z: 426 });
  const back = worldToScreen(v, size, w.x, w.z);
  assert.deepEqual(back, { sx: 480, sy: 340 });
});

test('zoomAt сохраняет мировую точку под курсором и ограничивает масштаб', () => {
  const v = createView({ x: 400, z: 400 }, 3);
  const before = screenToWorld(v, size, 600, 200);
  const z = zoomAt(v, size, 2, 600, 200);
  const after = screenToWorld(z, size, 600, 200);
  assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.z - after.z) < 1e-9);
  assert.equal(z.scale, 6);
  assert.equal(zoomAt(v, size, 1000, 0, 0).scale, SCALE_MAX);
  assert.equal(zoomAt(v, size, 0.0001, 0, 0).scale, SCALE_MIN);
});

test('panBy и clampView', () => {
  const v = panBy(createView({ x: 100, z: 100 }, 2), 20, -40);
  assert.equal(v.cx, 90);
  assert.equal(v.cz, 120);
  assert.equal(clampView({ cx: -5, cz: 9999, scale: 1 }).cx, 0);
  assert.equal(clampView({ cx: -5, cz: 9999, scale: 1 }).cz, 768);
  const f = fitView(size);
  assert.equal(f.scale, 600 / 768);
});

test('upsert и remove с проверкой rev', () => {
  let w = worldFromSnapshot([obj('o_1', 1)], 5);
  w = applyWorldEvent(w, { revision: 6, ops: [{ op: 'upsert', object: obj('o_1', 6, { x: 20 }) }] });
  assert.equal(w.objects.get('o_1').x, 20);
  assert.equal(w.revision, 6);
  // устаревшая версия игнорируется
  const same = applyWorldEvent(w, { revision: 6, ops: [{ op: 'upsert', object: obj('o_1', 3, { x: 99 }) }] });
  assert.equal(same, w);
  assert.equal(same.objects.get('o_1').x, 20);
});

test('удалённый объект не воскресает запоздавшим upsert, но может быть создан заново новой ревизией', () => {
  let w = worldFromSnapshot([obj('o_1', 1)], 5);
  w = applyWorldEvent(w, { revision: 7, ops: [{ op: 'remove', id: 'o_1', rev: 7 }] });
  assert.equal(w.objects.size, 0);
  const late = applyWorldEvent(w, { revision: 6, ops: [{ op: 'upsert', object: obj('o_1', 6) }] });
  assert.equal(late.objects.size, 0, 'запоздавший upsert отброшен');
  const undo = applyWorldEvent(w, { revision: 8, ops: [{ op: 'upsert', object: obj('o_1', 8) }] });
  assert.equal(undo.objects.size, 1, 'отмена удаления восстанавливает объект');
  assert.equal(undo.tombstones.has('o_1'), false);
});

test('повтор того же события идемпотентен, исходное состояние не мутируется', () => {
  const w0 = worldFromSnapshot([], 1);
  const ev = { revision: 2, ops: [{ op: 'upsert', object: obj('o_2', 2) }] };
  const w1 = applyWorldEvent(w0, ev);
  assert.equal(w0.objects.size, 0);
  assert.equal(w1.objects.size, 1);
  assert.equal(applyWorldEvent(w1, ev), w1);
});

test('очистка: несколько remove в одной ревизии; needsReload по счётчику', () => {
  let w = worldFromSnapshot([obj('o_1', 1), obj('o_2', 2)], 3);
  w = applyWorldEvent(w, { revision: 4, ops: [{ op: 'remove', id: 'o_1', rev: 4 }, { op: 'remove', id: 'o_2', rev: 4 }] });
  assert.equal(w.objects.size, 0);
  assert.equal(needsReload(w, 0), false);
  assert.equal(needsReload(w, 2), true);
  assert.equal(needsReload(w, undefined), false);
});

test('listObjects: фильтр по типу, новые сверху', () => {
  const w = worldFromSnapshot([obj('o_1', 1, { createdAt: 1 }), obj('o_2', 2, { createdAt: 3, type: 'tree' }), obj('o_3', 3, { createdAt: 2 })], 3);
  assert.deepEqual(listObjects(w).map((o) => o.id), ['o_2', 'o_3', 'o_1']);
  assert.deepEqual(listObjects(w, 'bench').map((o) => o.id), ['o_3', 'o_1']);
});

test('типы: параметры по умолчанию, масштаб, попадание по объекту', () => {
  const types = [{ id: 'tree', radius: 0.8, scale: [0.7, 1.6], params: [{ key: 'variant', default: 'round' }] }, { id: 'bench', radius: 1.2, scale: [0.8, 1.4], params: [] }];
  assert.deepEqual(defaultParams(types[0]), { variant: 'round' });
  assert.equal(clampObjectScale(types[0], 5), 1.6);
  assert.equal(clampObjectScale(types[0], 0.1), 0.7);
  assert.equal(clampObjectScale(types[0], 'x'), 1);
  const idx = typeIndex(types);
  const objs = [obj('a', 1, { type: 'bench', x: 50, z: 50 }), obj('b', 1, { type: 'tree', x: 52, z: 50 })];
  assert.equal(hitObject(objs, idx, 52.1, 50).id, 'b');
  assert.equal(hitObject(objs, idx, 200, 200), null);
  assert.equal(snap(1.23456), 1.23);
});

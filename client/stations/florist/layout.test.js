import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFloristLayout } from './layout.js';
import { FLORIST_PLAN, ROOM } from './layout-plan.js';
import { createInitialState, ORDER } from './state.js';
import { targetsForState } from './targets.js';

test('интерьер безопасно освобождает вывески, цветы и геометрию', () => {
  const layout = buildFloristLayout();
  assert.equal(Object.keys(layout.buckets).length, 4);
  assert.equal(layout.setQuality('low'), 6);
  assert.equal(layout.setQuality('medium'), 11);
  assert.equal(layout.setQuality('high'), 16);
  assert.doesNotThrow(() => layout.dispose());
});

test('точки четырёх действий доступны вокруг мебели и внутренних коллайдеров', () => {
  const layout = buildFloristLayout();
  const points = [...Object.values(layout.buckets).map((bucket) => bucket.position), ...Object.values(layout.stations)];
  const furniture = layout.colliders.filter((box) => box.minX > 0.3 && box.maxX < 13.7 && box.minZ > 0.3 && box.maxZ < 9.7);
  for (const point of points) {
    const blocked = furniture.some((box) => point.x >= box.minX && point.x <= box.maxX && point.z >= box.minZ && point.z <= box.maxZ);
    assert.equal(blocked, false, `interaction target at ${point.x}, ${point.z} is inside furniture`);
  }
  layout.dispose();
});

test('комната расширена, игровые зоны входят в границы и сохраняют проходы', () => {
  assert.deepEqual(ROOM, { width: 20, depth: 15, height: 6 });
  const layout = buildFloristLayout();
  const allPoints = [FLORIST_PLAN.spawn, ...Object.values(layout.stations), ...Object.values(layout.buckets).map(({ position }) => position)];
  for (const point of allPoints) {
    assert.ok(point.x > 0.3 && point.x < ROOM.width - 0.3);
    assert.ok(point.z > 0.3 && point.z < ROOM.depth - 0.3);
    assert.ok(!layout.colliders.some((box) => point.x >= box.minX && point.x <= box.maxX && point.z >= box.minZ && point.z <= box.maxZ));
  }
  layout.dispose();
});

test('блокеры камеры учитывают стены комнаты 20×15 и крупные столы, фасад остаётся открытым', () => {
  const layout = buildFloristLayout();
  assert.ok(layout.cameraBlockers.some((box) => box.minX === 0 && box.maxX === 0.3 && box.maxZ === ROOM.depth));
  assert.ok(layout.cameraBlockers.some((box) => box.minX === ROOM.width - 0.3 && box.maxX === ROOM.width));
  assert.ok(layout.cameraBlockers.some((box) => box.maxZ === ROOM.depth && box.minZ === ROOM.depth - 0.3));
  assert.ok(layout.cameraBlockers.some((box) => box.maxX === FLORIST_PLAN.desks.workbench.x + FLORIST_PLAN.desks.workbench.width / 2));
  assert.ok(!layout.cameraBlockers.some((box) => box.minZ === 0 && box.maxZ === 0.3));
  layout.dispose();
});

test('при ошибочном букете упаковка скрыта, остаётся исправление у стола', () => {
  const layout = buildFloristLayout();
  const invalid = { ...createInitialState(), stage: 'wrapping', stems: [
    { type: 'pink_tulip' }, { type: 'pink_tulip' }, { type: 'white_daisy' }, { type: 'white_daisy' }, { type: 'red_rose' },
  ] };
  const targets = targetsForState(invalid, layout);
  assert.deepEqual(targets.map(({ kind }) => kind), ['remove']);
  const valid = { ...invalid, stems: [...invalid.stems.slice(0, 4), { type: 'greenery' }] };
  assert.deepEqual(targetsForState(valid, layout).map(({ kind }) => kind).sort(), ['remove', 'wrap']);
  layout.dispose();
});

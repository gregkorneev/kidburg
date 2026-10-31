import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFloristLayout } from './layout.js';

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

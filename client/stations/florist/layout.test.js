import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFloristLayout } from './layout.js';

test('интерьер безопасно освобождает вывески, цветы и геометрию', () => {
  const layout = buildFloristLayout();
  assert.equal(Object.keys(layout.buckets).length, 4);
  assert.doesNotThrow(() => layout.dispose());
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { getPrefab } from './prefabs.js';

test('цветочная лавка: цветной фасад и корректный префаб', () => {
  const prefab = getPrefab(13);
  assert.equal(prefab.name, 'flower_shop');

  const geometry = prefab.build();
  assert.ok(geometry);
  assert.ok(geometry.attributes.position.count > 0);
  assert.ok(geometry.getAttribute('color'));
  geometry.dispose();
});

test('цветочная лавка: геометрия безопасно создаётся и освобождается', () => {
  const prefab = getPrefab(13);
  const geometry = prefab.build();
  geometry.computeBoundingBox();
  assert.ok(geometry.boundingBox);
  geometry.dispose();
});

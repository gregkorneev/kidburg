import test from 'node:test';
import assert from 'node:assert/strict';
import { getPrefab } from './prefabs.js';
import { BUILDINGS } from '../../tools/build-world/layout.js';
import { BUILDING_PREFAB_IDS, PLAZA_PREFAB_ID, PATH_PREFAB_ID } from '../../tools/build-world/index.js';

for (const building of BUILDINGS) {
  test(`префаб ${building.id}: ID, размер и коллизия`, () => {
    const prefab = getPrefab(BUILDING_PREFAB_IDS[building.id]);
    assert.equal(prefab.name, building.id);
    assert.deepEqual(prefab.collider, [building.width, 9, building.depth]);
    const geometry = prefab.build();
    geometry.computeBoundingBox();
    assert.ok(geometry.boundingBox.max.y >= 9);
    geometry.dispose();
  });
}

test('площадь и дорожки не блокируют движение', () => {
  for (const id of [PLAZA_PREFAB_ID, PATH_PREFAB_ID]) {
    const prefab = getPrefab(id);
    assert.equal(prefab.collider, null);
    const geometry = prefab.build();
    geometry.dispose();
  }
});

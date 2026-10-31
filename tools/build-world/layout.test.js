import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS, CITY_CENTER, CITY_LAYOUT_STATUS, PLAZA, PATHS, chunkOf, overlaps } from './layout.js';

test('план содержит мэрию и ровно пять станций', () => {
  assert.equal(BUILDINGS.length, 6);
  assert.equal(new Set(BUILDINGS.map(b => b.id)).size, 6);
  assert.equal(BUILDINGS[0].id, 'city_hall');
  assert.equal(CITY_LAYOUT_STATUS, 'DRAFT_NEEDS_APPROVAL');
});

test('центр площади соответствует существующей точке появления', () => {
  assert.deepEqual({ x: PLAZA.x, z: PLAZA.z }, CITY_CENTER);
  assert.deepEqual(chunkOf(CITY_CENTER.x, CITY_CENTER.z), { cx: 6, cz: 6 });
});

test('здания не пересекаются друг с другом или с площадью', () => {
  for (let i = 0; i < BUILDINGS.length; i++) {
    const a = BUILDINGS[i];
    assert.equal(overlaps(a, PLAZA), false, `${a.name} перекрывает площадь`);
    for (let j = i + 1; j < BUILDINGS.length; j++) {
      const b = BUILDINGS[j];
      assert.equal(overlaps(a, b), false, `${a.name} пересекает ${b.name}`);
    }
  }
});

test('основные дорожки не пересекают здания', () => {
  for (const path of PATHS) for (const building of BUILDINGS) {
    assert.equal(overlaps(path, building), false, `${path.id} пересекает ${building.name}`);
  }
});

test('все здания находятся внутри центральных 3×3 чанков', () => {
  for (const b of BUILDINGS) {
    for (const dx of [-b.width / 2, b.width / 2]) {
      for (const dz of [-b.depth / 2, b.depth / 2]) {
        const { cx, cz } = chunkOf(b.x + dx, b.z + dz);
        assert.ok(cx >= 5 && cx <= 7 && cz >= 5 && cz <= 7, b.name);
      }
    }
  }
});

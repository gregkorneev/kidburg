import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BENCHES, BUILDING_BOXES, BUSHES, FOUNTAIN, INFO_STANDS, LAMPS, PLANTER_BEDS, PLANTS, PYLONS, ROCKS, ROUND_BEDS, ROUTES, ROUTE_HALF_WIDTH,
  SECTORS, SPOUTS, TREES, distanceToBuildings, distanceToRoutes, isClear, occupiedCircles, onLawn, lawnOutline,
} from './plaza-plan.js';

test('план площади: шесть маршрутов и шесть секторов покрывают круг', () => {
  assert.equal(ROUTES.length, 6);
  assert.equal(SECTORS.length, 6);
  const total = SECTORS.reduce((sum, s) => sum + s.span, 0);
  assert.ok(Math.abs(total - Math.PI * 2) < 1e-9);
  assert.ok(SECTORS.every((s) => s.span > 0.5));
  assert.equal(new Set(ROUTES.map((r) => r.id)).size, 6);
});

test('план площади: мебель и клумбы не перекрывают коридоры к дверям', () => {
  for (const [x, z, radius, name] of occupiedCircles()) {
    const d = distanceToRoutes(x, z);
    assert.ok(d >= ROUTE_HALF_WIDTH + radius - 0.01, `${name} (${x.toFixed(1)}, ${z.toFixed(1)}) в коридоре: ${d.toFixed(2)}`);
  }
});

test('план площади: предметы не пересекаются друг с другом', () => {
  const c = occupiedCircles();
  for (let i = 0; i < c.length; i++) {
    for (let j = i + 1; j < c.length; j++) {
      assert.ok(Math.hypot(c[i][0] - c[j][0], c[i][1] - c[j][1]) >= c[i][2] + c[j][2] - 0.01, `${c[i][3]} пересекает ${c[j][3]}`);
    }
  }
});

test('план площади: клумбы и валуны лежат на газоне, скамьи — на мощении', () => {
  for (const b of ROUND_BEDS) assert.ok(onLawn(b.x, b.z, b.radius), 'круглая клумба вне газона');
  for (const b of PLANTER_BEDS) assert.ok(onLawn(b.x, b.z, 1.0), 'ящик-клумба вне газона');
  for (const r of ROCKS) assert.ok(onLawn(r.x, r.z, 0.4), 'валун вне газона');
  for (const b of BENCHES) assert.ok(!onLawn(b.x, b.z, -0.2), 'скамья стоит на газоне');
});

test('план площади: деревья и кусты вне зданий и коридоров', () => {
  assert.ok(TREES.length >= 10);
  for (const t of TREES) assert.ok(isClear(t.x, t.z, 2.6), `дерево ${t.x.toFixed(1)},${t.z.toFixed(1)}`);
  for (const b of BUSHES) assert.ok(isClear(b.x, b.z, 0.9 * b.s - 0.01), 'куст мешает');
  assert.ok(BUILDING_BOXES.length === 6 && distanceToBuildings(0, 0) > 15);
});

test('план площади: растения лежат внутри клумб и воспроизводимы', () => {
  assert.ok(PLANTS.length > 150);
  for (const p of PLANTS) assert.ok(p.kind === 'flower' || p.kind === 'bush');
  const bedPlants = PLANTS.filter((p) => p.y > 0.3);
  for (const p of bedPlants) {
    const near = ROUND_BEDS.some((b) => Math.hypot(b.x - p.x, b.z - p.z) <= b.radius) || PLANTER_BEDS.some((b) => Math.hypot(b.x - p.x, b.z - p.z) <= b.length / 2 + 0.2);
    assert.ok(near, 'растение вне клумбы');
  }
});

test('план площади: фонтан — пилоны, форсунки и газоны в правильных радиусах', () => {
  assert.equal(PYLONS.length, 6);
  assert.equal(SPOUTS.length, 12);
  for (const p of PYLONS) assert.ok(Math.abs(Math.hypot(p.x, p.z) - FOUNTAIN.pylonRadius) < 1e-6);
  for (const s of SPOUTS) assert.ok(Math.hypot(s.x, s.z) < FOUNTAIN.channel[0]);
  for (const l of LAMPS) assert.ok(Math.hypot(l.x, l.z) < 21.0, 'фонарь выходит за площадь');
  assert.equal(INFO_STANDS.length, 1);
  for (const s of SECTORS) assert.ok(lawnOutline(s).length > 10);
});

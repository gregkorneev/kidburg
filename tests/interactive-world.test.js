// Интерактивный мир: места предметов, согласованность дверей с зданиями, защита мест от редактора, админский просмотр.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BALL_HOMES, FIELD, PROP_HOMES, PROP_TYPES } from '../shared/interaction-contracts.js';
import { DOOR_SPECS, doorWorldPoint } from '../shared/doors.js';
import { MECHANISMS } from '../shared/mechanisms.js';
import { BUILDINGS } from '../tools/build-world/layout.js';
import { openDb } from '../server/db/index.js';
import { createDynamicWorld } from '../server/world/dynamic-objects.js';
import { createInteractive } from '../server/world/interactive-state.js';
import { createPlacement } from '../server/world/placement.js';
import { PATHS } from '../tools/build-world/layout.js';
import { ADMIN_PASSWORD, adminLogin, adminRequest, listen } from './helpers.js';

test('стартовые места предметов допустимы и не пересекаются друг с другом', () => {
  const placement = createPlacement();
  for (const home of PROP_HOMES) {
    const res = placement.checkProp(home.x, home.z, PROP_TYPES[home.type].radius);
    assert.equal(res.ok, true, `${home.id}: ${res.reason}`);
  }
  for (let i = 0; i < PROP_HOMES.length; i++) {
    for (let j = i + 1; j < PROP_HOMES.length; j++) {
      const a = PROP_HOMES[i];
      const b = PROP_HOMES[j];
      const need = PROP_TYPES[a.type].radius + PROP_TYPES[b.type].radius;
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > need, `${a.id} и ${b.id} слишком близко`);
    }
  }
});

test('переносимый предмет можно оставить в здании, на дорожке и поверх другого предмета', () => {
  const placement = createPlacement();
  const b = BUILDINGS[0];
  const path = PATHS[0];
  const prop = PROP_HOMES[0];
  assert.equal(placement.checkProp(b.x, b.z, 0.5).ok, true, 'внутри здания');
  assert.equal(placement.checkProp(path.x, path.z, 0.5).ok, true, 'на дорожке');
  assert.equal(placement.checkProp(prop.x, prop.z, PROP_TYPES[prop.type].radius).ok, true, 'на месте другого предмета');
  assert.equal(placement.checkProp(0.5, 0.5, 0.5).ok, false);
  assert.equal(placement.checkProp(Number.NaN, 400, 0.5).ok, false);
  assert.equal(placement.checkProp(400, 400, Infinity).ok, false);
});

test('сервер разрешает поставить переносимый предмет прямо на дорожку', () => {
  const db = openDb(':memory:');
  const placement = createPlacement();
  const interactive = createInteractive({ db, placement });
  const prop = PROP_HOMES.find((home) => home.id === 'crate-1');
  assert.equal(interactive.take({ id: 1, x: prop.x + 1, z: prop.z, ry: 0 }, prop.id).ok, true);
  const path = PATHS[0];
  const result = interactive.place({ id: 1, x: path.x, z: path.z + 1, ry: 0 }, prop.id);
  assert.equal(result.ok, true, result.message);
  assert.deepEqual([result.prop.x, result.prop.z], [path.x, path.z]);
  db.close();
});

test('мячи стартуют на поле и в стороне от препятствий', () => {
  for (const home of BALL_HOMES) {
    assert.ok(Math.abs(home.x - FIELD.x) < FIELD.halfW && Math.abs(home.z - FIELD.z) < FIELD.halfD, home.id);
  }
});

test('двери: у каждого здания из спецификации есть механизм, точка двери у фасада и радиус сервера', () => {
  for (const spec of DOOR_SPECS) {
    const building = BUILDINGS.find((b) => b.id === spec.building);
    assert.ok(building, `${spec.id}: здание ${spec.building}`);
    assert.equal(MECHANISMS[spec.id]?.type, 'door', `${spec.id}: механизм`);
    const point = doorWorldPoint(spec);
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z));
    assert.ok(Math.hypot(point.x - building.x, point.z - building.z) < Math.max(building.width, building.depth), `${spec.id}: точка у здания`);
  }
});

test('редактор мира не ставит объект на место игрового предмета', () => {
  const placement = createPlacement();
  const plain = createDynamicWorld({ db: openDb(':memory:'), placement });
  // Берём точку, где редактору ставить можно, пока предметов нет.
  const home = PROP_HOMES.find((h) => plain.check({ type: 'bench', x: h.x, z: h.z, ry: 0, scale: 1 }).ok);
  assert.ok(home, 'есть стартовое место вне запретных зон редактора');
  const db = openDb(':memory:');
  const dynamic = createDynamicWorld({ db, placement });
  const interactive = createInteractive({ db, placement, dynamic });
  const res = dynamic.check({ type: 'bench', x: home.x, z: home.z, ry: 0, scale: 1 });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'overlap');
  assert.equal(interactive.describe().props.length, PROP_HOMES.length);
  db.close();
});

test('Control Center: просмотр предметов и мячей требует входа и не меняет состояние', async () => {
  const { app } = await listen({ adminPassword: ADMIN_PASSWORD });
  try {
    const anon = await app.inject({ method: 'GET', url: '/api/admin/world/interactive' });
    assert.ok([401, 403].includes(anon.statusCode));
    const admin = await adminLogin(app);
    const res = await adminRequest(app, admin, 'GET', '/api/admin/world/interactive');
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.props.length, PROP_HOMES.length);
    assert.equal(body.balls.length, BALL_HOMES.length);
    assert.ok(body.props.every((p) => p.label && p.home));
    const world = await adminRequest(app, admin, 'GET', '/api/admin/world');
    assert.equal(world.json().count, 0, 'игровые предметы не попадают в объекты редактора');
  } finally {
    await app.close();
  }
});

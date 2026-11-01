// Динамический слой мира: правила размещения, лимиты, сохранение, откат и учёт кеша.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CACHE_FRACTION } from '../shared/constants.js';
import { WORLD_OBJECT_LIMITS, normalizeObjectParams } from '../shared/world-objects.js';
import { openDb } from '../server/db/index.js';
import { loadWorld } from '../server/net/world.js';
import { createDynamicWorld } from '../server/world/dynamic-objects.js';
import { createPlacement } from '../server/world/placement.js';
import { adminLogin, adminRequest, makeAdminApp, tempDb, tempWorld } from './helpers.js';

const FREE = { type: 'bench', x: 441, z: 432, ry: 0.5, scale: 1 };

function makeWorld(db = openDb(':memory:'), worldDir) {
  const world = worldDir ? loadWorld(worldDir) : null;
  const placement = createPlacement({ world });
  return { db, world, dyn: createDynamicWorld({ db, placement, world }) };
}

test('параметры: неизвестные поля и значения вне допустимых отклоняются, текст очищается', () => {
  assert.equal(normalizeObjectParams('tree', { variant: 'pine' }).ok, true);
  assert.equal(normalizeObjectParams('tree', { variant: 'baobab' }).ok, false);
  assert.equal(normalizeObjectParams('tree', { path: '../../etc/passwd' }).ok, false);
  assert.equal(normalizeObjectParams('bench', { anything: 1 }).ok, false);
  assert.equal(normalizeObjectParams('bush', { tone: 9 }).ok, false);
  assert.equal(normalizeObjectParams('virus', {}).ok, false);
  const sign = normalizeObjectParams('sign', { text: '  <b>Привет</b>\n"мир"  ' });
  assert.equal(sign.ok, true);
  assert.ok(!/[<>"\n]/.test(sign.params.text));
  assert.ok(normalizeObjectParams('sign', { text: 'я'.repeat(100) }).params.text.length <= WORLD_OBJECT_LIMITS.SIGN_TEXT_MAX);
});

test('размещение: свободное место принимается, значения нормализуются', () => {
  const { dyn } = makeWorld();
  const res = dyn.create({ ...FREE, ry: 7 });
  assert.equal(res.ok, true);
  assert.match(res.object.id, WORLD_OBJECT_LIMITS.ID_PATTERN);
  assert.ok(res.object.ry >= 0 && res.object.ry < Math.PI * 2);
  assert.equal(res.object.rev, 1);
  assert.equal(dyn.count, 1);
});

test('размещение: здания, двери, маршруты, площадь, спавн, края и пересечения отклоняются на сервере', () => {
  const { dyn } = makeWorld();
  const reject = (input, code) => {
    const res = dyn.create({ type: 'bench', ...input });
    assert.equal(res.ok, false, JSON.stringify(input));
    assert.equal(res.code, code, `${JSON.stringify(input)} -> ${res.code}`);
  };
  reject({ x: 382, z: 412 }, 'forbidden_zone'); // внутри пожарной части
  reject({ x: 388.9, z: 404.3 }, 'forbidden_zone'); // боковая дверь пожарной части
  reject({ x: 387.4, z: 445.5 }, 'forbidden_zone'); // дверь цветочной лавки
  reject({ x: 416, z: 416 }, 'forbidden_zone'); // точка появления и фонтан
  reject({ x: 428, z: 424 }, 'forbidden_zone'); // площадь
  reject({ x: 441, z: 436 }, 'forbidden_zone'); // маршрут к радиостанции
  reject({ x: 2, z: 100 }, 'out_of_bounds');
  reject({ x: 100, z: 766 }, 'out_of_bounds');
  reject({ x: Number.NaN, z: 5 }, 'bad_position');
  reject({ x: 100, z: 100, scale: 9 }, 'bad_scale');
  reject({ x: 100, z: 100, ry: 'a' }, 'bad_rotation');
  reject({ x: 100, z: 100, params: { evil: true } }, 'bad_params');
  assert.equal(dyn.create({ type: 'exploit', x: 100, z: 100 }).code, 'bad_type');
  assert.equal(dyn.create({ type: '__proto__', x: 100, z: 100 }).code, 'bad_type');
  assert.equal(dyn.create({ type: 'constructor', x: 100, z: 100 }).code, 'bad_type');

  assert.equal(dyn.create({ type: 'bench', x: 100, z: 100 }).ok, true);
  reject({ x: 100.5, z: 100 }, 'overlap');
  assert.equal(dyn.count, 1);
});

test('размещение учитывает статические объекты и NPC из реального мира', () => {
  const { worldDir, cleanup } = tempWorld();
  try {
    const { world, dyn } = makeWorld(openDb(':memory:'), worldDir);
    const npc = world.npcs[0];
    assert.equal(dyn.create({ type: 'rock', x: npc.x + 1, z: npc.z }).ok, false, 'рядом с NPC нельзя');
  } finally {
    cleanup();
  }
});

test('лимиты: всего объектов и объектов в чанке', () => {
  const { dyn } = makeWorld();
  // 30 объектов в одном чанке (64×64) проходят, 31-й — нет.
  let placed = 0;
  for (let ix = 0; ix < 8 && placed < WORLD_OBJECT_LIMITS.MAX_PER_CHUNK; ix++) {
    for (let iz = 0; iz < 8 && placed < WORLD_OBJECT_LIMITS.MAX_PER_CHUNK; iz++) {
      const res = dyn.create({ type: 'lamp', x: 70 + ix * 6, z: 70 + iz * 6 });
      assert.equal(res.ok, true, res.message);
      placed += 1;
    }
  }
  const extra = dyn.create({ type: 'lamp', x: 70 + 7 * 6 + 3, z: 70 + 7 * 6 + 3 });
  assert.equal(extra.ok, false);
  assert.equal(extra.code, 'limit_chunk');

  const total = makeWorld().dyn;
  let n = 0;
  outer: for (let cz = 0; cz < 12; cz++) {
    for (let cx = 0; cx < 12; cx++) {
      if (cx >= 4 && cx <= 8 && cz >= 4 && cz <= 8) continue; // центр города занят зданиями
      for (let k = 0; k < 20; k++) {
        const res = total.create({ type: 'lamp', x: cx * 64 + 8 + (k % 5) * 10, z: cz * 64 + 8 + Math.floor(k / 5) * 10 });
        if (!res.ok) {
          assert.equal(res.code, 'limit_total');
          break outer;
        }
        n += 1;
      }
    }
  }
  assert.equal(n, WORLD_OBJECT_LIMITS.MAX_TOTAL);
});

test('перемещение, поворот и параметры меняются; чужая версия даёт conflict; тип менять нельзя', () => {
  const { dyn } = makeWorld();
  const { object } = dyn.create({ type: 'tree', x: 100, z: 100, params: { variant: 'pine' } });
  const moved = dyn.update(object.id, { x: 120, z: 110, ry: 1, scale: 1.2, params: { variant: 'birch' } }, { expectedRev: object.rev });
  assert.equal(moved.ok, true);
  assert.deepEqual([moved.object.x, moved.object.z, moved.object.scale, moved.object.params.variant], [120, 110, 1.2, 'birch']);
  assert.equal(moved.object.rev, object.rev + 1);
  assert.equal(dyn.update(object.id, { x: 130 }, { expectedRev: object.rev }).code, 'conflict');
  assert.equal(dyn.update(object.id, { type: 'lamp' }).code, 'bad_type');
  assert.equal(dyn.update(object.id, { x: 382, z: 412 }).code, 'forbidden_zone');
  assert.equal(dyn.update('o_0000000000', { x: 1 }).code, 'not_found');
});

test('объекты переживают перезапуск: SQLite хранит их и ревизию мира', () => {
  const { dbPath, cleanup } = tempDb();
  try {
    const first = makeWorld(openDb(dbPath));
    const a = first.dyn.create({ type: 'bench', x: 100, z: 100 }).object;
    const b = first.dyn.create({ type: 'sign', x: 140, z: 100, params: { text: 'Привет' } }).object;
    first.dyn.update(a.id, { x: 110 });
    first.dyn.remove(b.id);
    const revision = first.dyn.revision;
    first.db.close();

    const second = makeWorld(openDb(dbPath));
    assert.equal(second.dyn.count, 1);
    assert.equal(second.dyn.get(a.id).x, 110);
    assert.equal(second.dyn.get(b.id), null, 'удалённый объект не воскресает');
    assert.equal(second.dyn.revision, revision);
    assert.ok(second.dyn.create({ type: 'bench', x: 200, z: 200 }).object.rev > revision, 'ревизия растёт и после перезапуска');
    second.db.close();
  } finally {
    cleanup();
  }
});

test('кеш: чанк и лимит 10% учитывают динамические объекты, обязательная область остаётся в бюджете', () => {
  const { worldDir, cleanup } = tempWorld();
  try {
    const { world, dyn } = makeWorld(openDb(':memory:'), worldDir);
    const view = dyn.wrapWorld(world);
    const key = 6 + 6 * 12;
    const before = view.chunks[key].bytes;
    const total = view.totalBytes;
    assert.equal(before, world.chunks[key].bytes);
    dyn.create({ type: 'bench', x: 441, z: 432 });
    assert.ok(view.chunks[key].bytes > before, 'вес чанка вырос');
    assert.ok(view.totalBytes > total);
    assert.equal(view.bytesMax, Math.floor(CACHE_FRACTION * view.totalBytes));

    // Набиваем область вокруг центра до отказа: любой отказ — один из лимитов, а бюджет 3×3 не нарушается.
    let rejected = null;
    for (let i = 0; i < 400 && !rejected; i++) {
      const res = dyn.create({ type: 'lamp', x: 330 + (i % 18) * 10, z: 330 + Math.floor(i / 18) * 10 });
      if (!res.ok && res.code !== 'forbidden_zone' && res.code !== 'overlap') rejected = res;
    }
    assert.ok(rejected, 'должен сработать один из лимитов');
    assert.ok(['limit_total', 'limit_chunk', 'cache_budget'].includes(rejected.code), rejected.code);
    for (let cz = 0; cz < 12; cz++) {
      for (let cx = 0; cx < 12; cx++) {
        let sum = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const x = cx + dx;
            const z = cz + dz;
            if (x >= 0 && z >= 0 && x < 12 && z < 12) sum += view.chunks[x + z * 12].bytes;
          }
        }
        assert.ok(sum <= view.bytesMax, `область вокруг ${cx},${cz}: ${sum} > ${view.bytesMax}`);
      }
    }
  } finally {
    cleanup();
  }
});

test('API: создание, перемещение, удаление, журнал и отмена с синхронизацией состояния', async () => {
  const app = await makeAdminApp();
  const admin = await adminLogin(app);
  const post = (url, payload) => adminRequest(app, admin, 'POST', url, payload);

  const created = await post('/api/admin/world/objects', FREE);
  assert.equal(created.statusCode, 201);
  const { object } = created.json();

  const moved = await adminRequest(app, admin, 'PATCH', `/api/admin/world/objects/${object.id}`, { x: 450, z: 430, rev: object.rev });
  assert.equal(moved.statusCode, 200);
  assert.equal(moved.json().object.x, 450);

  const stale = await adminRequest(app, admin, 'PATCH', `/api/admin/world/objects/${object.id}`, { x: 460, z: 430, rev: object.rev });
  assert.equal(stale.statusCode, 409);

  const forbidden = await post('/api/admin/world/objects', { type: 'bench', x: 416, z: 416 });
  assert.equal(forbidden.statusCode, 422);
  assert.equal(forbidden.json().error, 'forbidden_zone');

  const check = await post('/api/admin/world/validate', { type: 'bench', x: 416, z: 416 });
  assert.deepEqual([check.json().ok, check.json().code], [false, 'forbidden_zone']);

  // Отмена: сначала перемещение, затем создание.
  const undo1 = await post('/api/admin/world/undo');
  assert.equal(undo1.statusCode, 200);
  assert.equal(undo1.json().undone.action, 'world.update');
  assert.equal(app.dynamicWorld.get(object.id).x, 441);
  const undo2 = await post('/api/admin/world/undo');
  assert.equal(undo2.json().undone.action, 'world.create');
  assert.equal(app.dynamicWorld.count, 0);
  assert.equal((await post('/api/admin/world/undo')).statusCode, 404);

  const audit = (await adminRequest(app, admin, 'GET', '/api/admin/audit')).json().entries;
  const actions = audit.map((e) => e.action);
  assert.ok(actions.includes('world.create') && actions.includes('world.undo') && actions.includes('admin.login'));
  const rejected = audit.find((e) => e.action === 'world.create' && e.result === 'rejected');
  assert.ok(rejected, 'отказ размещения попадает в журнал');
  assert.equal(audit.find((e) => e.action === 'world.create' && e.result === 'ok').undone, true);
  await app.close();
});

test('API: удаление и очистка откатываются, конфликт версий не даёт откатить поверх чужой правки', async () => {
  const app = await makeAdminApp();
  const admin = await adminLogin(app);
  const post = (url, payload) => adminRequest(app, admin, 'POST', url, payload);
  const a = (await post('/api/admin/world/objects', { type: 'tree', x: 100, z: 100 })).json().object;
  const b = (await post('/api/admin/world/objects', { type: 'rock', x: 140, z: 100 })).json().object;

  assert.equal((await adminRequest(app, admin, 'DELETE', `/api/admin/world/objects/${a.id}`)).statusCode, 200);
  assert.equal((await post('/api/admin/world/undo')).statusCode, 200);
  assert.equal(app.dynamicWorld.get(a.id).type, 'tree', 'удалённый объект вернулся с тем же id');

  assert.equal((await post('/api/admin/world/clear', {})).statusCode, 400, 'очистка требует confirm');
  assert.equal((await post('/api/admin/world/clear', { confirm: true })).json().removed, 2);
  assert.equal(app.dynamicWorld.count, 0);
  assert.equal((await post('/api/admin/world/undo')).statusCode, 200);
  assert.equal(app.dynamicWorld.count, 2);

  app.dynamicWorld.update(b.id, { x: 150 }); // правка мимо журнала
  const log = (await adminRequest(app, admin, 'GET', '/api/admin/audit')).json().entries;
  assert.ok(log.length > 0);
  await adminRequest(app, admin, 'PATCH', `/api/admin/world/objects/${b.id}`, { x: 160 });
  app.dynamicWorld.update(b.id, { x: 170 });
  const conflict = await post('/api/admin/world/undo');
  assert.equal(conflict.statusCode, 409);
  assert.equal(app.dynamicWorld.get(b.id).x, 170, 'конфликт не меняет мир');
  await app.close();
});

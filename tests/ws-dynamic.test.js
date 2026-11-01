// Синхронизация динамических объектов по игровому WebSocket: снимок при входе, правки, перемещение между чанками,
// удаление, откат, дальний игрок и учёт кеша.
import test from 'node:test';
import assert from 'node:assert/strict';
import { adminLogin, adminRequest, joinGame, listen, seedPlayerState, tempDb, tempWorld } from './helpers.js';
import { ADMIN_PASSWORD } from './helpers.js';

const isDyn = (m) => m.t === 'dyn_snapshot' || m.t === 'dyn_upsert' || m.t === 'dyn_remove';
const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));

async function setup(extra = {}) {
  const { worldDir, cleanup } = tempWorld();
  const { app, port } = await listen({ worldDir, adminPassword: ADMIN_PASSWORD, ...extra });
  const admin = await adminLogin(app);
  const api = (method, url, payload) => adminRequest(app, admin, method, url, payload);
  return { app, port, api, cleanup };
}

test('dyn: создание, перемещение и удаление доходят до всех игроков рядом; поздний игрок получает снимок', async () => {
  const { app, port, api, cleanup } = await setup();
  try {
    const a = await joinGame(app, port, 'Аня');
    const b = await joinGame(app, port, 'Борис');
    await settle();

    const created = await api('POST', '/api/admin/world/objects', { type: 'bench', x: 441, z: 432, ry: 1, params: {} });
    assert.equal(created.statusCode, 201);
    const obj = created.json().object;
    for (const c of [a.client, b.client]) {
      const msg = await c.nextOfType('dyn_upsert');
      assert.deepEqual([msg.object.id, msg.object.type, msg.object.x, msg.object.z, msg.object.rev], [obj.id, 'bench', 441, 432, obj.rev]);
    }

    const moved = await api('PATCH', `/api/admin/world/objects/${obj.id}`, { x: 450, z: 430 });
    assert.equal(moved.statusCode, 200);
    for (const c of [a.client, b.client]) {
      const msg = await c.nextOfType('dyn_upsert');
      assert.deepEqual([msg.object.x, msg.object.z], [450, 430]);
      assert.ok(msg.object.rev > obj.rev);
    }

    // Игрок, зашедший позже, видит актуальную версию сразу после чанков.
    const late = await joinGame(app, port, 'Вера');
    const snap = await late.client.nextOfType('dyn_snapshot');
    assert.equal(snap.objects.length, 1);
    assert.deepEqual([snap.objects[0].id, snap.objects[0].x], [obj.id, 450]);

    await api('DELETE', `/api/admin/world/objects/${obj.id}`);
    for (const c of [a.client, b.client, late.client]) {
      const msg = await c.nextOfType('dyn_remove');
      assert.equal(msg.id, obj.id);
    }
    await Promise.all([a.client.close(), b.client.close(), late.client.close()]);
  } finally {
    await app.close();
    cleanup();
  }
});

test('dyn: игрок вдали от изменения его не получает', async () => {
  const db = tempDb();
  const { worldDir, cleanup } = tempWorld();
  const { app, port } = await listen({ worldDir, dbPath: db.dbPath, adminPassword: ADMIN_PASSWORD });
  try {
    // Игрок «Далёкий» стоит в углу мира.
    const first = await joinGame(app, port, 'Далёкий');
    await first.client.close();
    seedPlayerState(db.dbPath, 'Далёкий', { x: 40, y: 0, z: 40, ry: 0 });
    // база открыта приложением — читаем через то же приложение: достаточно проверить на втором подключении ниже
  } finally {
    await app.close();
  }
  const { app: app2, port: port2 } = await listen({ worldDir, dbPath: db.dbPath, adminPassword: ADMIN_PASSWORD });
  try {
    const admin = await adminLogin(app2);
    const api = (method, url, payload) => adminRequest(app2, admin, method, url, payload);
    const far = await joinGame(app2, port2, 'Далёкий');
    const near = await joinGame(app2, port2, 'Ближний');
    await settle();
    await api('POST', '/api/admin/world/objects', { type: 'tree', x: 441, z: 432 });
    await near.client.nextOfType('dyn_upsert');
    await settle(150);
    assert.equal(far.client.inbox.filter(isDyn).length, 0, 'далёкий клиент не получает чужие чанки');
    await Promise.all([far.client.close(), near.client.close()]);
  } finally {
    await app2.close();
    cleanup();
    db.cleanup();
  }
});

test('dyn: объект, перенесённый в другой чанк, убирается у тех, кто видел только старый', async () => {
  const { app, port, api, cleanup } = await setup();
  try {
    const a = await joinGame(app, port, 'Аня');
    await settle();
    // Чанк (7,6): x 448..512. Перенос внутрь области игрока и обратно в видимую часть остаётся upsert.
    const obj = (await api('POST', '/api/admin/world/objects', { type: 'rock', x: 470, z: 440 })).json().object;
    await a.client.nextOfType('dyn_upsert');
    await api('PATCH', `/api/admin/world/objects/${obj.id}`, { x: 100, z: 100 });
    const gone = await a.client.nextOfType('dyn_remove');
    assert.equal(gone.id, obj.id, 'клиент видел старый чанк, но не новый — объект удаляется');
    await a.client.close();
  } finally {
    await app.close();
    cleanup();
  }
});

test('dyn: отмена тоже синхронизируется, а cache_stats остаётся в пределах лимита', async () => {
  const { app, port, api, cleanup } = await setup();
  try {
    const a = await joinGame(app, port, 'Аня');
    await settle();
    await api('POST', '/api/admin/world/objects', { type: 'lamp', x: 441, z: 432 });
    const up = await a.client.nextOfType('dyn_upsert');
    const stats = await a.client.nextOfType('cache_stats');
    assert.ok(stats.bytes <= stats.bytesMax, 'после правки вес кеша не превышает 10%');
    assert.ok(stats.bytes > 0);
    await api('POST', '/api/admin/world/undo');
    const rm = await a.client.nextOfType('dyn_remove');
    assert.equal(rm.id, up.object.id);
    await a.client.close();
  } finally {
    await app.close();
    cleanup();
  }
});

test('dyn: объекты видны после перезапуска сервера', async () => {
  const db = tempDb();
  const { worldDir, cleanup } = tempWorld();
  let id;
  const first = await listen({ worldDir, dbPath: db.dbPath, adminPassword: ADMIN_PASSWORD });
  try {
    const admin = await adminLogin(first.app);
    id = (await adminRequest(first.app, admin, 'POST', '/api/admin/world/objects', { type: 'bench', x: 441, z: 432 })).json().object.id;
  } finally {
    await first.app.close();
  }
  const second = await listen({ worldDir, dbPath: db.dbPath, adminPassword: ADMIN_PASSWORD });
  try {
    const p = await joinGame(second.app, second.port, 'Аня');
    const snap = await p.client.nextOfType('dyn_snapshot');
    assert.equal(snap.objects[0].id, id);
    await p.client.close();
  } finally {
    await second.app.close();
    cleanup();
    db.cleanup();
  }
});

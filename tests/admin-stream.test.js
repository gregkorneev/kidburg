// Поток SSE панели: снимок при подключении, обновления, переподключение, закрытие при остановке сервера.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_PASSWORD, adminLogin, adminRequest, join, listen } from './helpers.js';

/** Подключается к потоку и собирает события; next(name) ждёт событие с таким именем. */
async function openStream(port, cookie) {
  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/api/admin/stream`, { headers: { cookie }, signal: controller.signal });
  const events = [];
  const waiters = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const flush = () => {
    for (const w of [...waiters]) {
      const i = events.findIndex((e) => e.event === w.name);
      if (i === -1) continue;
      waiters.splice(waiters.indexOf(w), 1);
      clearTimeout(w.timer);
      w.resolve(events.splice(i, 1)[0].data);
    }
  };
  const done = (async () => {
    try {
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) return;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const event = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (event && data) events.push({ event, data: JSON.parse(data) });
        }
        flush();
      }
    } catch {
      // оборван клиентом или сервером
    }
  })();
  return {
    res,
    next: (name, ms = 3000) =>
      new Promise((resolve, reject) => {
        const w = { name, resolve, timer: setTimeout(() => reject(new Error(`событие ${name} не пришло`)), ms) };
        waiters.push(w);
        flush();
      }),
    close: () => controller.abort(),
    done,
  };
}

test('stream: сразу снимок с историей, затем tick; без сессии поток закрыт', async () => {
  const { app, port } = await listen({ adminPassword: ADMIN_PASSWORD });
  try {
    const denied = await fetch(`http://127.0.0.1:${port}/api/admin/stream`);
    assert.equal(denied.status, 401);

    const { token } = await join(app, 'Аня');
    await app.inject({ method: 'POST', url: '/api/telemetry', headers: { authorization: `Bearer ${token}` }, payload: { sid: 'sid-stream-1', loc: 'city', fps: 59, ping: 3 } });

    const admin = await adminLogin(app);
    const stream = await openStream(port, admin.cookie);
    assert.equal(stream.res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    const snapshot = await stream.next('snapshot');
    assert.equal(snapshot.clients.length, 1);
    assert.equal(snapshot.clients[0].history.length, 1);
    assert.equal(snapshot.summary.playersOnline, 1);
    assert.equal(snapshot.intervalMs, 3000);
    const tick = await stream.next('tick', 3000);
    assert.equal(tick.clients[0].name, 'Аня');
    assert.equal(tick.clients[0].history, undefined, 'в tick истории нет');
    stream.close();
    await stream.done;
  } finally {
    await app.close();
  }
});

test('stream: события мира, агентов и журнала; повторное подключение даёт свежий снимок без дублей', async () => {
  const { app, port } = await listen({ adminPassword: ADMIN_PASSWORD });
  try {
    const admin = await adminLogin(app);
    const s1 = await openStream(port, admin.cookie);
    await s1.next('snapshot');

    const created = await adminRequest(app, admin, 'POST', '/api/admin/world/objects', { type: 'bench', x: 441, z: 432 });
    const world = await s1.next('world');
    assert.equal(world.count, 1);
    assert.equal(world.ops[0].op, 'upsert');
    assert.equal(world.ops[0].object.id, created.json().object.id);
    const audit = await s1.next('audit');
    assert.equal(audit.action, 'world.create');

    await adminRequest(app, admin, 'PUT', '/api/admin/agents/nurse', { settings: { friendliness: 4 } });
    assert.equal((await s1.next('agents')).id, 'nurse');

    s1.close();
    await s1.done;
    const s2 = await openStream(port, admin.cookie);
    const snap = await s2.next('snapshot');
    assert.equal(snap.world.count, 1, 'после переподключения состояние актуально');
    await adminRequest(app, admin, 'DELETE', `/api/admin/world/objects/${created.json().object.id}`);
    const removed = await s2.next('world');
    assert.equal(removed.ops.length, 1, 'одно событие на одно изменение: подписка не дублируется');
    s2.close();
    await s2.done;
  } finally {
    await app.close();
  }
});

test('stream: остановка сервера закрывает открытые потоки, а число подписок ограничено', async () => {
  const { app, port } = await listen({ adminPassword: ADMIN_PASSWORD });
  const admin = await adminLogin(app);
  const streams = [];
  for (let i = 0; i < 8; i++) {
    const s = await openStream(port, admin.cookie);
    await s.next('snapshot');
    streams.push(s);
  }
  const extra = await fetch(`http://127.0.0.1:${port}/api/admin/stream`, { headers: { cookie: admin.cookie } });
  assert.equal(extra.status, 429);
  const started = Date.now();
  await app.close();
  await Promise.all(streams.map((s) => s.done));
  assert.ok(Date.now() - started < 3000, 'сервер остановился, потоки закрыты');
});

/** Поток закрыт сервером: чтение завершилось за отведённое время. */
const closesWithin = (stream, ms) => Promise.race([stream.done.then(() => true), new Promise((r) => setTimeout(() => r(false), ms))]);

test('stream: выход из админки закрывает потоки этой сессии и освобождает место в лимите подписок', async () => {
  const { app, port } = await listen({ adminPassword: ADMIN_PASSWORD });
  try {
    const admin = await adminLogin(app);
    const stream = await openStream(port, admin.cookie);
    await stream.next('snapshot');

    const out = await adminRequest(app, admin, 'POST', '/api/admin/logout', {});
    assert.equal(out.statusCode, 200);
    assert.equal(await closesWithin(stream, 800), true, 'открытый поток закрыт сразу после выхода');

    // Подписчик удалён: все восемь мест лимита снова свободны.
    const next = await adminLogin(app);
    const streams = [];
    for (let i = 0; i < 8; i++) {
      const s = await openStream(port, next.cookie);
      assert.equal(s.res.status, 200, `поток ${i + 1} открылся`);
      await s.next('snapshot');
      streams.push(s);
    }
    streams.forEach((s) => s.close());
    await Promise.all(streams.map((s) => s.done));
  } finally {
    await app.close();
  }
});

test('stream: истёкшая сессия не получает данные по уже открытому потоку', async () => {
  let clock = Date.now();
  const { app, port } = await listen({ adminPassword: ADMIN_PASSWORD, now: () => clock });
  try {
    const admin = await adminLogin(app);
    const stream = await openStream(port, admin.cookie);
    await stream.next('snapshot');
    await stream.next('tick', 3000); // пока сессия жива, данные идут

    clock += 8 * 60 * 60 * 1000 + 60_000; // срок сессии вышел
    assert.equal(await closesWithin(stream, 3000), true, 'поток закрыт ближайшим tick без отдельного таймера');
    const reopened = await fetch(`http://127.0.0.1:${port}/api/admin/stream`, { headers: { cookie: admin.cookie } });
    assert.equal(reopened.status, 401, 'переподключиться с истёкшей сессией нельзя');
  } finally {
    await app.close();
  }
});

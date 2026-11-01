import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { buildApp } from '../../server/index.js';
import { ApiError, createHttp } from './http.js';
import { createEmitter } from './emitter.js';
import { createNet } from './net.js';
import { createSession } from './session.js';

function fakeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
}

const ROOM = 'BCDF';
const appearance = { avatar: { skin: 3, clothes: 1, hair: 2, shoes: 0 } };

async function startServer() {
  const app = await buildApp({ roomCode: ROOM, dbPath: ':memory:', logLevel: 'silent', worldDir: '/нет/такой/папки' });
  await app.listen({ host: '127.0.0.1', port: 0 });
  return { app, port: app.server.address().port };
}

/** Клиентский транспорт поверх реального сервера; запоминает созданные сокеты. */
function makeClient(port, storage = fakeStorage()) {
  const emitter = createEmitter();
  const http = createHttp({ baseUrl: `http://127.0.0.1:${port}` });
  const session = createSession(storage);
  const sockets = [];
  class TrackedSocket extends WebSocket {
    constructor(url) {
      super(url);
      sockets.push(this);
    }
  }
  const net = createNet({
    http,
    session,
    emitter,
    WebSocketImpl: TrackedSocket,
    location: { protocol: 'http:', host: `127.0.0.1:${port}` },
    retryMinMs: 20,
    retryMaxMs: 50,
  });
  const statuses = [];
  emitter.on('status', ({ status }) => statuses.push(status));
  return { emitter, http, session, net, sockets, statuses, storage };
}

const waitFor = (emitter, type, ms = 2000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`событие ${type} не пришло`)), ms);
    const off = emitter.on(type, (payload) => {
      clearTimeout(timer);
      off();
      resolve(payload);
    });
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('http: ошибки сервера превращаются в ApiError с кодом', async () => {
  const { app, port } = await startServer();
  try {
    const { http } = makeClient(port);
    await assert.rejects(http.join('ab', ROOM), (e) => e instanceof ApiError && e.status === 400 && e.code === 'bad_name');
    await assert.rejects(http.join('Аня', 'ZZZZ'), (e) => e.status === 403 && e.code === 'bad_room' && e.message === 'Неверный код комнаты');
    const { user } = await http.me((await http.join('Аня', 'bcdf', appearance)).token);
    assert.equal(user.name, 'Аня');
    assert.ok((await http.ping()) >= 0);
  } finally {
    await app.close();
  }
  const dead = createHttp({ baseUrl: `http://127.0.0.1:${port}` });
  await assert.rejects(dead.me('x'), (e) => e.status === 0 && e.code === 'network');
});

test('подключение: тикет → сокет → hello → welcome, токен только в sessionStorage', async () => {
  const { app, port } = await startServer();
  try {
    const c = makeClient(port);
    const { token, user } = await c.http.join('Аня', ROOM, appearance);
    c.session.save(token, user);
    const welcome = waitFor(c.emitter, 'welcome');
    c.net.connect();
    c.net.connect(); // повторный вызов ничего не делает
    const msg = await welcome;
    assert.equal(msg.playerId, user.id);
    assert.equal(msg.proto, 1);
    assert.equal(c.sockets.length, 1);
    assert.deepEqual(c.statuses, ['connecting', 'open']);
    assert.equal(c.storage.getItem('city.token'), token);

    assert.equal(c.net.send({ t: 'pos', x: 416, y: 0, z: 416, ry: 0, anim: 0, seq: 1 }), true);
    assert.equal(c.net.send({ t: 'pos', x: 'bad' }), false, 'неверное сообщение не уходит');
    c.net.disconnect();
    assert.equal(c.net.send({ t: 'chat', text: 'привет' }), false, 'после disconnect отправлять некуда');
  } finally {
    await app.close();
  }
});

test('недействительный токен: статус denied, сессия очищена, переподключения нет', async () => {
  const { app, port } = await startServer();
  try {
    const c = makeClient(port);
    c.session.save('bogus', { id: 1, name: 'x' });
    const auth = waitFor(c.emitter, 'auth');
    c.net.connect();
    assert.equal(await auth, null);
    assert.equal(c.net.status, 'denied');
    assert.equal(c.session.token(), null);
    await sleep(150);
    assert.equal(c.sockets.length, 0);
  } finally {
    await app.close();
  }
});

test('обрыв соединения: новый тикет, повторный hello, обработчики не дублируются', async () => {
  const { app, port } = await startServer();
  try {
    const c = makeClient(port);
    const { token, user } = await c.http.join('Аня', ROOM, appearance);
    c.session.save(token, user);
    let welcomes = 0;
    c.emitter.on('welcome', () => (welcomes += 1));
    const first = waitFor(c.emitter, 'welcome');
    c.net.connect();
    await first;

    const second = waitFor(c.emitter, 'welcome');
    c.sockets[0].terminate(); // обрыв без закрывающего рукопожатия
    await second;
    assert.equal(c.sockets.length, 2);
    assert.equal(welcomes, 2, 'каждый welcome обработан ровно один раз');
    assert.ok(c.statuses.includes('reconnecting'));
    assert.equal(c.sockets[0].onmessage, null, 'у старого сокета обработчики сняты');
    c.net.disconnect();
  } finally {
    await app.close();
  }
});

test('disconnect останавливает переподключение и закрывает сокет', async () => {
  const { app, port } = await startServer();
  try {
    const c = makeClient(port);
    const { token, user } = await c.http.join('Аня', ROOM, appearance);
    c.session.save(token, user);
    const ready = waitFor(c.emitter, 'welcome');
    c.net.connect();
    await ready;
    c.net.disconnect();
    assert.equal(c.net.status, 'closed');
    await sleep(150);
    assert.equal(c.sockets.length, 1);
    assert.equal(c.sockets[0].readyState, WebSocket.CLOSED);
  } finally {
    await app.close();
  }
});

test('тот же пользователь в другом окне: старое подключение получает replaced и не возвращается', async () => {
  const { app, port } = await startServer();
  try {
    const a = makeClient(port);
    const { token, user } = await a.http.join('Аня', ROOM, appearance);
    a.session.save(token, user);
    const ready = waitFor(a.emitter, 'welcome');
    a.net.connect();
    await ready;

    const replaced = waitFor(a.emitter, 'replaced');
    const b = makeClient(port);
    b.session.save(token, user);
    const second = waitFor(b.emitter, 'welcome');
    b.net.connect();
    await second;
    assert.equal((await replaced).code, 4000);
    await sleep(150);
    assert.equal(a.net.status, 'closed');
    assert.equal(a.sockets.length, 1, 'старое окно не отбирает сокет обратно');
    b.net.disconnect();
  } finally {
    await app.close();
  }
});


test('http: appearance передаётся при регистрации и не перезаписывает существующий профиль', async () => {
  const { app, port } = await startServer();
  try {
    const { http } = makeClient(port);
    await assert.rejects(http.join('Аня', ROOM), (error) => error.code === 'bad_appearance');
    const first = await http.join('Аня', ROOM, appearance);
    assert.deepEqual(first.user.appearance.avatar, appearance.avatar);
    const again = await http.join('Аня', ROOM);
    assert.deepEqual(again.user.appearance, first.user.appearance);
    const draft = await http.join('Аня', ROOM, { avatar: { skin: 0, clothes: 0, hair: 0, shoes: 0 } });
    assert.deepEqual(draft.user.appearance, first.user.appearance);
  } finally { await app.close(); }
});

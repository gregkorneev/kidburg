// Код комнаты на экране владельца: отдаётся только соединениям с самого компьютера сервера.

import test from 'node:test';
import assert from 'node:assert/strict';
import { listen, makeApp } from './helpers.js';

const OWN_LAN = '192.168.1.5';
const get = (app, { remoteAddress = '127.0.0.1', headers = {} } = {}) =>
  app.inject({ method: 'GET', url: '/api/local-room', remoteAddress, headers });
const join = (app, remoteAddress, room, name = 'Аня') =>
  app.inject({ method: 'POST', url: '/api/join', remoteAddress, payload: { name, room, appearance: { avatar: { skin: 0, clothes: 0, hair: 0, shoes: 0 } } } });

async function withApp(run, overrides = {}) {
  const app = await makeApp({ roomCode: 'BCDF', localAddresses: () => [OWN_LAN, 'fe80::1%en0'], ...overrides });
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

test('владелец с loopback получает код; ответ не кэшируется', () =>
  withApp(async (app) => {
    for (const remoteAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      const res = await get(app, { remoteAddress });
      assert.equal(res.statusCode, 200, remoteAddress);
      assert.deepEqual(res.json(), { room: 'BCDF' });
      assert.equal(res.headers['cache-control'], 'no-store');
    }
  }));

test('владелец, открывший игру по собственному LAN-адресу, тоже получает код', () =>
  withApp(async (app) => {
    for (const remoteAddress of [OWN_LAN, `::ffff:${OWN_LAN}`]) {
      const res = await get(app, { remoteAddress, headers: { host: `${OWN_LAN}:3000` } });
      assert.equal(res.statusCode, 200, remoteAddress);
      assert.equal(res.json().room, 'BCDF');
    }
  }));

test('удалённый клиент по LAN кода не получает, даже если подделывает заголовки', () =>
  withApp(async (app) => {
    const remote = '192.168.1.50';
    const plain = await get(app, { remoteAddress: remote, headers: { host: `${OWN_LAN}:3000` } });
    assert.equal(plain.statusCode, 404);
    assert.ok(!plain.body.includes('BCDF'));
    const forged = await get(app, {
      remoteAddress: remote,
      headers: { host: 'localhost:3000', 'x-forwarded-for': '127.0.0.1', 'x-real-ip': '127.0.0.1', forwarded: 'for=127.0.0.1' },
    });
    assert.equal(forged.statusCode, 404, 'X-Forwarded-For не учитывается');
    assert.equal((await get(app, { remoteAddress: 'fe80::2' })).statusCode, 404);
    assert.equal((await get(app, { remoteAddress: undefined, headers: {} })).statusCode, 200, 'inject без адреса — loopback');
  }));

test('чужая страница в браузере владельца кода не читает: Host, Origin, Sec-Fetch-Site', () =>
  withApp(async (app) => {
    const bad = [
      { host: 'evil.example:3000' }, // DNS rebinding
      { host: 'localhost:3000', origin: 'http://evil.example' },
      { host: 'localhost:3000', 'sec-fetch-site': 'cross-site' },
      { host: 'localhost:3000', 'sec-fetch-site': 'same-site' },
    ];
    for (const headers of bad) assert.equal((await get(app, { headers })).statusCode, 404, JSON.stringify(headers));
    const good = [
      { host: 'localhost:3000', 'sec-fetch-site': 'same-origin' },
      { host: 'localhost:3000', origin: 'http://localhost:3000' },
      { host: '[::1]:3000' },
      { host: '127.0.0.1:3000', 'sec-fetch-site': 'none' },
    ];
    for (const headers of good) assert.equal((await get(app, { headers })).statusCode, 200, JSON.stringify(headers));
  }));

test('вход с удалённого адреса по-прежнему требует верный код', () =>
  withApp(async (app) => {
    const remote = '192.168.1.50';
    assert.equal((await join(app, remote, 'BCDG')).statusCode, 403);
    assert.equal((await join(app, remote, '')).statusCode, 400);
    const ok = await join(app, remote, 'bcdf');
    assert.equal(ok.statusCode, 200);
    assert.ok(ok.json().token);
    // Локальный адрес не освобождает от проверки кода.
    assert.equal((await join(app, '127.0.0.1', 'ZZZZ', 'Боря')).statusCode, 403);
  }));

test('код нигде кроме endpoint владельца не светится: /health, /api/me, ответы об ошибках', () =>
  withApp(async (app) => {
    const remote = '192.168.1.50';
    const bodies = [
      (await app.inject({ method: 'GET', url: '/health', remoteAddress: remote })).body,
      (await app.inject({ method: 'GET', url: '/api/me', remoteAddress: remote })).body,
      (await join(app, remote, 'BCDG')).body,
    ];
    for (const body of bodies) assert.ok(!body.includes('BCDF'));
  }));

test('код постоянен весь запуск и по настоящему сокету; после перезапуска новый', async () => {
  const codes = new Set();
  for (let i = 0; i < 6; i++) {
    const { app, port } = await listen({});
    try {
      const first = await (await fetch(`http://127.0.0.1:${port}/api/local-room`)).json();
      const second = await (await fetch(`http://localhost:${port}/api/local-room`)).json();
      assert.equal(first.room, app.room.code);
      assert.equal(second.room, first.room, 'обновление страницы код не меняет');
      codes.add(first.room);
    } finally {
      await app.close();
    }
  }
  assert.ok(codes.size > 1, 'каждый запуск создаёт свой код');
});

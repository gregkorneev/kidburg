import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { promisify } from 'node:util';
import { scrypt } from 'node:crypto';
import { hashPassword, hmacSha256, normalizeName, verifyPassword, PASSWORD_MAX, SESSION_TTL_MS } from '../server/net/auth.js';
import { openDb } from '../server/db/index.js';
import { createTicketStore } from '../server/net/tickets.js';
import { TestClient, getTicket, join, listen, makeApp, register, TEST_AUTH_PEPPER, TEST_AUTH_SESSION_SECRET } from './helpers.js';
import { createAttemptLimiter } from '../server/net/room.js';

const appearance = { avatar: { skin: 0, clothes: 0, hair: 0, hairColor: 0, shoes: 0 } };
const post = (app, url, payload, headers) => app.inject({ method: 'POST', url, payload, headers });
const bearer = (token) => ({ authorization: `Bearer ${token}` });

test('hashPassword: Argon2id с pepper и случайной солью', async () => {
  const a = await hashPassword('secret', TEST_AUTH_PEPPER);
  const b = await hashPassword('secret', TEST_AUTH_PEPPER);
  assert.equal(a.salt, '');
  assert.equal(b.salt, '');
  assert.notEqual(a.passHash, b.passHash);
  assert.match(a.passHash, /^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
  assert.notEqual(a.passHash, 'secret');
  assert.equal(await verifyPassword('secret', a.passHash, a.salt, TEST_AUTH_PEPPER), true);
  assert.equal(await verifyPassword('Secret', a.passHash, a.salt, TEST_AUTH_PEPPER), false);
  assert.equal(await verifyPassword('secret', a.passHash, a.salt, 'another-pepper-which-is-also-32b'), false);
});

test('normalizeName: длина 3–20, буквы и цифры, без управляющих символов и смешения алфавитов', () => {
  assert.equal(normalizeName('  Аня  '), 'Аня');
  assert.equal(normalizeName('ab'), null);
  assert.equal(normalizeName('a'.repeat(21)), null);
  assert.equal(normalizeName('a'.repeat(20)), 'a'.repeat(20));
  assert.equal(normalizeName('bad\nname'), null);
  assert.equal(normalizeName('zero​width'), null);
  assert.equal(normalizeName(42), null);
  assert.equal(normalizeName('Маша  Иванова'), 'Маша Иванова', 'повторные пробелы схлопываются');
  assert.equal(normalizeName('Anna_2.0-b'), 'Anna_2.0-b');
  for (const bad of ['<b>Аня</b>', 'Аня!', '_Аня', 'Аня😀', 'Аня\u202Eabc']) {
    assert.equal(normalizeName(bad), null, bad);
  }
  assert.equal(normalizeName('Аnna'), null, 'русская «А» вместе с латиницей');
});

test('вход по паролю (passwordAuth): токен и пользователь, пароль и токен не лежат в базе открытым текстом', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'city-auth-'));
  const dbPath = path.join(dir, 'city.db');
  const app = await makeApp({ dbPath, passwordAuth: true });
  try {
    const res = await post(app, '/api/register', { name: 'Аня', password: 'secret', appearance });
    assert.equal(res.statusCode, 201);
    const { token, user } = res.json();
    assert.equal(user.name, 'Аня');
    assert.deepEqual(user.appearance, appearance);
    assert.equal(Buffer.from(token, 'base64url').length, 32);

    const raw = new Database(dbPath, { readonly: true });
    const row = raw.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    assert.notEqual(row.pass_hash, 'secret');
    assert.equal(row.salt, '');
    assert.match(row.pass_hash, /^\$argon2id\$/);
    const sessions = raw.prepare('SELECT * FROM sessions').all();
    raw.close();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].token_hash, hmacSha256(token, TEST_AUTH_SESSION_SECRET));
    assert.notEqual(sessions[0].token_hash, token);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('регистрация (passwordAuth): отказы по имени, паролю и дублю', async () => {
  const app = await makeApp({ passwordAuth: true });
  const cases = [
    [{ name: 'ab', password: 'secret' }, 400, 'bad_name'],
    [{ name: 'a'.repeat(21), password: 'secret' }, 400, 'bad_name'],
    [{ password: 'secret' }, 400, 'bad_name'],
    [{ name: 'Normal', password: 'abc' }, 400, 'bad_password'],
    [{ name: 'Normal' }, 400, 'bad_password'],
  ];
  for (const [payload, status, error] of cases) {
    const res = await post(app, '/api/register', payload);
    assert.equal(res.statusCode, status, JSON.stringify(payload));
    assert.equal(res.json().error, error);
  }
  assert.equal((await post(app, '/api/register')).statusCode, 400, 'пустое тело');

  await post(app, '/api/register', { name: 'Normal', password: 'secret', appearance });
  const dup = await post(app, '/api/register', { name: 'NORMAL', password: 'other', appearance });
  assert.equal(dup.statusCode, 409);
  assert.equal(dup.json().error, 'name_taken');
  await app.close();
});

test('вход (passwordAuth): верный пароль, неверный пароль, неизвестное имя', async () => {
  const app = await makeApp({ passwordAuth: true });
  const { user } = (await post(app, '/api/register', { name: 'Борис', password: 'secret', appearance })).json();

  const ok = await post(app, '/api/login', { name: 'борис'.replace('б', 'Б'), password: 'secret' });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().user.id, user.id);
  assert.ok(ok.json().token);

  const bad = await post(app, '/api/login', { name: 'Борис', password: 'wrong' });
  assert.equal(bad.statusCode, 401);
  assert.equal(bad.json().error, 'bad_credentials');
  assert.equal(bad.json().token, undefined);

  const unknown = await post(app, '/api/login', { name: 'Никто', password: 'secret' });
  assert.equal(unknown.statusCode, 401);
  assert.equal(unknown.json().error, 'bad_credentials');
  assert.equal((await post(app, '/api/login', {})).statusCode, 401);
  await app.close();
});

test('вход (passwordAuth): верный пароль с добавленным суффиксом длиннее лимита отклоняется', async () => {
  const app = await makeApp({ passwordAuth: true });
  const password = 'p'.repeat(PASSWORD_MAX);
  await post(app, '/api/register', { name: 'Егор', password, appearance });
  assert.equal((await post(app, '/api/login', { name: 'Егор', password })).statusCode, 200);
  for (const extra of ['x', 'x'.repeat(500)]) {
    const res = await post(app, '/api/login', { name: 'Егор', password: password + extra });
    assert.equal(res.statusCode, 401, `суффикс из ${extra.length} симв.`);
    assert.equal(res.json().token, undefined);
  }
  const long = await post(app, '/api/register', { name: 'Жора', password: password + 'x' });
  assert.equal(long.statusCode, 400);
  await app.close();
});

test('старые scrypt-пароли переходят на Argon2id после успешного входа', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'city-auth-migrate-'));
  const dbPath = path.join(dir, 'city.db');
  const legacySalt = '0123456789abcdef0123456789abcdef';
  const legacyHash = await promisify(scrypt)('secret', legacySalt, 64);
  const seedDb = openDb(dbPath);
  seedDb.createUser({ name: 'OldUser', passHash: legacyHash.toString('hex'), salt: legacySalt });
  seedDb.close();
  const app = await makeApp({ dbPath, passwordAuth: true });
  try {
    const login = await post(app, '/api/login', { name: 'OldUser', password: 'secret' });
    assert.equal(login.statusCode, 200);
    const raw = new Database(dbPath, { readonly: true });
    const saved = raw.prepare('SELECT pass_hash, salt FROM users WHERE name = ?').get('OldUser');
    raw.close();
    assert.match(saved.pass_hash, /^\$argon2id\$/);
    assert.equal(saved.salt, '');
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('password routes use the shared attempt limiter and require AUTH_PEPPER', async () => {
  const limiter = createAttemptLimiter({ max: 2 });
  const app = await makeApp({ passwordAuth: true, joinLimiter: limiter });
  try {
    assert.equal((await post(app, '/api/login', { name: 'Nobody', password: 'secret' })).statusCode, 401);
    assert.equal((await post(app, '/api/login', { name: 'Nobody', password: 'secret' })).statusCode, 401);
    assert.equal((await post(app, '/api/login', { name: 'Nobody', password: 'secret' })).statusCode, 429);
  } finally {
    await app.close();
  }
  await assert.rejects(makeApp({ passwordAuth: true, authPepper: '' }), /AUTH_PEPPER/);
});

test('/api/me: нужен действующий Bearer-токен', async () => {
  const app = await makeApp();
  const { token, user } = await register(app, 'Вера');
  const me = await app.inject({ url: '/api/me', headers: bearer(token) });
  assert.equal(me.statusCode, 200);
  assert.deepEqual(me.json().user, user);

  for (const headers of [{}, bearer('bogus'), { authorization: token }, { authorization: 'Basic abc' }]) {
    const res = await app.inject({ url: '/api/me', headers });
    assert.equal(res.statusCode, 401, JSON.stringify(headers));
  }
  await app.close();
});

test('срок сессии: 7 дней', async () => {
  let t = 1_000_000;
  const app = await makeApp({ now: () => t });
  const { token } = await register(app, 'Глеб');
  t += SESSION_TTL_MS - 1;
  assert.equal((await app.inject({ url: '/api/me', headers: bearer(token) })).statusCode, 200);
  t += 1;
  assert.equal((await app.inject({ url: '/api/me', headers: bearer(token) })).statusCode, 401);
  assert.equal((await post(app, '/api/ws-ticket', undefined, bearer(token))).statusCode, 401);
  await app.close();
});

test('/api/ws-ticket: выдаётся только по действующей сессии', async () => {
  const app = await makeApp();
  assert.equal((await post(app, '/api/ws-ticket')).statusCode, 401);
  assert.equal((await post(app, '/api/ws-ticket', undefined, bearer('bogus'))).statusCode, 401);

  const { token } = await register(app, 'Дина');
  const res = await post(app, '/api/ws-ticket', undefined, bearer(token));
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().expiresIn, 30);
  assert.ok(res.json().ticket.length >= 16);
  assert.notEqual(await getTicket(app, token), res.json().ticket);
  await app.close();
});

test('тикет: одноразовый и живёт 30 секунд', () => {
  let t = 0;
  const store = createTicketStore({ now: () => t });
  const first = store.issue(7);
  assert.equal(store.consume(first), 7);
  assert.equal(store.consume(first), null, 'повторно не принимается');
  assert.equal(store.consume('unknown'), null);
  assert.equal(store.consume(''), null);

  const fresh = store.issue(8);
  t = 29_999;
  assert.equal(store.consume(fresh), 8);

  t = 0;
  const stale = store.issue(9);
  t = 30_000;
  assert.equal(store.consume(stale), null, 'просроченный не принимается');

  const old = store.issue(1);
  t = 100_000;
  store.issue(2);
  assert.equal(store.size, 1, 'просроченные тикеты вычищаются');
  assert.equal(store.consume(old), null);
});

// ---- Вход по имени и коду комнаты ----

test('join: имя и код комнаты дают токен; в базе нет пароля, только хеш токена', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'city-join-'));
  const dbPath = path.join(dir, 'city.db');
  const app = await makeApp({ dbPath, roomCode: 'BCDF' });
  try {
    const res = await post(app, '/api/join', { name: '  Аня ', room: 'bcdf', appearance });
    assert.equal(res.statusCode, 200, 'код без учёта регистра, имя без пробелов по краям');
    const { token, user } = res.json();
    assert.equal(user.name, 'Аня');
    assert.equal(Buffer.from(token, 'base64url').length, 32);
    assert.equal((await app.inject({ url: '/api/me', headers: bearer(token) })).json().user.id, user.id);

    const raw = new Database(dbPath, { readonly: true });
    const sessions = raw.prepare('SELECT token_hash FROM sessions').all();
    const stored = raw.prepare('SELECT pass_hash FROM users WHERE id = ?').get(user.id).pass_hash;
    raw.close();
    assert.deepEqual(sessions, [{ token_hash: hmacSha256(token, TEST_AUTH_SESSION_SECRET) }]);
    const guess = await post(app, '/api/login', { name: 'Аня', password: stored });
    assert.equal(guess.statusCode, 404, 'вход по паролю выключен');
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('join: код создаётся при запуске — четыре латинские буквы, у каждого запуска свой', async () => {
  const codes = new Set();
  for (let i = 0; i < 8; i++) {
    const app = await makeApp();
    assert.match(app.room.code, /^[A-Z]{4}$/);
    codes.add(app.room.code);
    await app.close();
  }
  assert.ok(codes.size > 1, 'коды не должны быть одинаковыми');
});

test('join: неверный и неправильно записанный код, плохое имя — понятные отказы без токена', async () => {
  const app = await makeApp({ roomCode: 'BCDF' });
  const cases = [
    [{ name: 'Аня', room: 'BCDG' }, 403, 'bad_room', 'Неверный код комнаты'],
    [{ name: 'Аня', room: 'BCD' }, 400, 'bad_room', 'Код комнаты — четыре латинские буквы'],
    [{ name: 'Аня', room: 'BCDFG' }, 400, 'bad_room'],
    [{ name: 'Аня', room: 'ВСDF' }, 400, 'bad_room'], // кириллические В и С
    [{ name: 'Аня', room: 1234 }, 400, 'bad_room'],
    [{ name: 'Аня' }, 400, 'bad_room'],
    [{ name: 'ab', room: 'BCDF' }, 400, 'bad_name'],
    [{ name: '<script>', room: 'BCDF' }, 400, 'bad_name'],
    [{ room: 'BCDF' }, 400, 'bad_name'],
    [{ name: ['Аня'], room: 'BCDF' }, 400, 'bad_name'],
  ];
  for (const [payload, status, error, message] of cases) {
    const res = await post(app, '/api/join', payload);
    assert.equal(res.statusCode, status, JSON.stringify(payload));
    assert.equal(res.json().error, error, JSON.stringify(payload));
    assert.equal(res.json().token, undefined);
    if (message) assert.equal(res.json().message, message);
  }
  assert.equal((await post(app, '/api/join')).statusCode, 400, 'пустое тело');
  await app.close();
});

test('join: после серии неверных кодов адрес блокируется, верный вход считается отдельно', async () => {
  let t = 0;
  const limiter = createAttemptLimiter({ max: 3, windowMs: 60_000, now: () => t });
  const app = await makeApp({ roomCode: 'BCDF', joinLimiter: limiter });
  for (let i = 0; i < 3; i++) assert.equal((await post(app, '/api/join', { name: 'Аня', room: 'ZZZZ' })).statusCode, 403);
  const blocked = await post(app, '/api/join', { name: 'Аня', room: 'BCDF', appearance });
  assert.equal(blocked.statusCode, 429, 'даже верный код не принимается во время блокировки');
  assert.equal(blocked.json().error, 'too_many');
  t = 60_000;
  assert.equal((await post(app, '/api/join', { name: 'Аня', room: 'BCDF', appearance })).statusCode, 200);
  await app.close();
});

test('join: имя играющего человека занято, после выхода — свободно и возвращает того же игрока', async () => {
  const { app, port } = await listen();
  let client;
  try {
    const first = await join(app, 'Аня');
    client = await TestClient.connect(port, await getTicket(app, first.token));
    client.send({ t: 'hello', ticket: 'x', proto: 1 });
    await client.nextOfType('welcome');

    for (const name of ['аня', 'АНЯ', ' Аня ']) {
      const taken = await post(app, '/api/join', { name, room: app.room.code });
      assert.equal(taken.statusCode, 409, name);
      assert.equal(taken.json().error, 'name_taken');
      assert.equal(taken.json().token, undefined);
    }
    assert.equal((await app.inject({ url: '/api/me', headers: bearer(first.token) })).statusCode, 200, 'первый игрок не вытеснен');

    client.ws.close();
    await client.closed;
    await new Promise((resolve) => setTimeout(resolve, 50));
    const again = await join(app, 'аня');
    assert.equal(again.user.id, first.user.id, 'тот же игрок, а не двойник с другим регистром');
  } finally {
    client?.ws.terminate();
    await app.close();
  }
});

test('второй сервер с той же базой не отзывает сессию первого', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'city-concurrent-'));
  const dbPath = path.join(dir, 'city.db');
  const first = await makeApp({ dbPath, roomCode: 'BCDF' });
  let second;
  try {
    const { token } = (await post(first, '/api/join', { name: 'Аня', room: 'BCDF', appearance })).json();
    assert.equal((await first.inject({ url: '/api/me', headers: bearer(token) })).statusCode, 200);
    second = await makeApp({ dbPath, roomCode: 'GHJK' });
    assert.equal((await first.inject({ url: '/api/me', headers: bearer(token) })).statusCode, 200);
    assert.equal((await post(first, '/api/ws-ticket', undefined, bearer(token))).statusCode, 200);
    assert.equal((await second.inject({ url: '/api/me', headers: bearer(token) })).statusCode, 401);
    const other = (await post(second, '/api/join', { name: 'Борис', room: 'GHJK', appearance })).json();
    assert.equal((await second.inject({ url: '/api/me', headers: bearer(other.token) })).statusCode, 200);
    assert.equal((await first.inject({ url: '/api/me', headers: bearer(other.token) })).statusCode, 401);
    assert.equal((await first.inject({ url: '/api/me', headers: bearer(token) })).statusCode, 200);
  } finally {
    await second?.close();
    await first.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('перезапуск: токен прошлого запуска и его код больше не пускают', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'city-restart-'));
  const dbPath = path.join(dir, 'city.db');
  try {
    const first = await makeApp({ dbPath, roomCode: 'BCDF' });
    const old = (await post(first, '/api/join', { name: 'Аня', room: 'BCDF', appearance })).json();
    assert.equal((await post(first, '/api/ws-ticket', undefined, bearer(old.token))).statusCode, 200);
    await first.close();

    const second = await makeApp({ dbPath, roomCode: 'GHJK' });
    assert.equal((await second.inject({ url: '/api/me', headers: bearer(old.token) })).statusCode, 401, 'старый токен');
    assert.equal((await post(second, '/api/ws-ticket', undefined, bearer(old.token))).statusCode, 401);
    const stale = await post(second, '/api/join', { name: 'Аня', room: 'BCDF', appearance });
    assert.equal(stale.statusCode, 403, 'старый код');
    const fresh = await post(second, '/api/join', { name: 'Аня', room: 'GHJK' });
    assert.equal(fresh.statusCode, 200);
    assert.equal(fresh.json().user.id, old.user.id, 'то же имя — тот же игрок, позиция сохраняется');
    await second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('вход по паролю выключен по умолчанию: /api/register и /api/login недоступны', async () => {
  const app = await makeApp();
  for (const url of ['/api/register', '/api/login']) {
    assert.equal((await post(app, url, { name: 'Аня', password: 'secret' })).statusCode, 404, url);
  }
  await app.close();
});

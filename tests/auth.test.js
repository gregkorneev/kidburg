import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { hashPassword, normalizeName, sha256, verifyPassword, PASSWORD_MAX, SESSION_TTL_MS } from '../server/net/auth.js';
import { createTicketStore } from '../server/net/tickets.js';
import { getTicket, makeApp, register } from './helpers.js';

const post = (app, url, payload, headers) => app.inject({ method: 'POST', url, payload, headers });
const bearer = (token) => ({ authorization: `Bearer ${token}` });

test('hashPassword: соль отдельная, проверка timingSafeEqual', async () => {
  const a = await hashPassword('secret');
  const b = await hashPassword('secret');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.passHash, b.passHash);
  assert.notEqual(a.passHash, 'secret');
  assert.equal(await verifyPassword('secret', a.passHash, a.salt), true);
  assert.equal(await verifyPassword('Secret', a.passHash, a.salt), false);
});

test('normalizeName: длина 3–20, без управляющих символов', () => {
  assert.equal(normalizeName('  Аня  '), 'Аня');
  assert.equal(normalizeName('ab'), null);
  assert.equal(normalizeName('a'.repeat(21)), null);
  assert.equal(normalizeName('a'.repeat(20)), 'a'.repeat(20));
  assert.equal(normalizeName('bad\nname'), null);
  assert.equal(normalizeName('zero​width'), null);
  assert.equal(normalizeName(42), null);
});

test('регистрация: токен и пользователь, пароль и токен не лежат в базе открытым текстом', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'city-auth-'));
  const dbPath = path.join(dir, 'city.db');
  const app = await makeApp({ dbPath });
  try {
    const res = await post(app, '/api/register', { name: 'Аня', password: 'secret' });
    assert.equal(res.statusCode, 201);
    const { token, user } = res.json();
    assert.equal(user.name, 'Аня');
    assert.deepEqual(user.appearance, {});
    assert.equal(Buffer.from(token, 'base64url').length, 32);

    const raw = new Database(dbPath, { readonly: true });
    const row = raw.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    assert.notEqual(row.pass_hash, 'secret');
    assert.ok(row.salt.length > 0);
    const sessions = raw.prepare('SELECT * FROM sessions').all();
    raw.close();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].token_hash, sha256(token));
    assert.notEqual(sessions[0].token_hash, token);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('регистрация: отказы по имени, паролю и дублю', async () => {
  const app = await makeApp();
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

  await register(app, 'Normal');
  const dup = await post(app, '/api/register', { name: 'NORMAL', password: 'other' });
  assert.equal(dup.statusCode, 409);
  assert.equal(dup.json().error, 'name_taken');
  await app.close();
});

test('вход: верный пароль, неверный пароль, неизвестное имя', async () => {
  const app = await makeApp();
  const { user } = await register(app, 'Борис', 'secret');

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

test('вход: верный пароль с добавленным суффиксом длиннее лимита отклоняется', async () => {
  const app = await makeApp();
  const password = 'p'.repeat(PASSWORD_MAX);
  await register(app, 'Егор', password);
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

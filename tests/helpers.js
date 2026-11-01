// Общие помощники тестов: приложение с базой в памяти и WebSocket-клиент.

import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { openDb } from '../server/db/index.js';
import { buildApp } from '../server/index.js';
import { decode, encode } from '../shared/protocol.js';
import { makeFixtures } from '../tools/fixtures/make-fixtures.mjs';

export const TEST_AUTH_PEPPER = 'test-pepper-that-is-at-least-32-bytes-long';
export const TEST_AUTH_SESSION_SECRET = 'test-session-secret-at-least-32-bytes';

export async function makeApp(overrides = {}) {
  // Без worldDir чанки не передаются: тесты не зависят от локальной папки generated/.
  const worldDir = path.join(tmpdir(), 'city-no-world');
  return buildApp({
    dbPath: ':memory:', logLevel: 'silent', worldDir,
    authPepper: TEST_AUTH_PEPPER,
    authSessionSecret: TEST_AUTH_SESSION_SECRET,
    ...overrides,
  });
}

/** Временный файл базы: { dbPath, cleanup }. */
export function tempDb() {
  const dir = mkdtempSync(path.join(tmpdir(), 'city-test-'));
  return { dbPath: path.join(dir, 'city.db'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Кладёт позицию игрока в файл базы через отдельное соединение (до его hello). */
export function seedPlayerState(dbPath, name, state) {
  const db = openDb(dbPath);
  db.savePlayerState({ userId: db.findUserByName(name).id, ...state });
  db.close();
}

/** Читает позицию игрока из файла базы. */
export function readPlayerState(dbPath, name) {
  const db = openDb(dbPath);
  const state = db.getPlayerState(db.findUserByName(name).id);
  db.close();
  return state;
}

/** Запускает приложение на свободном порту loopback. */
export async function listen(overrides = {}) {
  const app = await makeApp(overrides);
  await app.listen({ host: '127.0.0.1', port: 0 });
  return { app, port: app.server.address().port };
}

/** Вход по имени и коду комнаты этого приложения: { token, user }. */
export async function join(app, name, room = app.room.code) {
  const res = await app.inject({ method: 'POST', url: '/api/join', payload: { name, room } });
  if (res.statusCode !== 200) throw new Error(`join ${name}: ${res.statusCode} ${res.body}`);
  return res.json();
}

export const register = join;

export async function getTicket(app, token) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/ws-ticket',
    headers: { authorization: `Bearer ${token}` },
  });
  return res.json().ticket;
}

/** Клиент с очередью входящих сообщений и ожиданием нужного. */
export class TestClient {
  constructor(ws) {
    this.ws = ws;
    this.inbox = [];
    this.waiters = [];
    this.closed = new Promise((resolve) => ws.once('close', (code) => resolve(code)));
    ws.on('message', (data) => {
      this.inbox.push(decode(data));
      this.#flush();
    });
  }

  static async connect(port, ticket, wsOptions) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${ticket}`, wsOptions);
    await once(ws, 'open');
    return new TestClient(ws);
  }

  send(msg) {
    this.ws.send(encode(msg));
  }

  #flush() {
    for (const w of [...this.waiters]) {
      const i = this.inbox.findIndex(w.match);
      if (i === -1) continue;
      const [msg] = this.inbox.splice(i, 1);
      this.waiters.splice(this.waiters.indexOf(w), 1);
      clearTimeout(w.timer);
      w.resolve(msg);
    }
  }

  /** Ждёт первое сообщение, подходящее под условие (уже пришедшие тоже считаются). */
  next(match = () => true, ms = 2000) {
    return new Promise((resolve, reject) => {
      const w = { match, resolve };
      w.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        reject(new Error(`сообщение не пришло за ${ms} мс`));
      }, ms);
      this.waiters.push(w);
      this.#flush();
    });
  }

  nextOfType(t, ms) {
    return this.next((m) => m.t === t, ms);
  }

  close() {
    this.ws.close();
    return this.closed;
  }
}

/** Регистрирует игрока, получает тикет, подключается и проходит hello. */
export async function joinGame(app, port, name) {
  const { token, user } = await register(app, name);
  const client = await TestClient.connect(port, await getTicket(app, token));
  client.send({ t: 'hello', ticket: 'x', proto: 1 });
  const welcome = await client.nextOfType('welcome');
  return { client, welcome, user, token };
}

/** Генерирует фикстуры мира во временную папку: { worldDir, cleanup }. */
export function tempWorld() {
  const dir = mkdtempSync(path.join(tmpdir(), 'city-world-'));
  makeFixtures(dir);
  return { worldDir: dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ── Control Center ────────────────────────────────────────────────────────────────────────
export const ADMIN_PASSWORD = 'correct-horse-battery';
const ADMIN_HEADERS = { host: 'localhost:3000', origin: 'http://localhost:3000' };

/** Приложение с включённой панелью администратора. */
export const makeAdminApp = (overrides = {}) => makeApp({ adminPassword: ADMIN_PASSWORD, ...overrides });

/** Вход администратора через inject: { cookie, csrf }. */
export async function adminLogin(app, password = ADMIN_PASSWORD) {
  const res = await app.inject({ method: 'POST', url: '/api/admin/login', headers: ADMIN_HEADERS, payload: { password } });
  if (res.statusCode !== 200) throw new Error(`admin login: ${res.statusCode} ${res.body}`);
  return { cookie: res.headers['set-cookie'].split(';')[0], csrf: res.json().csrf };
}

/** Запрос к /api/admin с cookie, CSRF и Origin администратора. */
export function adminRequest(app, session, method, url, payload, headers = {}) {
  return app.inject({
    method,
    url,
    payload,
    headers: { ...ADMIN_HEADERS, cookie: session.cookie, 'x-csrf-token': session.csrf, ...headers },
  });
}

// REST-авторизация: регистрация, вход, /api/me, тикет для WebSocket.
// Пароль: crypto.scrypt с отдельной солью. Токен: 32 случайных байта (base64url),
// в БД лежит только SHA-256 токена.

import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const NAME_MIN = 3;
export const NAME_MAX = 20;
export const PASSWORD_MIN = 4;
export const PASSWORD_MAX = 128;

const KEY_LEN = 64;
const SALT_LEN = 16;

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export async function hashPassword(password, salt = randomBytes(SALT_LEN).toString('hex')) {
  const key = await scryptAsync(password, salt, KEY_LEN);
  return { passHash: key.toString('hex'), salt };
}

export async function verifyPassword(password, passHash, salt) {
  const expected = Buffer.from(passHash, 'hex');
  const actual = await scryptAsync(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}

// Хеш для неизвестного имени: вход тратит столько же времени, сколько для известного.
let decoyPromise;
const decoy = () => (decoyPromise ??= hashPassword('decoy'));

/** Возвращает очищенное имя или null, если оно не подходит. */
export function normalizeName(name) {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  const len = [...trimmed].length;
  if (len < NAME_MIN || len > NAME_MAX) return null;
  if (/[\p{Cc}\p{Cf}]/u.test(trimmed)) return null;
  return trimmed;
}

const validPassword = (p) => typeof p === 'string' && p.length >= PASSWORD_MIN && p.length <= PASSWORD_MAX;

const publicUser = (u) => ({ id: u.id, name: u.name, appearance: u.appearance });

/** Пользователь по заголовку Authorization: Bearer <token> или null. */
export function authenticate(db, req, now = Date.now()) {
  const m = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? '');
  if (!m) return null;
  const session = db.findSession(sha256(m[1]), now);
  return session ? db.getUser(session.userId) : null;
}

function issueSession(db, userId, now) {
  const token = randomBytes(32).toString('base64url');
  db.createSession(sha256(token), userId, now + SESSION_TTL_MS);
  return token;
}

const fail = (reply, status, error, message) => reply.code(status).send({ error, message });

/** Регистрирует /api/register, /api/login, /api/me, /api/ws-ticket. */
export function registerAuthRoutes(app, { db, tickets, now = Date.now }) {
  app.post('/api/register', async (req, reply) => {
    const body = req.body ?? {};
    const name = normalizeName(body.name);
    if (!name) return fail(reply, 400, 'bad_name', `Имя: от ${NAME_MIN} до ${NAME_MAX} символов`);
    if (!validPassword(body.password)) {
      return fail(reply, 400, 'bad_password', `Пароль: от ${PASSWORD_MIN} до ${PASSWORD_MAX} символов`);
    }
    const { passHash, salt } = await hashPassword(body.password);
    const t = now();
    const user = db.createUser({ name, passHash, salt, now: t });
    if (!user) return fail(reply, 409, 'name_taken', 'Такое имя уже занято');
    db.purgeExpiredSessions(t);
    return reply.code(201).send({ token: issueSession(db, user.id, t), user: publicUser(user) });
  });

  app.post('/api/login', async (req, reply) => {
    const body = req.body ?? {};
    const name = normalizeName(body.name);
    const password = typeof body.password === 'string' ? body.password : '';
    const found = name ? db.findUserByName(name) : null;
    const { passHash, salt } = found ?? (await decoy());
    const ok = await verifyPassword(password.slice(0, PASSWORD_MAX), passHash, salt);
    if (!found || !ok) return fail(reply, 401, 'bad_credentials', 'Неверное имя или пароль');
    const t = now();
    db.purgeExpiredSessions(t);
    return { token: issueSession(db, found.id, t), user: publicUser(found) };
  });

  app.get('/api/me', async (req, reply) => {
    const user = authenticate(db, req, now());
    if (!user) return fail(reply, 401, 'unauth', 'Нужна авторизация');
    return { user: publicUser(user) };
  });

  app.post('/api/ws-ticket', async (req, reply) => {
    const user = authenticate(db, req, now());
    if (!user) return fail(reply, 401, 'unauth', 'Нужна авторизация');
    return { ticket: tickets.issue(user.id), expiresIn: tickets.ttlMs / 1000 };
  });
}

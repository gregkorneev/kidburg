import { normalizeAvatar, normalizeStoredAvatar } from '../../shared/avatar.js';
// REST-авторизация: вход по имени и коду комнаты (/api/join), /api/me, тикет для WebSocket.
// Личность игрока задаёт только сервер: токен из /api/join -> одноразовый тикет -> сокет.
// Токен: 32 случайных байта (base64url), в БД лежит только HMAC-SHA-256 токена.
// Вход по паролю (/api/register, /api/login, Argon2id + pepper) включается
// только флагом passwordAuth: по умолчанию выключен, иначе он обходил бы код комнаты.

import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import argon2 from 'argon2';
import { isServerOwner, ownAddresses } from './local.js';
import { createAttemptLimiter, normalizeRoomCode } from './room.js';

const scryptAsync = promisify(scrypt);

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const NAME_MIN = 3;
export const NAME_MAX = 20;
export const PASSWORD_MIN = 4;
export const PASSWORD_MAX = 128;

const KEY_LEN = 64;
const SALT_LEN = 16;
const ARGON2_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
});

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');
export const hmacSha256 = (text, secret) => createHmac('sha256', secret).update(text).digest('hex');

function passwordMaterial(password, pepper) {
  return createHmac('sha256', pepper).update(password, 'utf8').digest('base64');
}

function secureSecret(value, name) {
  const secret = Buffer.isBuffer(value) ? value : Buffer.from(value ?? '', 'utf8');
  if (secret.length < 32) throw new Error(`${name} должен содержать не менее 32 случайных байт`);
  return secret;
}

/** Ключ сессий можно задать отдельно; без него используется случайный ключ текущего запуска. */
export function resolveAuthSecrets({ passwordAuth = false, authPepper = process.env.AUTH_PEPPER, authSessionSecret = process.env.AUTH_SESSION_SECRET } = {}) {
  const pepper = passwordAuth ? secureSecret(authPepper, 'AUTH_PEPPER') : authPepper ? secureSecret(authPepper, 'AUTH_PEPPER') : null;
  const session = authSessionSecret ? secureSecret(authSessionSecret, 'AUTH_SESSION_SECRET') : randomBytes(32);
  return { pepper, session };
}

export async function hashPassword(password, pepper) {
  const secret = secureSecret(pepper, 'AUTH_PEPPER');
  return { passHash: await argon2.hash(passwordMaterial(password, secret), ARGON2_OPTIONS), salt: '' };
}

function isLegacyScryptHash(passHash, salt) {
  return typeof passHash === 'string' && /^[0-9a-f]{128}$/i.test(passHash) && typeof salt === 'string' && /^[0-9a-f]{32}$/i.test(salt);
}

/** Поддерживает старые scrypt-записи только для успешного входа с последующим upgrade в Argon2id. */
export async function verifyPassword(password, passHash, salt, pepper) {
  if (typeof passHash === 'string' && /^\$argon2id\$v=19\$m=19456,p=1,t=2\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/.test(passHash)) {
    try {
      return await argon2.verify(passHash, passwordMaterial(password, secureSecret(pepper, 'AUTH_PEPPER')));
    } catch {
      return false;
    }
  }
  if (!isLegacyScryptHash(passHash, salt)) return false;
  const expected = Buffer.from(passHash, 'hex');
  const actual = await scryptAsync(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}

// Буквы любого алфавита и цифры; внутри допустимы пробел, точка, дефис и подчёркивание.
const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u;

/** Возвращает очищенное имя или null, если оно не подходит. */
export function normalizeName(name) {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim().replace(/ {2,}/g, ' ');
  const len = [...trimmed].length;
  if (len < NAME_MIN || len > NAME_MAX) return null;
  if (!NAME_PATTERN.test(trimmed)) return null;
  // Латиница вместе с кириллицей в одном имени: «Аnna» с русской «А» выдавала бы себя за «Anna».
  if (/\p{Script=Latin}/u.test(trimmed) && /\p{Script=Cyrillic}/u.test(trimmed)) return null;
  return trimmed;
}

const validPassword = (p) => typeof p === 'string' && p.length >= PASSWORD_MIN && p.length <= PASSWORD_MAX;

const publicUser = (u) => ({ id: u.id, name: u.name, appearance: u.appearance });

/** Пользователь по заголовку Authorization: Bearer <token> или null. */
export function authenticate(db, req, now = Date.now(), sessionSecret) {
  const m = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? '');
  if (!m) return null;
  const session = db.findSession(hmacSha256(m[1], sessionSecret), now);
  return session ? db.getUser(session.userId) : null;
}

function issueSession(db, userId, now, sessionSecret) {
  const token = randomBytes(32).toString('base64url');
  db.createSession(hmacSha256(token, sessionSecret), userId, now + SESSION_TTL_MS);
  return token;
}

const fail = (reply, status, error, message) => reply.code(status).send({ error, message });

/**
 * Регистрирует /api/join, /api/me, /api/ws-ticket (и /api/register, /api/login при passwordAuth).
 * @param {object} deps
 * @param {{code: string, matches(code: unknown): boolean}} deps.room комната текущего запуска сервера
 * @param {(userId: number) => boolean} [deps.isOnline] есть ли у пользователя открытый сокет
 */
export function registerAuthRoutes(
  app,
  { db, tickets, room, isOnline = () => false, passwordAuth = false, authSecrets = resolveAuthSecrets({ passwordAuth }), limiter = createAttemptLimiter(), localAddresses = ownAddresses, now = Date.now },
) {
  app.post('/api/join', async (req, reply) => {
    const body = req.body ?? {};
    const key = req.ip;
    if (limiter.blocked(key)) return fail(reply, 429, 'too_many', 'Слишком много неверных попыток. Подождите минуту.');
    const name = normalizeName(body.name);
    if (!name) {
      return fail(reply, 400, 'bad_name', `Имя: от ${NAME_MIN} до ${NAME_MAX} символов — буквы, цифры, пробел, точка, дефис`);
    }
    if (normalizeRoomCode(body.room) === null) {
      limiter.fail(key);
      return fail(reply, 400, 'bad_room', 'Код комнаты — четыре латинские буквы');
    }
    if (!room.matches(body.room)) {
      limiter.fail(key);
      return fail(reply, 403, 'bad_room', 'Неверный код комнаты');
    }
    const t = now();
    let user = db.findUserByNameAnyCase(name);
    // Имя играющего человека не отдаём: иначе по имени можно было бы вытеснить его из игры.
    if (user && isOnline(user.id)) return fail(reply, 409, 'name_taken', 'Это имя сейчас занято. Выберите другое.');
    if (!normalizeStoredAvatar(user?.appearance?.avatar)) {
      if (body.appearance === undefined) return fail(reply, 400, 'appearance_required', 'Создайте персонажа для входа в игру');
      const avatar = normalizeAvatar(body.appearance?.avatar);
      if (!avatar) return fail(reply, 400, 'bad_appearance', 'Выберите допустимые варианты внешности');
      // Пароля нет: в БД лежит случайный хеш, которому не соответствует ни один пароль.
      user = user
        ? db.updateAppearance(user.id, { ...user.appearance, avatar })
        : db.createUser({ name, passHash: randomBytes(KEY_LEN).toString('hex'), salt: randomBytes(SALT_LEN).toString('hex'), appearance: { avatar }, now: t });
      if (!user) return fail(reply, 409, 'name_taken', 'Это имя сейчас занято. Выберите другое.');
    }
    db.purgeExpiredSessions(t);
    limiter.reset?.(key);
    return { token: issueSession(db, user.id, t, authSecrets.session), user: publicUser(user) };
  });

  // Код для экрана владельца сервера. Чужому компьютеру отвечаем 404, как будто пути нет:
  // получить код по сети можно только от того, кто его уже знает (владелец называет его вслух).
  app.get('/api/local-room', async (req, reply) => {
    if (!isServerOwner(req, localAddresses)) return fail(reply, 404, 'not_found', 'Не найдено');
    reply.header('cache-control', 'no-store');
    return { room: room.code };
  });

  if (passwordAuth) registerPasswordRoutes(app, { db, now, authSecrets, limiter });

  app.get('/api/me', async (req, reply) => {
    const user = authenticate(db, req, now(), authSecrets.session);
    if (!user) return fail(reply, 401, 'unauth', 'Нужна авторизация');
    return { user: publicUser(user) };
  });

  app.post('/api/ws-ticket', async (req, reply) => {
    const user = authenticate(db, req, now(), authSecrets.session);
    if (!user) return fail(reply, 401, 'unauth', 'Нужна авторизация');
    return { ticket: tickets.issue(user.id), expiresIn: tickets.ttlMs / 1000 };
  });
}

function registerPasswordRoutes(app, { db, now, authSecrets, limiter }) {
  let decoyPromise;
  const decoy = () => (decoyPromise ??= hashPassword('decoy', authSecrets.pepper));

  app.post('/api/register', async (req, reply) => {
    const key = req.ip;
    if (limiter.blocked(key)) return fail(reply, 429, 'too_many', 'Слишком много попыток. Подождите минуту.');
    const body = req.body ?? {};
    const name = normalizeName(body.name);
    if (!name) {
      limiter.fail(key);
      return fail(reply, 400, 'bad_name', `Имя: от ${NAME_MIN} до ${NAME_MAX} символов`);
    }
    if (!validPassword(body.password)) {
      limiter.fail(key);
      return fail(reply, 400, 'bad_password', `Пароль: от ${PASSWORD_MIN} до ${PASSWORD_MAX} символов`);
    }
    const avatar = normalizeAvatar(body.appearance?.avatar);
    if (!avatar) return fail(reply, 400, 'bad_appearance', 'Выберите допустимые варианты внешности');
    const { passHash, salt } = await hashPassword(body.password, authSecrets.pepper);
    const t = now();
    const user = db.createUser({ name, passHash, salt, appearance: { avatar }, now: t });
    if (!user) {
      limiter.fail(key);
      return fail(reply, 409, 'name_taken', 'Такое имя уже занято');
    }
    limiter.reset?.(key);
    db.purgeExpiredSessions(t);
    return reply.code(201).send({ token: issueSession(db, user.id, t, authSecrets.session), user: publicUser(user) });
  });

  app.post('/api/login', async (req, reply) => {
    const key = req.ip;
    if (limiter.blocked(key)) return fail(reply, 429, 'too_many', 'Слишком много неверных попыток. Подождите минуту.');
    const body = req.body ?? {};
    const name = normalizeName(body.name);
    // Слишком длинный пароль не обрезается, а отклоняется: иначе подошёл бы верный префикс с любым хвостом.
    const password = validPassword(body.password) ? body.password : null;
    const found = name ? db.findUserByName(name) : null;
    const { passHash, salt } = found ?? (await decoy());
    const ok = await verifyPassword(password ?? '', passHash, salt, authSecrets.pepper);
    if (isLegacyScryptHash(passHash, salt)) await verifyPassword(password ?? '', (await decoy()).passHash, '', authSecrets.pepper);
    if (!found || password === null || !ok) {
      limiter.fail(key);
      return fail(reply, 401, 'bad_credentials', 'Неверное имя или пароль');
    }
    if (isLegacyScryptHash(passHash, salt)) {
      const upgraded = await hashPassword(password, authSecrets.pepper);
      db.updatePasswordHash(found.id, upgraded.passHash, upgraded.salt);
    }
    limiter.reset?.(key);
    const t = now();
    db.purgeExpiredSessions(t);
    return { token: issueSession(db, found.id, t, authSecrets.session), user: publicUser(found) };
  });
}

// Авторизация администратора Control Center. Полностью отдельна от игры: код комнаты и токены игроков
// административных прав не дают. Пароль берётся из окружения (ADMIN_PASSWORD) и нигде не сохраняется;
// без пароля административные функции закрыты. Сессия — случайный токен в HttpOnly SameSite=Strict cookie;
// в памяти сервера хранится только SHA-256 токена. Изменяющие запросы требуют Origin этого же хоста и
// CSRF-токен в заголовке. По умолчанию доступ только с компьютера сервера.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isServerOwner } from '../net/local.js';
import { createAttemptLimiter } from '../net/room.js';

export const COOKIE_NAME = 'carrierium_admin';
export const ADMIN_PASSWORD_MIN = 8;
export const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const ADMIN_IDLE_TTL_MS = 2 * 60 * 60 * 1000;

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** Origin запроса совпадает с Host (защита от кросс-сайтовых запросов). */
export function originMatchesHost(req) {
  const { origin, host } = req.headers;
  if (typeof origin !== 'string' || typeof host !== 'string') return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * @param {object} options
 * @param {string} [options.password] пароль администратора; короче ADMIN_PASSWORD_MIN или пустой — функции закрыты
 * @param {boolean} [options.allowRemote] разрешить доступ не с компьютера сервера (HTTP без TLS!)
 * @param {() => string[]} [options.localAddresses] адреса этого компьютера (для тестов)
 */
export function createAdminAuth({ password, allowRemote = false, localAddresses, now = Date.now, limiter, log } = {}) {
  const enabled = typeof password === 'string' && password.length >= ADMIN_PASSWORD_MIN;
  if (typeof password === 'string' && password !== '' && !enabled) {
    log?.warn(`ADMIN_PASSWORD короче ${ADMIN_PASSWORD_MIN} символов: панель администратора закрыта`);
  }
  // Сравнение через HMAC со случайным ключом запуска: время не зависит от совпавшего префикса и длины.
  const key = randomBytes(32);
  const digest = (text) => createHmac('sha256', key).update(text, 'utf8').digest();
  const expected = enabled ? digest(password) : null;
  const attempts = limiter ?? createAttemptLimiter({ max: 5, windowMs: 5 * 60_000, now });

  /** @type {Map<string, {id: string, csrf: string, createdAt: number, lastSeen: number, bucket: number[]}>} */
  const sessions = new Map();

  function purge() {
    const t = now();
    for (const [hash, s] of sessions) {
      if (t - s.createdAt > ADMIN_SESSION_TTL_MS || t - s.lastSeen > ADMIN_IDLE_TTL_MS) sessions.delete(hash);
    }
  }

  const api = {
    enabled,
    allowRemote,
    /** Клиент допустим по адресу: компьютер сервера или явно разрешённый удалённый доступ. */
    clientAllowed: (req) => allowRemote || isServerOwner(req, localAddresses),

    passwordMatches: (input) => enabled && typeof input === 'string' && input.length <= 256 && timingSafeEqual(digest(input), expected),

    /** Сессия по cookie запроса или null. Продлевает «простой» активной сессии. */
    session(req) {
      purge();
      const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
      if (!token || token.length > 128) return null;
      const s = sessions.get(sha256(token));
      if (!s) return null;
      s.lastSeen = now();
      return s;
    },

    /** Создаёт сессию и возвращает заголовок Set-Cookie. */
    open() {
      purge();
      const token = randomBytes(32).toString('base64url');
      const hash = sha256(token);
      const session = { id: `adm_${hash.slice(0, 8)}`, hash, csrf: randomBytes(24).toString('base64url'), createdAt: now(), lastSeen: now(), bucket: [] };
      sessions.set(hash, session);
      return {
        session,
        cookie: `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ADMIN_SESSION_TTL_MS / 1000}`,
      };
    },

    /**
     * Сессия ещё действует: не отозвана и не истекла. Не продлевает простой — для долгих потоков (SSE),
     * которые сами по себе не должны удерживать сессию живой.
     */
    alive(session) {
      purge();
      return Boolean(session) && sessions.get(session.hash) === session;
    },

    close(req) {
      const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
      if (token) sessions.delete(sha256(token));
      return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
    },

    csrfOk(session, req) {
      const given = req.headers['x-csrf-token'];
      if (typeof given !== 'string' || given.length !== session.csrf.length) return false;
      return timingSafeEqual(Buffer.from(given), Buffer.from(session.csrf));
    },

    /** Не более `max` изменяющих запросов за окно на сессию. */
    rateOk(session, { max = 40, windowMs = 10_000 } = {}) {
      const t = now();
      session.bucket = session.bucket.filter((at) => t - at < windowMs);
      if (session.bucket.length >= max) return false;
      session.bucket.push(t);
      return true;
    },

    loginBlocked: (req) => attempts.blocked(req.ip),
    loginFailed: (req) => attempts.fail(req.ip),
    loginSucceeded: (req) => attempts.reset?.(req.ip),
    revokeAll: () => sessions.clear(),
    get sessionCount() {
      purge();
      return sessions.size;
    },
  };
  return api;
}

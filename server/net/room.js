// Код комнаты: четыре латинские буквы, создаются при каждом запуске сервера и нигде не хранятся.
// Согласные без гласных: случайный код не складывается в слово. 20^4 = 160 000 вариантов,
// перебор по сети ограничивает createAttemptLimiter.

import { randomInt, timingSafeEqual } from 'node:crypto';

export const ROOM_CODE_LENGTH = 4;
const ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';

export function generateRoomCode(pick = randomInt) {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ALPHABET[pick(ALPHABET.length)];
  return code;
}

/** Код в верхнем регистре или null, если это не четыре латинские буквы. */
export function normalizeRoomCode(input) {
  if (typeof input !== 'string') return null;
  const code = input.trim().toUpperCase();
  return /^[A-Z]{4}$/.test(code) ? code : null;
}

/** @param {{code?: string}} [options] code нужен тестам; без него код случайный */
export function createRoom({ code } = {}) {
  const value = code === undefined ? generateRoomCode() : normalizeRoomCode(code);
  if (!value) throw new Error('код комнаты: ровно четыре латинские буквы');
  const expected = Buffer.from(value);
  return {
    code: value,
    /** Сравнение за постоянное время; регистр и пробелы по краям не важны. */
    matches(input) {
      const given = normalizeRoomCode(input);
      return given !== null && timingSafeEqual(Buffer.from(given), expected);
    },
  };
}

/** Ограничитель неудачных попыток по ключу (адресу клиента) в скользящем окне. */
export function createAttemptLimiter({ max = 10, windowMs = 60_000, now = Date.now } = {}) {
  const failures = new Map();
  const recent = (key) => {
    const t = now();
    const list = (failures.get(key) ?? []).filter((at) => t - at < windowMs);
    if (list.length > 0) failures.set(key, list);
    else failures.delete(key);
    return list;
  };
  return {
    blocked: (key) => recent(key).length >= max,
    fail(key) {
      const list = recent(key);
      list.push(now());
      failures.set(key, list);
    },
    reset(key) {
      failures.delete(key);
    },
  };
}

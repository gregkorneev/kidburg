// Строгий формат пользовательского аватара, закреплённого за аккаунтом.
export const AVATAR_VARIANT_COUNT = 4;
export const DEFAULT_AVATAR = Object.freeze({ skin: 0, clothes: 0, hair: 0, shoes: 0 });
const FIELDS = Object.freeze(Object.keys(DEFAULT_AVATAR));

/** Возвращает новый безопасный объект или null для некорректного payload. */
export function normalizeAvatar(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== FIELDS.length || keys.some((key) => !FIELDS.includes(key))) return null;
  const result = {};
  for (const field of FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !Number.isInteger(descriptor.value) || descriptor.value < 0 || descriptor.value >= AVATAR_VARIANT_COUNT) return null;
    result[field] = descriptor.value;
  }
  return result;
}

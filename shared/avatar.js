// Строгий формат пользовательского аватара, закреплённого за аккаунтом.
export const AVATAR_VARIANT_COUNT = 4;
export const DEFAULT_AVATAR = Object.freeze({ skin: 0, clothes: 0, hair: 0, hairColor: 0, shoes: 0 });
const FIELDS = Object.freeze(Object.keys(DEFAULT_AVATAR));

/** Возвращает новый безопасный объект или null для некорректного payload. */
function normalizeFields(value, fields) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) return null;
  const result = {};
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !Number.isInteger(descriptor.value) || descriptor.value < 0 || descriptor.value >= AVATAR_VARIANT_COUNT) return null;
    result[field] = descriptor.value;
  }
  return result;
}

/** New registrations must provide all five choices. */
export function normalizeAvatar(value) {
  return normalizeFields(value, FIELDS);
}

/** Older saved avatars have no hairColor; they keep their choices with a fixed fallback. */
export function normalizeStoredAvatar(value) {
  const complete = normalizeAvatar(value);
  if (complete) return complete;
  const legacy = normalizeFields(value, FIELDS.filter((field) => field !== 'hairColor'));
  return legacy ? { ...legacy, hairColor: DEFAULT_AVATAR.hairColor } : null;
}

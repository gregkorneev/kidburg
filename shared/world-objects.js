// Динамические объекты мира (редактор Control Center). Источник правды для сервера, клиента и админ-панели:
// разрешённые типы, границы масштаба, допустимые параметры. Клиент никогда не указывает путь к модели или код —
// только тип из этого списка. Геометрия типов строится в client/engine/dynamic-types.js.

export const WORLD_OBJECT_LIMITS = Object.freeze({
  MAX_TOTAL: 150, // всего динамических объектов в мире
  MAX_PER_CHUNK: 30,
  EDGE_MARGIN: 4, // м от края мира
  MIN_GAP: 0.2, // м между границами соседних динамических объектов
  SIGN_TEXT_MAX: 28,
  ID_PATTERN: /^o_[0-9a-f]{10}$/,
});

const treeVariants = ['round', 'pine', 'birch'];

/**
 * radius — радиус основания при масштабе 1 (м), используется проверкой размещения;
 * collider — [ширина, высота, глубина] при масштабе 1 (AABB как у статических префабов).
 * params — допустимые параметры; всё остальное сервер отклоняет.
 */
export const WORLD_OBJECT_TYPES = Object.freeze({
  tree: { label: 'Дерево', radius: 0.8, scale: [0.7, 1.6], collider: [1, 6, 1], params: { variant: { kind: 'enum', values: treeVariants, labels: { round: 'Лиственное', pine: 'Ель', birch: 'Берёза' }, default: 'round', label: 'Вид' } } },
  bush: { label: 'Куст', radius: 0.9, scale: [0.7, 1.8], collider: [1.2, 1.1, 1.2], params: { tone: { kind: 'int', min: 0, max: 3, default: 0, label: 'Оттенок' } } },
  bench: { label: 'Лавочка', radius: 1.2, scale: [0.8, 1.4], collider: [2, 1, 1], params: {} },
  lamp: { label: 'Фонарь', radius: 0.4, scale: [0.8, 1.5], collider: [0.5, 4, 0.5], params: {} },
  rock: { label: 'Декоративный камень', radius: 0.8, scale: [0.6, 2.5], collider: [1.1, 0.7, 1], params: { tone: { kind: 'int', min: 0, max: 2, default: 0, label: 'Оттенок' } } },
  flowerbed: { label: 'Клумба', radius: 1.5, scale: [0.7, 1.8], collider: [2.4, 0.4, 2.4], params: { tone: { kind: 'int', min: 0, max: 4, default: 0, label: 'Подбор цветов' } } },
  crate: { label: 'Ящик', radius: 0.8, scale: [0.7, 2], collider: [1, 1, 1], params: {} },
  sign: { label: 'Информационная табличка', radius: 1.2, scale: [0.8, 1.3], collider: [2, 2.2, 0.3], params: { text: { kind: 'text', max: WORLD_OBJECT_LIMITS.SIGN_TEXT_MAX, default: '', label: 'Надпись' } } },
});

export const WORLD_OBJECT_TYPE_IDS = Object.freeze(Object.keys(WORLD_OBJECT_TYPES));

export const isObjectType = (type) => typeof type === 'string' && Object.hasOwn(WORLD_OBJECT_TYPES, type);

const cleanText = (value, max) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f<>"`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/**
 * Приводит параметры к допустимому виду. Неизвестные поля и неверные значения — ошибка (не молчаливое отбрасывание).
 * @returns {{ok: true, params: object} | {ok: false, error: string}}
 */
export function normalizeObjectParams(type, input) {
  if (!isObjectType(type)) return { ok: false, error: 'Неизвестный тип объекта' };
  const spec = WORLD_OBJECT_TYPES[type].params;
  const given = input ?? {};
  if (typeof given !== 'object' || Array.isArray(given)) return { ok: false, error: 'params должен быть объектом' };
  for (const key of Object.keys(given)) {
    if (!Object.hasOwn(spec, key)) return { ok: false, error: `Параметр «${key}» не поддерживается типом «${type}»` };
  }
  const params = {};
  for (const [key, def] of Object.entries(spec)) {
    const value = Object.hasOwn(given, key) ? given[key] : def.default;
    if (def.kind === 'enum') {
      if (!def.values.includes(value)) return { ok: false, error: `Параметр «${key}»: допустимо ${def.values.join(', ')}` };
      params[key] = value;
    } else if (def.kind === 'int') {
      if (!Number.isInteger(value) || value < def.min || value > def.max) {
        return { ok: false, error: `Параметр «${key}»: целое от ${def.min} до ${def.max}` };
      }
      params[key] = value;
    } else if (def.kind === 'text') {
      if (typeof value !== 'string') return { ok: false, error: `Параметр «${key}»: нужна строка` };
      params[key] = cleanText(value, def.max);
    }
  }
  return { ok: true, params };
}

/** Описание для интерфейса: без функций, безопасно для JSON. */
export function describeObjectTypes() {
  return Object.entries(WORLD_OBJECT_TYPES).map(([id, t]) => ({
    id,
    label: t.label,
    radius: t.radius,
    scale: t.scale,
    collider: t.collider,
    params: Object.entries(t.params).map(([key, def]) => ({ key, ...def })),
  }));
}

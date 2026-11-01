// Карта мира: преобразования координат, слияние событий `world`, помощники типов. Без DOM.

import { clamp, isNum } from './format.js';

export const WORLD_SIZE = Object.freeze({ x: 768, z: 768 });
export const CHUNK_SIZE = 64;
export const DEFAULT_CENTER = Object.freeze({ x: 416, z: 416 });
export const SCALE_MIN = 0.6; // пикселей на метр
export const SCALE_MAX = 40;

// ── Вид карты: view = { cx, cz, scale }, size = { w, h } в пикселях ──────────────────────────

export const createView = (center = DEFAULT_CENTER, scale = 3) => ({ cx: center.x, cz: center.z, scale });

export function worldToScreen(view, size, x, z) {
  return { sx: size.w / 2 + (x - view.cx) * view.scale, sy: size.h / 2 + (z - view.cz) * view.scale };
}

export function screenToWorld(view, size, sx, sy) {
  return { x: view.cx + (sx - size.w / 2) / view.scale, z: view.cz + (sy - size.h / 2) / view.scale };
}

/** Центр не уходит за пределы мира (с запасом), чтобы карту нельзя было «потерять». */
export function clampView(view) {
  return {
    cx: clamp(view.cx, 0, WORLD_SIZE.x),
    cz: clamp(view.cz, 0, WORLD_SIZE.z),
    scale: clamp(view.scale, SCALE_MIN, SCALE_MAX),
  };
}

/** Масштаб вокруг точки экрана: мировая точка под курсором остаётся на месте. */
export function zoomAt(view, size, factor, sx, sy) {
  const scale = clamp(view.scale * factor, SCALE_MIN, SCALE_MAX);
  const before = screenToWorld(view, size, sx, sy);
  const next = { ...view, scale };
  const after = screenToWorld(next, size, sx, sy);
  return clampView({ cx: view.cx + (before.x - after.x), cz: view.cz + (before.z - after.z), scale });
}

/** Сдвиг карты на (dx, dy) пикселей экрана. */
export function panBy(view, dx, dy) {
  return clampView({ ...view, cx: view.cx - dx / view.scale, cz: view.cz - dy / view.scale });
}

/** Вид, вмещающий весь мир. */
export function fitView(size) {
  const scale = clamp(Math.min(size.w / WORLD_SIZE.x, size.h / WORLD_SIZE.z), SCALE_MIN, SCALE_MAX);
  return { cx: WORLD_SIZE.x / 2, cz: WORLD_SIZE.z / 2, scale };
}

/** Мировая точка → индекс чанка. */
export const chunkOf = (x, z) => ({ cx: Math.floor(x / CHUNK_SIZE), cz: Math.floor(z / CHUNK_SIZE) });

/** Округление координаты до сантиметров (мир в метрах). */
export const snap = (v) => Math.round(v * 100) / 100;

export const inWorld = (x, z) => x >= 0 && z >= 0 && x <= WORLD_SIZE.x && z <= WORLD_SIZE.z;

// ── Типы объектов ────────────────────────────────────────────────────────────────────────────

export const typeIndex = (types) => new Map((types ?? []).map((t) => [t.id, t]));

/** Параметры типа по умолчанию. */
export function defaultParams(typeDef) {
  const out = {};
  for (const p of typeDef?.params ?? []) out[p.key] = p.default;
  return out;
}

export const clampObjectScale = (typeDef, scale) => {
  const [lo, hi] = typeDef?.scale ?? [0.5, 2];
  return Math.round(clamp(isNum(scale) ? scale : 1, lo, hi) * 100) / 100;
};

/** Радиус объекта на карте, м. */
export const objectRadius = (typeDef, obj) => (typeDef?.radius ?? 1) * (isNum(obj.scale) ? obj.scale : 1);

export const TYPE_STYLE = Object.freeze({
  tree: { color: '#4f9a5b', glyph: 'tree' },
  bush: { color: '#7bb561', glyph: 'bush' },
  bench: { color: '#b07a4f', glyph: 'bench' },
  lamp: { color: '#e0a93a', glyph: 'lamp' },
  rock: { color: '#8a8f94', glyph: 'rock' },
  flowerbed: { color: '#d9739a', glyph: 'flower' },
  crate: { color: '#a98558', glyph: 'crate' },
  sign: { color: '#3d8a96', glyph: 'sign' },
});
export const typeColor = (id) => TYPE_STYLE[id]?.color ?? '#6b7f74';

export function paramsEqual(a, b) {
  const ka = Object.keys(a ?? {});
  const kb = Object.keys(b ?? {});
  return ka.length === kb.length && ka.every((k) => a[k] === b?.[k]);
}

/** Различаются ли редактируемые поля объекта (позиция, поворот, масштаб, параметры). */
export function objectChanged(a, b) {
  return a.x !== b.x || a.z !== b.z || a.ry !== b.ry || a.scale !== b.scale || !paramsEqual(a.params, b.params);
}

// ── Состояние мира и слияние событий ─────────────────────────────────────────────────────────

export const emptyWorld = () => ({ revision: 0, objects: new Map(), tombstones: new Map() });

/** Полная загрузка GET /world: сбрасывает «могилы» удалённых. */
export function worldFromSnapshot(objects, revision) {
  return { revision, objects: new Map(objects.map((o) => [o.id, o])), tombstones: new Map() };
}

/**
 * Применяет события `world` ({revision, ops}) или ответы HTTP (в той же форме).
 * - upsert устаревшей версии (rev меньше текущей) и upsert уже удалённого объекта более старой ревизией игнорируются;
 * - remove запоминает «могилу» с ревизией мира: объект не воскресает запоздавшим событием, но может быть
 *   создан заново (отмена удаления) более новой ревизией.
 * Возвращает прежнее состояние, если ничего не изменилось.
 */
export function applyWorldEvent(state, event) {
  const revision = isNum(event?.revision) ? event.revision : state.revision;
  let objects = state.objects;
  let tombstones = state.tombstones;
  const own = () => {
    if (objects === state.objects) objects = new Map(state.objects);
    if (tombstones === state.tombstones) tombstones = new Map(state.tombstones);
  };
  for (const op of event?.ops ?? []) {
    if (op.op === 'upsert' && op.object) {
      const o = op.object;
      const grave = tombstones.get(o.id);
      if (grave !== undefined && revision <= grave) continue;
      const cur = objects.get(o.id);
      if (cur && cur.rev > o.rev) continue;
      if (cur && cur.rev === o.rev && !objectChanged(cur, o)) continue;
      own();
      objects.set(o.id, o);
      tombstones.delete(o.id);
    } else if (op.op === 'remove') {
      const cur = objects.get(op.id);
      if (cur && isNum(op.rev) && cur.rev > op.rev) continue;
      const grave = tombstones.get(op.id);
      if (!cur && grave !== undefined && grave >= revision) continue;
      own();
      objects.delete(op.id);
      tombstones.set(op.id, revision);
    }
  }
  if (objects === state.objects && revision <= state.revision) return state;
  return { revision: Math.max(revision, state.revision), objects, tombstones };
}

/** Число объектов не совпало с счётчиком сервера: пора полностью перезагрузить мир. */
export const needsReload = (state, serverCount) => isNum(serverCount) && state.objects.size !== serverCount;

/** Объекты списком, с фильтром по типу ('all' — все), новые сверху. */
export function listObjects(state, typeFilter = 'all') {
  const list = [...state.objects.values()].filter((o) => typeFilter === 'all' || o.type === typeFilter);
  return list.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.id.localeCompare(b.id));
}

/** Тело для validate/создания по черновику. */
export const placementBody = (d) => ({ type: d.type, x: snap(d.x), z: snap(d.z), ry: d.ry, scale: d.scale, params: d.params });

/** Ближайший объект к точке (для клика/подсказок) в пределах радиуса попадания. */
export function hitObject(objects, typeById, x, z, slack = 0.6) {
  let best = null;
  let bestD = Infinity;
  for (const o of objects) {
    const r = Math.max(objectRadius(typeById.get(o.type), o), 0.7) + slack;
    const d = Math.hypot(o.x - x, o.z - z);
    if (d <= r && d < bestD) {
      best = o;
      bestD = d;
    }
  }
  return best;
}

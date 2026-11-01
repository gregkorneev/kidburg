// Интерфейс редактора мира: выбор, размещение, перетаскивание, проверка и сохранение. Состояние карты живёт вне
// компонентов, чтобы переживать переключение вкладок.

import { api, errorText } from './lib/api.js';
import { createStore } from './lib/store.js';
import { createValidator } from './lib/validator.js';
import { applyWorldResponse, loadWorld, undoWorld, worldStore } from './state.js';
import { clampObjectScale, createView, defaultParams, inWorld, placementBody, snap } from './lib/world.js';

export const mapUi = createStore({
  view: createView(),
  size: { w: 800, h: 600 },
  viewReady: false,
  selectedId: null,
  placing: null, // { type, ry, scale, params, sticky }
  hover: null, // { x, z } — призрак при размещении
  cursor: null, // { x, z } — координаты под курсором
  drag: null, // { id, x, z }
  preview: null, // { id, x, z, ry, scale } — предпросмотр правок из формы
  check: null, // результат проверки: { key, status, code?, message? }
  message: null, // { tone, text, conflict? } — сообщения редактора
  busy: false,
});

const validator = createValidator({
  post: (body) => api.post('/world/validate', body),
  onChange: (check) => mapUi.set({ check }),
});

let lastRevision = worldStore.get().world.revision;
worldStore.subscribe((s) => {
  if (s.world.revision !== lastRevision) {
    lastRevision = s.world.revision;
    validator.invalidate(); // результаты проверки зависят от соседних объектов
  }
});

const say = (tone, text, extra = {}) => mapUi.set({ message: { tone, text, ...extra } });
export const clearMessage = () => mapUi.set({ message: null });

const typeOf = (id) => worldStore.get().typeById.get(id);
const objectById = (id) => worldStore.get().world.objects.get(id) ?? null;

// ── Выбор и режим размещения ─────────────────────────────────────────────────────────────────

export function select(id) {
  validator.cancel();
  mapUi.set({ selectedId: id, placing: null, hover: null, preview: null, drag: null, message: null });
}

export function startPlacing(type) {
  const def = typeOf(type);
  if (!def) return;
  validator.cancel();
  const prev = mapUi.get().placing;
  mapUi.set({
    selectedId: null,
    hover: null,
    preview: null,
    message: null,
    placing: { type, ry: 0, scale: clampObjectScale(def, 1), params: defaultParams(def), sticky: prev?.sticky ?? false },
  });
}

export function stopPlacing() {
  validator.cancel();
  mapUi.set({ placing: null, hover: null, check: null });
}

export function updatePlacing(patch) {
  const p = mapUi.get().placing;
  if (!p) return;
  mapUi.set({ placing: { ...p, ...patch } });
  const { hover } = mapUi.get();
  if (hover) checkPlacement(hover);
}

// ── Проверка размещения ──────────────────────────────────────────────────────────────────────

function bodyOf(spec, id) {
  const b = placementBody(spec);
  return id ? { ...b, id } : b;
}

/** Предварительная локальная проверка границ (экономит запрос), иначе — сервер. */
function checkBody(body) {
  if (!inWorld(body.x, body.z)) {
    mapUi.set({ check: { key: JSON.stringify(body), status: 'bad', code: 'out_of_bounds', message: 'За пределами мира' } });
    return;
  }
  validator.check(body);
}

export function checkPlacement(pt) {
  const p = mapUi.get().placing;
  if (!p) return;
  mapUi.set({ hover: pt });
  checkBody(bodyOf({ ...p, x: pt.x, z: pt.z }));
}

export function hoverLeave() {
  if (mapUi.get().placing) {
    validator.cancel();
    mapUi.set({ hover: null });
  }
}

export function dragTo(id, x, z) {
  const obj = objectById(id);
  if (!obj) return;
  mapUi.set({ drag: { id, x: snap(x), z: snap(z) } });
  checkBody(bodyOf({ ...obj, x: snap(x), z: snap(z) }, id));
}

export function setPreview(preview) {
  if (!preview) {
    if (mapUi.get().preview) {
      validator.cancel();
      mapUi.set({ preview: null });
    }
    return;
  }
  const obj = objectById(preview.id);
  if (!obj) return;
  mapUi.set({ preview });
  checkBody(bodyOf({ ...obj, ...preview }, preview.id));
}

// ── Изменения мира ───────────────────────────────────────────────────────────────────────────

async function guarded(fn) {
  if (mapUi.get().busy) return null;
  mapUi.set({ busy: true });
  try {
    return await fn();
  } finally {
    mapUi.set({ busy: false });
  }
}

function failMessage(err, id) {
  if (err.code === 'conflict') {
    say('bad', `${errorText(err)} Объект изменился: обновите данные.`, { conflict: id ?? true });
  } else say('bad', errorText(err));
}

export function placeAt(pt) {
  return guarded(async () => {
    const p = mapUi.get().placing;
    if (!p) return;
    const body = bodyOf({ ...p, x: pt.x, z: pt.z });
    if (!inWorld(body.x, body.z)) return say('bad', 'За пределами мира: поставьте объект внутри карты.');
    const check = await validator.now(body);
    if (check.status === 'bad') return say('bad', check.message ?? 'Здесь поставить нельзя');
    try {
      const res = await api.post('/world/objects', body);
      applyWorldResponse([{ op: 'upsert', object: res.object }], res.revision);
      validator.cancel();
      mapUi.set({ selectedId: res.object.id, ...(p.sticky ? { placing: p } : { placing: null, hover: null }), message: null });
      say('ok', `Объект «${typeOf(res.object.type)?.label ?? res.object.type}» добавлен.`);
    } catch (err) {
      failMessage(err);
    }
  });
}

/** Сохранение правок объекта: отправляются только изменённые поля, защита от конфликтов через rev. */
export function saveObject(id, next, baseRev) {
  return guarded(async () => {
    const cur = objectById(id);
    if (!cur) return say('bad', 'Объект уже удалён.');
    const patch = { rev: baseRev };
    for (const key of ['x', 'z', 'ry', 'scale']) if (next[key] !== cur[key]) patch[key] = next[key];
    if (JSON.stringify(next.params) !== JSON.stringify(cur.params)) patch.params = next.params;
    if (Object.keys(patch).length === 1) return say('info', 'Изменений нет.');
    try {
      const res = await api.patch(`/world/objects/${id}`, patch);
      applyWorldResponse([{ op: 'upsert', object: res.object }], res.revision);
      validator.cancel();
      mapUi.set({ preview: null, drag: null });
      say('ok', 'Изменения применены.');
      return res.object;
    } catch (err) {
      failMessage(err, id);
      return null;
    }
  });
}

/** Завершение перетаскивания: проверка и сохранение позиции (при отказе объект возвращается). */
export function finishDrag(id) {
  const drag = mapUi.get().drag;
  const obj = objectById(id);
  if (!drag || drag.id !== id || !obj) {
    mapUi.set({ drag: null });
    return null;
  }
  return guarded(async () => {
    if (!inWorld(drag.x, drag.z)) {
      mapUi.set({ drag: null });
      return say('bad', 'За пределами мира: объект возвращён на место.');
    }
    const check = await validator.now(bodyOf({ ...obj, x: drag.x, z: drag.z }, id));
    if (check.status === 'bad') {
      mapUi.set({ drag: null });
      return say('bad', `${check.message ?? 'Здесь поставить нельзя'}. Объект возвращён на место.`);
    }
    try {
      const res = await api.patch(`/world/objects/${id}`, { x: drag.x, z: drag.z, rev: obj.rev });
      applyWorldResponse([{ op: 'upsert', object: res.object }], res.revision);
      say('ok', 'Объект перемещён.');
    } catch (err) {
      failMessage(err, id);
    } finally {
      validator.cancel();
      mapUi.set({ drag: null });
    }
  });
}

export function cancelDrag() {
  validator.cancel();
  mapUi.set({ drag: null });
}

export function removeObject(id, rev) {
  return guarded(async () => {
    try {
      const res = await api.del(`/world/objects/${id}`, { query: { rev } });
      applyWorldResponse([{ op: 'remove', id, rev: res.revision }], res.revision);
      mapUi.set({ selectedId: null, preview: null });
      say('ok', 'Объект удалён.');
    } catch (err) {
      failMessage(err, id);
    }
  });
}

export function clearWorldObjects() {
  return guarded(async () => {
    try {
      const res = await api.post('/world/clear', { confirm: true });
      mapUi.set({ selectedId: null, preview: null });
      say('ok', `Удалено объектов: ${res.removed}. Это можно отменить кнопкой «Отменить последнее изменение».`);
      await loadWorld({ silent: true });
    } catch (err) {
      failMessage(err);
    }
  });
}

export function undoLast() {
  return guarded(async () => {
    try {
      await undoWorld();
      say('ok', 'Последнее изменение отменено.');
      setTimeout(() => void loadWorld({ silent: true }), 500); // подстраховка на случай пропущенного события
    } catch (err) {
      if (err.code === 'nothing_to_undo') say('info', errorText(err));
      else failMessage(err);
    }
  });
}

export async function refreshWorld() {
  clearMessage();
  await loadWorld({ silent: true });
}

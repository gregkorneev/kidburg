// Клиенты игры: фильтры, сортировка, накопление истории из tick. Без DOM.

import { isNum } from './format.js';

export const HISTORY_MAX = 180;

export const SORT_KEYS = ['name', 'status', 'fps', 'ping', 'loc', 'lastSeen'];

const STATUS_ORDER = { online: 0, inactive: 1, offline: 2 };

function sortValue(client, key) {
  switch (key) {
    case 'name':
      return (client.name ?? '').toLowerCase();
    case 'status':
      return STATUS_ORDER[client.status] ?? 3;
    case 'loc':
      return client.loc ?? '';
    default:
      return isNum(client[key]) ? client[key] : null;
  }
}

/** Фильтр по локации и состоянию ('all' — без фильтра). */
export function filterClients(clients, { loc = 'all', status = 'all' } = {}) {
  return clients.filter((c) => (loc === 'all' || c.loc === loc) && (status === 'all' || c.status === status));
}

/** Сортировка: значения null (нет данных) всегда внизу, независимо от направления. */
export function sortClients(clients, { key = 'name', dir = 'asc' } = {}) {
  const sign = dir === 'desc' ? -1 : 1;
  return [...clients].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === null && vb === null) return a.sid.localeCompare(b.sid);
    if (va === null) return 1;
    if (vb === null) return -1;
    if (va < vb) return -sign;
    if (va > vb) return sign;
    return a.sid.localeCompare(b.sid);
  });
}

/** Для игроков с несколькими вкладками возвращает суффикс по sid; у остальных его нет. */
export function tabSuffixes(clients) {
  const counts = new Map();
  for (const c of clients) counts.set(c.userId ?? c.name, (counts.get(c.userId ?? c.name) ?? 0) + 1);
  const out = new Map();
  for (const c of clients) if ((counts.get(c.userId ?? c.name) ?? 0) > 1) out.set(c.sid, c.sid.slice(-4));
  return out;
}

const withoutHistory = ({ history, ...rest }) => rest;

/**
 * Сохраняет ссылки на прежние объекты клиентов, если ничего не изменилось:
 * так мемоизированные строки таблицы не перерисовываются на каждый tick.
 */
export function reuseClients(prev, next) {
  const bySid = new Map(prev.map((c) => [c.sid, c]));
  return next.map((c) => {
    const old = bySid.get(c.sid);
    return old && JSON.stringify(withoutHistory(old)) === JSON.stringify(withoutHistory(c)) ? old : withoutHistory(c);
  });
}

/** История из snapshot/GET /clients: sid -> точки (не более HISTORY_MAX). */
export function seedHistories(clients) {
  const out = {};
  for (const c of clients) out[c.sid] = Array.isArray(c.history) ? c.history.slice(-HISTORY_MAX) : [];
  return out;
}

/**
 * Дописывает точку {t: lastSeen, fps, ping} только когда lastSeen изменился,
 * ограничивает длину и удаляет историю исчезнувших sid. Возвращает новый объект (прежние массивы не мутируются).
 */
export function mergeTick(histories, clients, max = HISTORY_MAX) {
  const out = {};
  for (const c of clients) {
    const prev = histories[c.sid] ?? [];
    const last = prev[prev.length - 1];
    if (isNum(c.lastSeen) && (!last || last.t !== c.lastSeen)) {
      const next = prev.length >= max ? prev.slice(prev.length - max + 1) : prev.slice();
      next.push({ t: c.lastSeen, fps: isNum(c.fps) ? c.fps : null, ping: isNum(c.ping) ? c.ping : null });
      out[c.sid] = next;
    } else out[c.sid] = prev;
  }
  return out;
}

/** Точка общей серии для мини-графиков обзора; null-значения сохраняются (разрыв линии). */
export function appendSeries(series, point, max = HISTORY_MAX) {
  const next = series.length >= max ? series.slice(series.length - max + 1) : series.slice();
  next.push(point);
  return next;
}

/** Оценка показателя по порогам: 'bad' — проблема, 'ok' — норма, null — нет данных. */
export function metricHealth(kind, value, thresholds) {
  if (!isNum(value) || !thresholds) return null;
  if (kind === 'fps') return value < thresholds.lowFps ? 'bad' : 'ok';
  if (kind === 'ping') return value > thresholds.highPingMs ? 'bad' : 'ok';
  return null;
}

/** Описание источника чанков для таблицы. */
export function chunksText(client) {
  const c = client.chunks;
  if (!c || !isNum(c.loaded)) return null;
  return isNum(c.max) ? `${c.loaded} / ${c.max}` : String(c.loaded);
}

// Чистые помощники форматирования: без DOM и сети.

export const LOC_LABELS = Object.freeze({
  city: 'Город',
  firefighter: 'Пожарная часть',
  florist: 'Цветочная лавка',
  bakery: 'Пекарня',
  other: 'Другое',
});
export const QUALITY_LABELS = Object.freeze({ low: 'Низкая', medium: 'Средняя', high: 'Высокая' });
export const STATUS_LABELS = Object.freeze({ online: 'Онлайн', inactive: 'Неактивна', offline: 'Отключён' });

export const locLabel = (loc) => LOC_LABELS[loc] ?? LOC_LABELS.other;
export const qualityLabel = (q) => QUALITY_LABELS[q] ?? null;
export const statusLabel = (s) => STATUS_LABELS[s] ?? '—';

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Число или «—», если данных нет (null/undefined/NaN никогда не превращаются в 0). */
export function fmtNum(value, digits = 0, empty = '—') {
  if (!isNum(value)) return empty;
  return value.toFixed(digits).replace('.', ',');
}

export function fmtMs(value, digits = 0) {
  return isNum(value) ? `${fmtNum(value, digits)} мс` : '—';
}

export function fmtBytes(bytes) {
  if (!isNum(bytes)) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} Б`;
  if (bytes < 1024 * 1024) return `${fmtNum(bytes / 1024, 1)} КБ`;
  return `${fmtNum(bytes / 1024 / 1024, 2)} МБ`;
}

/** Целое число с пробелами между разрядами. */
export function fmtInt(value) {
  if (!isNum(value)) return '—';
  return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** «3 с назад», «5 мин назад»; ts в мс. */
export function relativeTime(ts, now = Date.now()) {
  if (!isNum(ts) || ts <= 0) return '—';
  const sec = Math.max(0, Math.round((now - ts) / 1000));
  if (sec < 2) return 'только что';
  if (sec < 60) return `${sec} с назад`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч назад`;
  return `${Math.floor(hours / 24)} д назад`;
}

/** Время работы: «3 мин 12 с», «2 ч 05 мин», «1 д 4 ч». */
export function formatUptime(totalSec) {
  if (!isNum(totalSec) || totalSec < 0) return '—';
  const s = Math.floor(totalSec);
  if (s < 60) return `${s} с`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} мин ${String(s % 60).padStart(2, '0')} с`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч ${String(min % 60).padStart(2, '0')} мин`;
  return `${Math.floor(hours / 24)} д ${hours % 24} ч`;
}

const two = (n) => String(n).padStart(2, '0');

/** ЧЧ:ММ:СС в локальном времени. */
export function formatClock(ts) {
  if (!isNum(ts)) return '—';
  const d = new Date(ts);
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** ДД.ММ ЧЧ:ММ:СС. */
export function formatDateTime(ts) {
  if (!isNum(ts)) return '—';
  const d = new Date(ts);
  return `${two(d.getDate())}.${two(d.getMonth() + 1)} ${formatClock(ts)}`;
}

/** Короткий суффикс идентификатора вкладки. */
export const shortSid = (sid) => (typeof sid === 'string' ? sid.slice(-4) : '');

export const radToDeg = (rad) => {
  const deg = (rad * 180) / Math.PI;
  return Math.round((((deg % 360) + 360) % 360) * 10) / 10;
};
export const degToRad = (deg) => (((((Number(deg) % 360) + 360) % 360) * Math.PI) / 180);

/** Русское склонение: plural(5, ['объект','объекта','объектов']). */
export function plural(n, forms) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

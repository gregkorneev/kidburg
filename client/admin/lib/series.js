// Построение путей для мини-графиков (inline SVG). Без DOM.

import { isNum } from './format.js';

/** «Красивый» верхний предел оси. */
export function niceMax(value) {
  if (!isNum(value) || value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const f = value / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * exp;
}

/**
 * Путь линии по ключу: точки с null разрывают линию.
 * @returns {{d: string, last: {x: number, y: number}|null, count: number, max: number}}
 */
export function linePath(points, key, { width, height, min = 0, max, t0, t1 }) {
  const values = points.map((p) => p[key]).filter(isNum);
  const top = isNum(max) ? max : niceMax(Math.max(...values, 0));
  const lo = min;
  const span = top - lo || 1;
  const start = isNum(t0) ? t0 : points[0]?.t ?? 0;
  const end = isNum(t1) ? t1 : points[points.length - 1]?.t ?? start + 1;
  const tSpan = end - start || 1;
  let d = '';
  let pen = false;
  let last = null;
  let count = 0;
  const round = (v) => Math.round(v * 10) / 10;
  for (const p of points) {
    const v = p[key];
    if (!isNum(v)) {
      pen = false;
      continue;
    }
    const x = round(((p.t - start) / tSpan) * width);
    const y = round(height - ((Math.min(Math.max(v, lo), top) - lo) / span) * height);
    d += `${pen ? 'L' : 'M'}${x} ${y}`;
    pen = true;
    last = { x, y };
    count++;
  }
  return { d, last, count, max: top };
}

/** Вертикальная позиция значения на шкале 0..max. */
export function yOf(value, { height, min = 0, max }) {
  const span = max - min || 1;
  return Math.round((height - ((Math.min(Math.max(value, min), max) - min) / span) * height) * 10) / 10;
}

/** Подпись оси времени: «−2 мин», «−30 с», «сейчас». */
export function ageLabel(ms) {
  const sec = Math.round(ms / 1000);
  if (sec <= 1) return 'сейчас';
  if (sec < 90) return `−${sec} с`;
  return `−${Math.round(sec / 60)} мин`;
}

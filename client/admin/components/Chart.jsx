// Мини-графики на inline SVG: без внешних библиотек.

import { useMemo, useState } from 'preact/hooks';
import { linePath, niceMax, yOf, ageLabel } from '../lib/series.js';
import { fmtNum, formatClock, isNum } from '../lib/format.js';

const PAD = { l: 34, r: 8, t: 8, b: 20 };

/**
 * @param {{points: Array<{t:number}>, lines: Array<{key:string,color:string,label:string,unit:string,digits?:number}>,
 *   thresholds?: Array<{value:number,color:string,label:string}>, max?: number, height?: number, axis?: 'clock'|'age', empty?: string}} props
 */
export function LineChart({ points, lines, thresholds = [], max, height = 150, axis = 'clock', empty = 'Нет данных для графика' }) {
  const W = 520;
  const innerW = W - PAD.l - PAD.r;
  const innerH = height - PAD.t - PAD.b;
  const [hover, setHover] = useState(null);

  const model = useMemo(() => {
    if (!points.length) return null;
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    const all = lines.flatMap((l) => points.map((p) => p[l.key]).filter(isNum));
    const top = isNum(max) ? max : niceMax(Math.max(...all, ...thresholds.map((t) => t.value), 0));
    const paths = lines.map((l) => ({ ...l, ...linePath(points, l.key, { width: innerW, height: innerH, max: top, t0, t1 }) }));
    return { t0, t1, top, paths, hasAny: paths.some((p) => p.count > 0) };
  }, [points, lines, thresholds, max, innerW, innerH]);

  if (!model || !model.hasAny) return <div class="chart chart--empty" style={{ minHeight: `${height}px` }}>{empty}</div>;

  const span = model.t1 - model.t0 || 1;
  const idxAt = (clientX, rect) => {
    const x = ((clientX - rect.left) / rect.width) * W - PAD.l;
    const t = model.t0 + (x / innerW) * span;
    let best = 0;
    let bd = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(p.t - t);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };
  const hp = hover !== null ? points[hover] : null;
  const hx = hp ? PAD.l + ((hp.t - model.t0) / span) * innerW : 0;
  const left = axis === 'age' ? ageLabel(span) : formatClock(model.t0);
  const right = axis === 'age' ? 'сейчас' : formatClock(model.t1);

  return (
    <div class="chart">
      <div class="chart__legend" aria-live="off">
        {lines.map((l) => (
          <span key={l.key} class="chart__key">
            <i style={{ background: l.color }} />
            {l.label}
            <b>{hp ? (isNum(hp[l.key]) ? `${fmtNum(hp[l.key], l.digits ?? 0)} ${l.unit}` : 'нет данных') : ''}</b>
          </span>
        ))}
        {hp ? <span class="chart__time">{formatClock(hp.t)}</span> : null}
      </div>
      <svg viewBox={`0 0 ${W} ${height}`} class="chart__svg" role="img" aria-label={lines.map((l) => l.label).join(', ')}
        onPointerMove={(e) => setHover(idxAt(e.clientX, e.currentTarget.getBoundingClientRect()))} onPointerLeave={() => setHover(null)}>
        <g transform={`translate(${PAD.l} ${PAD.t})`}>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1="0" x2={innerW} y1={innerH * f} y2={innerH * f} class="chart__grid" />
              <text x="-6" y={innerH * f + 3.5} text-anchor="end" class="chart__tick">{fmtNum(model.top * (1 - f), model.top < 5 ? 1 : 0)}</text>
            </g>
          ))}
          {thresholds.map((t) => {
            const y = yOf(t.value, { height: innerH, max: model.top });
            return (
              <g key={t.label}>
                <line x1="0" x2={innerW} y1={y} y2={y} stroke={t.color} stroke-dasharray="5 4" class="chart__threshold" />
                <text x={innerW - 2} y={y - 3} text-anchor="end" fill={t.color} class="chart__tick">{t.label}</text>
              </g>
            );
          })}
          {model.paths.map((p) => (
            <g key={p.key}>
              <path d={p.d} fill="none" stroke={p.color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
              {p.count === 1 && p.last ? <circle cx={p.last.x} cy={p.last.y} r="3" fill={p.color} /> : null}
            </g>
          ))}
          {hp ? <line x1={hx - PAD.l} x2={hx - PAD.l} y1="0" y2={innerH} class="chart__cursor" /> : null}
          <text x="0" y={innerH + 15} class="chart__tick">{left}</text>
          <text x={innerW} y={innerH + 15} text-anchor="end" class="chart__tick">{right}</text>
        </g>
      </svg>
    </div>
  );
}

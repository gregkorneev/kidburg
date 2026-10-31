// План центральной площади: где стоят фонтан, газоны, клумбы, скамьи, фонари, деревья и указатели (плоские метры
// от центра площади; +X — восток, +Z — юг). Чистые данные без three.js: по ним строятся статичная геометрия
// (city-plaza.js) и живые элементы (city-decor.js), а тест проверяет, что декор не перекрывает маршруты к дверям,
// здания и друг друга.
// Композиция: фонтан-кольцо вокруг точки появления игроков, шесть мощёных маршрутов к фасадам зданий и
// между ними — шесть газонов с клумбами; по внешнему кольцу — скамьи, фонари и входные ворота маршрутов.
import { BUILDINGS, PLAZA } from '../../tools/build-world/layout.js';

export const PLAZA_RADIUS = 21.2;
export const ROUTE_HALF_WIDTH = 2.0;
export const OUTER_RING = Object.freeze([17.4, 20.4]); // мощёная полоса у бордюра

/** Фонтан: центральная площадка (точка появления игроков), канал с водой и высокий бортик. */
export const FOUNTAIN = Object.freeze({
  dais: 2.3, // радиус площадки
  daisStep: 2.58, // внешний радиус ступени
  channel: Object.freeze([2.58, 4.1]), // кольцо воды
  wall: Object.freeze([4.1, 5.0]),
  wallHeight: 0.64,
  waterY: 0.38,
  pylonRadius: 4.55,
});

/** Газон каждого сектора: кольцо r∈[rIn, rOut] без полос шириной inset от осей маршрутов. */
export const LAWN = Object.freeze({ rIn: 8.0, rOut: 17.4, inset: 2.35 });

const TWO_PI = Math.PI * 2;
const norm = (a) => ((a % TWO_PI) + TWO_PI) % TWO_PI;
const polar = (angle, r) => ({ x: Math.cos(angle) * r, z: Math.sin(angle) * r });
const facing = (x, z) => Math.atan2(-x, -z); // rotY, при котором локальный +Z предмета смотрит на центр
const lateral = (angle, r) => Math.asin(Math.min(1, angle / r)); // угол по боковому смещению

export const ROUTE_COLORS = Object.freeze({ city_hall: 0xe3b95c, fire_station: 0xd9482f, bakery: 0xf28b35, flower_shop: 0xe99ab5, music_school: 0x5f9fb0, radio_station: 0x3f8a68 });

/** Маршруты от фонтана к центру фасада каждого здания (по возрастанию угла). */
export const ROUTES = Object.freeze(BUILDINGS.map((b) => {
  const front = { x: b.x + Math.sin(b.rotationY) * (b.depth / 2) - PLAZA.x, z: b.z + Math.cos(b.rotationY) * (b.depth / 2) - PLAZA.z };
  return Object.freeze({ id: b.id, name: b.name, color: ROUTE_COLORS[b.id], front: Object.freeze(front), length: Math.hypot(front.x, front.z), angle: norm(Math.atan2(front.z, front.x)) });
}).sort((a, b) => a.angle - b.angle));

/** Секторы между соседними маршрутами: a0 → a1 (по возрастанию угла, с переходом через 2π). */
export const SECTORS = Object.freeze(ROUTES.map((route, i) => {
  const next = ROUTES[(i + 1) % ROUTES.length];
  const a0 = route.angle;
  const a1 = next.angle + (i === ROUTES.length - 1 ? TWO_PI : 0);
  return Object.freeze({ index: i, a0, a1, mid: (a0 + a1) / 2, span: a1 - a0, wide: a1 - a0 > 1.2 });
}));

/** Угловой диапазон сектора на радиусе r с боковым отступом от осей маршрутов. */
export function sectorRange(sector, r, margin) {
  const m = lateral(margin, r);
  return [sector.a0 + m, sector.a1 - m];
}

/** Контур газона сектора (против часовой стрелки по углу): дуги и прямые вдоль маршрутов. */
export function lawnOutline(sector, { rIn = LAWN.rIn, rOut = LAWN.rOut, inset = LAWN.inset, step = 0.07 } = {}) {
  const [i0, i1] = sectorRange(sector, rIn, inset);
  const [o0, o1] = sectorRange(sector, rOut, inset);
  const points = [];
  const arc = (r, from, to) => {
    const n = Math.max(2, Math.ceil(Math.abs(to - from) / step));
    for (let i = 0; i <= n; i++) points.push(polar(from + ((to - from) * i) / n, r));
  };
  arc(rIn, i0, i1);
  arc(rOut, o1, o0);
  return points.map((p) => [p.x, p.z]);
}

/** Лежит ли точка на газоне какого-либо сектора (с запасом pad внутрь). */
export function onLawn(x, z, pad = 0) {
  const r = Math.hypot(x, z);
  if (r < LAWN.rIn + pad || r > LAWN.rOut - pad) return false;
  const a = norm(Math.atan2(z, x));
  for (const s of SECTORS) {
    const t = s.a1 > TWO_PI && a < s.a0 ? a + TWO_PI : a;
    if (t <= s.a0 || t >= s.a1) continue;
    if (r * Math.sin(t - s.a0) > LAWN.inset + pad && r * Math.sin(s.a1 - t) > LAWN.inset + pad) return true;
  }
  return false;
}

function distanceToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** Расстояние от точки до ближайшей оси маршрута (от бортика фонтана до фасада). */
export function distanceToRoutes(x, z) {
  let best = Infinity;
  for (const route of ROUTES) {
    const a = polar(route.angle, FOUNTAIN.wall[1] + 0.3);
    best = Math.min(best, distanceToSegment(x, z, a.x, a.z, route.front.x, route.front.z));
  }
  return best;
}

/** Здания как ориентированные прямоугольники в координатах площади. */
export const BUILDING_BOXES = Object.freeze(BUILDINGS.map((b) => Object.freeze({
  id: b.id, cx: b.x - PLAZA.x, cz: b.z - PLAZA.z, hw: b.width / 2, hd: b.depth / 2, rotationY: b.rotationY,
})));

/** Расстояние от точки до здания по плану (отрицательное — внутри). */
export function distanceToBuildings(x, z) {
  let best = Infinity;
  for (const b of BUILDING_BOXES) {
    const dx = x - b.cx;
    const dz = z - b.cz;
    const c = Math.cos(b.rotationY);
    const s = Math.sin(b.rotationY);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    const ox = Math.abs(lx) - b.hw;
    const oz = Math.abs(lz) - b.hd;
    best = Math.min(best, Math.hypot(Math.max(ox, 0), Math.max(oz, 0)) + Math.min(Math.max(ox, oz), 0));
  }
  return best;
}

/** Свободен ли круг радиуса radius от маршрутов и зданий. */
export const isClear = (x, z, radius, { routes = true, buildings = true } = {}) =>
  (!routes || distanceToRoutes(x, z) >= ROUTE_HALF_WIDTH + radius) && (!buildings || distanceToBuildings(x, z) >= radius + 0.5);

/** Точка на дуге радиуса r: angle — центр, offset — смещение вдоль дуги в метрах. */
const onArc = (angle, r, offset) => polar(angle + offset / r, r);

// ── Фонтан ─────────────────────────────────────────────────────────────────

/** Шесть пилонов на бортике — по одному в каждом секторе, цвет — цвет соседнего маршрута. */
export const PYLONS = Object.freeze(SECTORS.map((s) => Object.freeze({ angle: s.mid, ...polar(s.mid, FOUNTAIN.pylonRadius), height: 2.35, color: ROUTES[s.index].color })));
/** Двенадцать низких форсунок на краю центральной площадки: по две в каждом секторе. */
export const SPOUTS = Object.freeze(SECTORS.flatMap((s) => [-0.15, 0.15].map((d) => Object.freeze({ angle: s.mid + d, ...polar(s.mid + d, FOUNTAIN.daisStep - 0.12), color: ROUTES[s.index].color }))));

/** Каменные «броды»: переход через канал воды на каждом маршруте (ширина brodWidth). */
export const FORD_WIDTH = 2.0;

// ── Газоны и клумбы ────────────────────────────────────────────────────────

export const ROUND_BEDS = Object.freeze(SECTORS.flatMap((s) => (s.wide
  ? [-0.3, 0.3].map((d) => Object.freeze({ ...polar(s.mid + d, 12.0), radius: 1.3, sector: s.index }))
  : [Object.freeze({ ...polar(s.mid, 12.6), radius: 1.3, sector: s.index })])));

export const PLANTER_BEDS = Object.freeze(SECTORS.flatMap((s) => {
  const r = 15.4;
  const length = 3.0;
  const [lo, hi] = sectorRange(s, r, LAWN.inset + length / 2 + 0.2);
  const arc = (hi - lo) * r;
  const n = Math.max(1, Math.floor(arc / (length + 0.6)) + 1);
  return Array.from({ length: n }, (_, i) => {
    const a = n === 1 ? s.mid : lo + ((hi - lo) * i) / (n - 1);
    return Object.freeze({ ...polar(a, r), rotY: -(a + Math.PI / 2), length, depth: 0.9, sector: s.index });
  });
}));

export const ROCKS = Object.freeze(SECTORS.filter((s) => s.wide).flatMap((s) => [-0.36, 0.36].map((d, i) => Object.freeze({ ...polar(s.mid + d, 9.7), s: 1.1 + i * 0.35, tone: s.index + i }))));

// ── Мебель внешнего кольца ─────────────────────────────────────────────────

const BENCH_R = 18.7;
const BENCH_SPACING = 3.6;

export const BENCHES = Object.freeze(SECTORS.flatMap((s) => {
  const n = s.wide ? 3 : 2;
  return Array.from({ length: n }, (_, i) => {
    const p = onArc(s.mid, BENCH_R, (i - (n - 1) / 2) * BENCH_SPACING);
    return Object.freeze({ ...p, rotY: facing(p.x, p.z), sector: s.index });
  });
}));

export const BINS = Object.freeze(SECTORS.map((s) => {
  const n = s.wide ? 3 : 2;
  const p = onArc(s.mid, BENCH_R + 0.1, -(((n - 1) / 2) * BENCH_SPACING + 1.8));
  return Object.freeze({ ...p, rotY: facing(p.x, p.z) });
}));

/** Фонари: по паре у каждого входа маршрута (ворота) и по одному на внутреннем кольце между маршрутами. */
export const LAMPS = Object.freeze([
  ...ROUTES.flatMap((route) => [-1, 1].map((side) => Object.freeze({ ...polar(route.angle + side * lateral(2.9, 20.2), 20.2), gate: route.id }))),
  ...SECTORS.map((s) => Object.freeze({ ...polar(s.mid, 7.0), gate: null })),
]);

/** Указатели у входов в маршруты: стрелка смотрит вдоль маршрута, цвет — цвет здания. */
export const SIGNPOSTS = Object.freeze(ROUTES.map((route) => {
  const p = polar(route.angle - lateral(3.3, 18.9), 18.9);
  const dx = route.front.x - p.x;
  const dz = route.front.z - p.z;
  return Object.freeze({ ...p, id: route.id, arrows: Object.freeze([{ angle: Math.atan2(-dz, dx), color: route.color, y: 2.35 }]) });
}));

export const INFO_STANDS = Object.freeze([(() => {
  const hall = ROUTES.find((r) => r.id === 'city_hall');
  const p = polar(hall.angle - lateral(5.6, 18.9), 18.9);
  return Object.freeze({ ...p, rotY: facing(p.x, p.z) });
})()]);

// ── Детерминированный генератор для раскладки растений ─────────────────────

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Деревья вокруг площади: кольцо r 24…30, между маршрутами и вне зданий. */
export const TREES = Object.freeze((() => {
  const random = lcg(1187);
  const placed = [];
  for (const radius of [24.2, 27.4, 30.6]) {
    for (let a = 0; a < TWO_PI; a += 3.6 / radius) {
      const angle = a + (radius - 24) * 0.05;
      const { x, z } = polar(angle, radius);
      if (!isClear(x, z, 2.6)) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 5.6)) continue;
      if (random() < 0.28) continue;
      const roll = random();
      placed.push(Object.freeze({ x, z, type: roll < 0.45 ? 'round' : roll < 0.75 ? 'birch' : 'pine', s: 0.95 + random() * 0.4, ry: random() * TWO_PI }));
    }
  }
  return placed;
})());

/** Кусты по краю площади: пары у «ворот» маршрутов и россыпь между ними. */
export const BUSHES = Object.freeze((() => {
  const random = lcg(53);
  const list = [];
  const add = (x, z, s) => {
    if (isClear(x, z, 0.9 * s) && !TREES.some((t) => Math.hypot(t.x - x, t.z - z) < 2.4)) list.push(Object.freeze({ x, z, s }));
  };
  for (const route of ROUTES) for (const side of [-1, 1]) {
    const a = route.angle + side * lateral(4.1, 22.6);
    const p = polar(a, 22.6);
    add(p.x, p.z, 1.15);
    const q = polar(a + side * 0.07, 22.9);
    add(q.x, q.z, 0.85);
  }
  for (const s of SECTORS) for (let i = 0; i < 3; i++) {
    const p = onArc(s.mid, 22.6, (i - 1) * (s.wide ? 5 : 3.2) + (random() - 0.5));
    add(p.x, p.z, 0.9 + random() * 0.4);
  }
  return list;
})());

/** Цветы и кустики на клумбах: kind — 'bush' | 'flower'; color — индекс цвета цветка. */
export const PLANTS = Object.freeze((() => {
  const random = lcg(2026);
  const plants = [];
  for (const bed of ROUND_BEDS) {
    plants.push({ kind: 'bush', x: bed.x, z: bed.z, y: 0.4, s: 1.0 });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TWO_PI + random() * 0.4;
      const r = bed.radius * (i % 2 ? 0.85 : 0.55) * (0.9 + random() * 0.2);
      plants.push({ kind: 'flower', x: bed.x + Math.cos(a) * r, z: bed.z + Math.sin(a) * r, y: 0.4, s: 0.85 + random() * 0.35, color: Math.floor(random() * 5) });
    }
  }
  for (const bed of PLANTER_BEDS) {
    const c = Math.cos(bed.rotY);
    const sn = Math.sin(bed.rotY);
    const n = 9;
    for (let i = 0; i < n; i++) {
      const lx = -bed.length / 2 + 0.3 + (i * (bed.length - 0.6)) / (n - 1);
      const lz = ((i % 2) - 0.5) * bed.depth * 0.45;
      const x = bed.x + lx * c + lz * sn;
      const z = bed.z - lx * sn + lz * c;
      if (i % 4 === 2) plants.push({ kind: 'bush', x, z, y: 0.58, s: 0.5 });
      else plants.push({ kind: 'flower', x, z, y: 0.58, s: 0.9 + random() * 0.3, color: Math.floor(random() * 5) });
    }
  }
  for (const stand of INFO_STANDS) for (let i = 0; i < 6; i++) {
    const c = Math.cos(stand.rotY);
    const sn = Math.sin(stand.rotY);
    const lx = (i - 2.5) * 0.34;
    plants.push({ kind: 'flower', x: stand.x + lx * c + sn * 0.7, z: stand.z - lx * sn + c * 0.7, y: 0, s: 0.95, color: i % 5 });
  }
  return plants;
})());

/** Круги занятых мест для проверки пересечений: [x, z, радиус, имя]. */
export function occupiedCircles() {
  return [
    ...ROUND_BEDS.map((b) => [b.x, b.z, b.radius + 0.1, 'bed']),
    ...PLANTER_BEDS.flatMap((b) => [[b.x, b.z, 0.9, 'planter']]),
    ...BENCHES.map((b) => [b.x, b.z, 0.9, 'bench']),
    ...BINS.map((b) => [b.x, b.z, 0.4, 'bin']),
    ...LAMPS.map((b) => [b.x, b.z, 0.4, 'lamp']),
    ...SIGNPOSTS.map((b) => [b.x, b.z, 0.8, 'signpost']),
    ...INFO_STANDS.map((b) => [b.x, b.z, 1.1, 'info']),
    ...ROCKS.map((b) => [b.x, b.z, 0.6 * b.s, 'rock']),
  ];
}

// Центральная площадь «Города профессий»: статичная вершинно-окрашенная геометрия для одного InstancedMesh.
// Композиция (план — plaza-plan.js): фонтан-кольцо вокруг точки появления игроков с каменными бродами по
// шести маршрутам, мозаика из брусчатки с цветными полосами и шевронами, шесть газонов с клумбами и валунами,
// скамьи, урны, фонари «воротами» у входов в маршруты, указатели и информационный стенд.
// Живые элементы (вода, струи, раскачивающиеся цветы и деревья, подъездные дорожки, вывески) — в city-decor.js.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createPrefabKit } from './art/prefab-kit.js';
import { bin, infoStand, lampPost, picketFence, rock, signpost } from './art/flora.js';
import {
  BENCHES, BINS, FORD_WIDTH, FOUNTAIN, INFO_STANDS, LAMPS, LAWN, OUTER_RING, PLANTER_BEDS, PLAZA_RADIUS, PYLONS, ROCKS, ROUND_BEDS,
  ROUTES, ROUTE_HALF_WIDTH, SECTORS, SIGNPOSTS, SPOUTS, lawnOutline, onLawn,
} from './plaza-plan.js';

const C = {
  grout: 0xc6b794, curb: 0xf3ead4, curbDark: 0xd8cbac, stone: 0xece3cc, stoneDark: 0xc4b79a, soil: 0x86613f,
  lawn: [0x8fc06a, 0x84b863], lawnEdge: 0x77ad5e, brass: 0xe6b95a, white: 0xfff7e6,
  floor: [0x86c4c6, 0x74b6bf, 0x92cdc9], dais: [0xf5ead0, 0xefe0bf], star: [0xe08a5c, 0xd9704a], starCore: 0xf2c363, ring: [0xb6c4c8, 0xa7b7bd, 0xc1ced0],
  lane: [0xf6e4b7, 0xf0dcaa, 0xfbeccb], laneEdge: 0xd6b985, sand: [0xf1e1b8, 0xeadaae, 0xf5e8c6], outer: [0xf2e3bf, 0xeadbb0], outerAccent: 0xd9ac7c,
};
const TWO_PI = Math.PI * 2;
const TILE_Y = 0.1;
const BASE_Y = 0.088;

const hash2 = (i, j) => {
  let h = Math.imul(i + 374761393, 668265263) ^ Math.imul(j + 1442695041, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Накопитель плоских плиток: верхняя грань на высоте y, без боковых стенок (шов — тёмная подложка). */
export function createTileBuffer() {
  const positions = [];
  const colors = [];
  const color = new THREE.Color();
  const tri = (a, b, c, y, rgb) => {
    // Нормаль всегда вверх: порядок вершин подбирается по знаку векторного произведения.
    const cross = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    const [p, q] = cross >= 0 ? [b, c] : [c, b];
    for (const v of [a, p, q]) {
      positions.push(v[0], y, v[1]);
      colors.push(rgb.r, rgb.g, rgb.b);
    }
  };
  return {
    quad(p0, p1, p2, p3, y, hex, shade = 1) {
      color.set(hex);
      const rgb = { r: color.r * shade, g: color.g * shade, b: color.b * shade };
      tri(p0, p1, p2, y, rgb);
      tri(p0, p2, p3, y, rgb);
    },
    get count() { return positions.length / 3; },
    build() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const normals = new Float32Array(positions.length);
      for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
      g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      return g;
    },
  };
}

/** Поперечное расстояние до оси ближайшего маршрута (бесконечность, если точка «за спиной» всех осей). */
function routeLateral(x, z) {
  let best = Infinity;
  for (const route of ROUTES) {
    const ux = Math.cos(route.angle);
    const uz = Math.sin(route.angle);
    if (x * ux + z * uz <= 0) continue;
    best = Math.min(best, Math.abs(x * uz - z * ux));
  }
  return best;
}

const pointAt = (angle, r) => [Math.cos(angle) * r, Math.sin(angle) * r];

/** Кольцо плиток от r0 до r1: arc — желаемая длина дуги плитки, pick(...) возвращает цвет или null (пропуск). */
function ringTiles(tiles, r0, r1, arc, pick, { gap = 0.05, ring = 0, jitter = 0.004 } = {}) {
  const rm = (r0 + r1) / 2;
  const n = Math.max(6, Math.round((TWO_PI * rm) / arc));
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TWO_PI;
    const a1 = ((i + 1) / n) * TWO_PI;
    const am = (a0 + a1) / 2;
    const [cx, cz] = pointAt(am, rm);
    const hex = pick({ x: cx, z: cz, r: rm, a: am, i, ring });
    if (hex === null || hex === undefined) continue;
    const da0 = (gap / 2) / rm;
    const ra = r0 + gap / 2;
    const rb = r1 - gap / 2;
    const y = TILE_Y + (hash2(i, ring) - 0.5) * 2 * jitter;
    tiles.quad(pointAt(a0 + da0, ra), pointAt(a1 - da0, ra), pointAt(a1 - da0, rb), pointAt(a0 + da0, rb), y, hex, 0.97 + hash2(ring, i) * 0.06);
  }
}

/** Звезда-компас на центральной площадке: радиус по углу. */
const starRadius = (angle) => 0.8 + 1.5 * Math.pow(Math.abs(Math.cos(angle * 4)), 4);

function buildPaving(tiles) {
  const dais = FOUNTAIN.daisStep;
  // Центральная площадка: тонкая мозаика со звездой-компасом.
  for (let ring = 0, r = 0; r < dais - 1e-6; ring++) {
    const next = Math.min(dais, r + 0.43);
    ringTiles(tiles, r, next, 0.43, ({ r: rm, a, i }) => {
      if (rm > FOUNTAIN.dais) return C.ring[(i + ring) % 3];
      if (rm < 0.5) return C.starCore;
      if (rm < starRadius(a)) return C.star[(i >> 1) % 2];
      return C.dais[(i + ring) % 2];
    }, { gap: 0.04, ring: 100 + ring });
    r = next;
  }
  // Дно канала: прохладные бирюзовые плитки.
  for (let ring = 0, r = FOUNTAIN.channel[0]; r < FOUNTAIN.channel[1] - 1e-6; ring++) {
    const next = Math.min(FOUNTAIN.channel[1], r + 0.51);
    ringTiles(tiles, r, next, 0.55, ({ i }) => C.floor[(i * 7 + ring) % 3], { gap: 0.04, ring: 200 + ring });
    r = next;
  }
  // Остальная мозаика: от бортика фонтана до внешнего кольца.
  const inner = FOUNTAIN.wall[0];
  const outer = PLAZA_RADIUS - 0.55;
  for (let ring = 0, r = inner; r < outer - 1e-6; ring++) {
    const next = Math.min(outer, r + (ring === 0 ? 0.95 : 0.82));
    ringTiles(tiles, r, next, 0.88, ({ x, z, r: rm, i }) => {
      const lat = routeLateral(x, z);
      if (rm < FOUNTAIN.wall[1] + 0.05 && lat > FORD_WIDTH / 2 + 0.15) return null; // под бортиком плитка не нужна
      if (onLawn(x, z, -0.3)) return null;
      if (rm < 7.4) return lat < ROUTE_HALF_WIDTH ? C.lane[(i + ring) % 3] : C.ring[(i + ring) % 3];
      if (lat < ROUTE_HALF_WIDTH) return lat > ROUTE_HALF_WIDTH - 0.45 ? C.laneEdge : C.lane[(i * 3 + ring) % 3];
      if (rm > OUTER_RING[0]) return i % 9 === 4 ? C.outerAccent : C.outer[(i + ring) % 2];
      return C.sand[(i + ring) % 3];
    }, { ring: 300 + ring });
    r = next;
  }
}

/** Низкий бордюр по контуру многоугольника (замкнутый). */
function curbAlong(kit, points, { height = 0.3, width = 0.3, color = C.curb } = {}) {
  for (let i = 0; i < points.length; i++) {
    const [ax, az] = points[i];
    const [bx, bz] = points[(i + 1) % points.length];
    const length = Math.hypot(bx - ax, bz - az);
    if (length < 1e-3) continue;
    kit.box(length + width * 0.7, height, width, (ax + bx) / 2, height / 2, (az + bz) / 2, color, { ry: Math.atan2(-(bz - az), bx - ax), r: 0 });
  }
}

function buildLawns(kit) {
  const bands = 5;
  for (const sector of SECTORS) {
    for (let b = 0; b < bands; b++) {
      const r0 = LAWN.rIn + ((LAWN.rOut - LAWN.rIn) * b) / bands;
      const r1 = LAWN.rIn + ((LAWN.rOut - LAWN.rIn) * (b + 1)) / bands;
      kit.flatShape(lawnOutline(sector, { rIn: r0, rOut: r1, step: 0.09 }), 0.08, 0.12, C.lawn[b % 2], { tinted: true });
    }
    const outline = lawnOutline(sector, { step: 0.1 });
    curbAlong(kit, outline);
    // Тонкая светлая кромка поверх бордюра.
    curbAlong(kit, outline, { height: 0.06, width: 0.34, color: C.white });
  }
}

function buildOuterCurb(kit) {
  const radius = PLAZA_RADIUS + 0.25;
  const n = Math.round((TWO_PI * radius) / 0.98);
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * TWO_PI;
    const [x, z] = pointAt(a, radius);
    if (routeLateral(x, z) < ROUTE_HALF_WIDTH + 0.25) continue; // проём «ворот» маршрута
    kit.box(0.55, 0.3, (TWO_PI * radius) / n - 0.04, x, 0.15, z, i % 2 ? C.curb : C.curbDark, { ry: -a, r: 0 });
  }
}

/** Фонтан: основание, бортик с разрывами у бродов, пилоны профессий, форсунки и камни-ступени. */
function buildFountain(kit) {
  const { wall, channel, daisStep } = FOUNTAIN;
  // Подложка: тёмный круг под всей площадью плюс каменное кольцо дна фонтана.
  kit.cyl(PLAZA_RADIUS, PLAZA_RADIUS, BASE_Y, 96, 0, BASE_Y / 2, 0, C.grout, { tinted: false });
  kit.torus(daisStep + 0.02, 0.08, 0, 0.12, 0, C.stone, { radial: 6, tubular: 48 });

  // Форсунки по краю площадки.
  for (const s of SPOUTS) {
    kit.cyl(0.13, 0.15, 0.08, 10, s.x, 0.13, s.z, C.stoneDark);
    kit.cyl(0.06, 0.08, 0.14, 8, s.x, 0.2, s.z, C.brass, { tinted: false });
  }

  const ang = (x, z) => Math.atan2(z, x);
  const wallEdge = (lateralMeters) => Math.asin(lateralMeters / FOUNTAIN.pylonRadius);
  const profile = [[wall[1], 0], [wall[1], 0.5], [wall[1] - 0.07, 0.62], [wall[1] - 0.2, 0.68], [wall[0] + 0.2, 0.68], [wall[0] + 0.07, 0.62], [wall[0], 0.5], [wall[0], 0]];
  for (const s of SECTORS) {
    const from = s.a0 + wallEdge(FORD_WIDTH / 2 + 0.05);
    const to = s.a1 - wallEdge(FORD_WIDTH / 2 + 0.05);
    if (to - from > 0.12) {
      // phi в LatheGeometry отсчитывается от +Z к +X, у нас угол — от +X к +Z.
      kit.lathe(profile, Math.max(4, Math.round((to - from) / 0.1)), 0, 0, 0, C.stone, { phiStart: Math.PI / 2 - to, phiLength: to - from });
      // Светлые накладные камни на гребне бортика.
      const stones = Math.max(2, Math.round(((to - from) * 4.55) / 0.8));
      for (let i = 0; i < stones; i++) {
        const a = from + ((i + 0.5) / stones) * (to - from);
        const [x, z] = pointAt(a, 4.55);
        kit.box(0.74 * ((to - from) * 4.55) / stones / 0.8 - 0.02, 0.1, 0.78, x, 0.7, z, i % 2 ? C.curb : C.stone, { ry: -a, r: 0.02 });
      }
    }
    // Столбики по краям бортика (края обрываются у брода).
    for (const edge of [from, to]) {
      const [x, z] = pointAt(edge + (edge === from ? -0.03 : 0.03), 4.55);
      kit.cyl(0.46, 0.5, 0.74, 14, x, 0.37, z, C.stone);
      kit.sphere(0.32, x, 0.8, z, C.curb, { w: 10, h: 7, s: [1, 0.8, 1] });
    }
  }

  // Камни-ступени бродов: три плоских камня поперёк канала.
  for (const route of ROUTES) {
    for (let i = 0; i < 3; i++) {
      const r = channel[0] + 0.24 + i * 0.5;
      const rb = channel[1] + 0.05 - (2 - i) * 0.0;
      const [x, z] = pointAt(route.angle, Math.min(r + i * 0.04, rb));
      kit.box(0.44, 0.2, FORD_WIDTH * 0.92, x, 0.17 + 0.0, z, i === 1 ? C.curb : C.stone, { ry: -route.angle, r: 0.07 });
    }
  }

  // Пилоны профессий.
  for (const p of PYLONS) {
    kit.at([p.x, 0, p.z], -p.angle, () => {
      kit.box(1.0, 0.5, 1.0, 0, 0.88, 0, C.stone, { r: 0.08 });
      kit.cyl(0.42, 0.46, 0.14, 12, 0, 1.2, 0, C.curb);
      kit.cyl(0.26, 0.34, 0.9, 10, 0, 1.7, 0, C.stone);
      kit.torus(0.3, 0.05, 0, 1.55, 0, p.color, { radial: 6, tubular: 20 });
      kit.lathe([[0.18, 0], [0.3, 0.06], [0.42, 0.2], [0.44, 0.28], [0.36, 0.26], [0.0, 0.2]], 14, 0, 2.02, 0, C.curb);
      kit.cyl(0.2, 0.26, 0.2, 10, 0, 2.38, 0, C.stoneDark);
      kit.sphere(0.24, 0, 2.62, 0, p.color, { w: 12, h: 9, tinted: false });
      kit.sphere(0.08, 0, 2.9, 0, C.brass, { w: 6, h: 5, tinted: false });
    });
  }
}

/** Эмблемы и шевроны на мощёных маршрутах: цвет здания видно с площади. */
function buildRouteMarks(kit) {
  for (const route of ROUTES) {
    const ux = Math.cos(route.angle);
    const uz = Math.sin(route.angle);
    const at = (u, v) => [ux * u - uz * v, uz * u + ux * v];
    // Медальон на въезде в маршрут.
    const [mx, mz] = at(9.7, 0);
    kit.cyl(1.0, 1.04, 0.05, 28, mx, 0.125, mz, C.curb, { tinted: false });
    kit.cyl(0.82, 0.82, 0.07, 28, mx, 0.13, mz, route.color, { tinted: false });
    kit.cyl(0.55, 0.55, 0.08, 24, mx, 0.135, mz, C.white, { tinted: false });
    kit.cyl(0.3, 0.3, 0.09, 20, mx, 0.14, mz, route.color, { tinted: false });
    // Шевроны вдоль маршрута.
    for (const u of [12.4, 13.9, 15.4]) {
      const chevron = [[0.45, 0], [-0.2, 0.75], [-0.2, 0.46], [0.15, 0], [-0.2, -0.46], [-0.2, -0.75]].map(([a, b]) => at(u + a, b));
      kit.flatShape(chevron, TILE_Y, 0.016, route.color, { tinted: false });
    }
  }
}

function buildBeds(kit) {
  for (const bed of ROUND_BEDS) {
    const r = bed.radius;
    kit.lathe([[r * 1.06, 0.1], [r * 1.06, 0.36], [r * 1.0, 0.44], [r * 0.9, 0.44], [r * 0.88, 0.36]], 20, bed.x, 0, bed.z, C.stone);
    kit.cyl(r * 0.88, r * 0.9, 0.3, 20, bed.x, 0.27, bed.z, C.soil, { tinted: false });
    kit.sphere(r * 0.84, bed.x, 0.36, bed.z, C.soil, { w: 14, h: 5, s: [1, 0.2, 1], tinted: false });
  }
  for (const bed of PLANTER_BEDS) {
    kit.box(bed.length, 0.44, bed.depth, bed.x, 0.37, bed.z, C.stone, { ry: bed.rotY, r: 0.08 });
    kit.box(bed.length + 0.14, 0.07, bed.depth + 0.14, bed.x, 0.6, bed.z, C.curb, { ry: bed.rotY, r: 0.03 });
    kit.box(bed.length - 0.24, 0.06, bed.depth - 0.24, bed.x, 0.62, bed.z, C.soil, { ry: bed.rotY, tinted: false });
  }
  for (const r of ROCKS) rock(kit, r.x, r.z, r.s, r.tone);
}

function buildFurniture(kit) {
  for (const b of BENCHES) kit.bench(b.x, b.z, b.rotY, { width: 2.2 });
  for (const b of BINS) bin(kit, b.x, b.z, b.rotY);
  for (const l of LAMPS) lampPost(kit, l.x, l.z, { height: 4.3 });
  for (const s of SIGNPOSTS) signpost(kit, s.x, s.z, s.arrows);
  for (const s of INFO_STANDS) infoStand(kit, s.x, s.z, s.rotY);
  // Невысокий штакетник вдоль боковых краёв самых широких газонов (рядом с маршрутом, на внешней половине).
  for (const sector of SECTORS) {
    if (!sector.wide) continue;
    for (const side of [0, 1]) {
      const edge = (r) => {
        const a = side ? sector.a1 - Math.asin((LAWN.inset + 0.25) / r) : sector.a0 + Math.asin((LAWN.inset + 0.25) / r);
        return pointAt(a, r);
      };
      const [x0, z0] = edge(11.5);
      const [x1, z1] = edge(16.4);
      picketFence(kit, x0, z0, x1, z1);
    }
  }
}

export function buildCityPlazaGeometry() {
  const kit = createPrefabKit({ seed: 20 });
  const tiles = createTileBuffer();

  buildFountain(kit);
  buildLawns(kit);
  buildOuterCurb(kit);
  buildRouteMarks(kit);
  buildBeds(kit);
  buildFurniture(kit);
  buildPaving(tiles);

  const solid = kit.build({ groundAO: { height: 0.9, strength: 0.22 }, underside: 0.8 });
  const paving = tiles.build();
  const geometry = mergeGeometries([solid, paving], false);
  solid.dispose();
  paving.dispose();
  if (!geometry) throw new Error('Не удалось объединить геометрию круглой площади');
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

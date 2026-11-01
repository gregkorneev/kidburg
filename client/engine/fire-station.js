// Наружная пожарная часть города: тот же облик, что у станции в учебной сцене (кремовые стены, красная крыша
// с черепицей, сине-серые ворота, часовая башня). Фасад смотрит в +Z; боковая дверь на x = +7.72 — вход по клавише E.
import { createPrefabKit } from './art/prefab-kit.js';

const C = {
  cream: 0xf5e9cd, pale: 0xfff4d9, red: 0xd65a42, darkRed: 0xa94436, roof: 0xc9533e, roofTile: 0xa33f33,
  navy: 0x345568, blue: 0x7fb6bf, green: 0x438266, gold: 0xf0c85f, stone: 0xdcd0b0, grey: 0x5f7a7e,
  white: 0xfff9e8, trim: 0xd9dfce, brick: 0xd9694d, glass: 0x86bccd,
};

/** Проём гаражных ворот (координаты здания): центры по X, ширина, высота, пол проёма и плоскость секций по Z. */
export const GARAGE_X = Object.freeze([-5.5, 1.15]);
export const GATE = Object.freeze({ width: 4.84, height: 4.25, baseY: 0.5, z: 7.12, thickness: 0.12, sections: 6, radius: 0.2 });
export const GATE_PALETTE = Object.freeze({ a: 0x5f7a7e, b: 0x587276, glass: 0x7fb6bf, trim: 0xd9dfce });

export const FIRE_STATION_SIGNS = Object.freeze([
  { text: 'ПОЖАРНАЯ ЧАСТЬ', x: -1.5, y: 8.25, z: 7.15, w: 9.6, h: 1.05, color: '#a63a2e', border: '#c9533e' },
]);

export function buildFireStationGeometry() {
  const k = createPrefabKit({ seed: 11 });

  // Пол и стены собраны как оболочка: два гаражных проёма остаются сквозными.
  k.slab(22.8, 0.5, 13.9, 0, 0, -0.45, C.stone, { r: 0.1 });
  const garageOpenings = GARAGE_X.map((x) => [x - GATE.width / 2, x + GATE.width / 2]);
  const facadeSections = [];
  let edge = -10.7;
  for (const [lo, hi] of garageOpenings) {
    if (lo > edge) facadeSections.push([edge, lo]);
    edge = hi;
  }
  if (edge < 10.7) facadeSections.push([edge, 10.7]);
  for (const [lo, hi] of facadeSections) {
    const width = hi - lo;
    const x = (lo + hi) / 2;
    k.slab(width, 1.1, 0.5, x, 0.5, 6.75, C.brick);
    k.slab(width, 3.65, 0.5, x, 1.6, 6.75, C.cream);
  }
  k.slab(21.4, 4.35, 0.5, 0, 4.75, 6.75, C.cream);
  k.slab(21.6, 1.1, 0.5, 0, 0.5, -6.75, C.brick);
  k.slab(21.4, 7.5, 0.5, 0, 1.6, -6.75, C.cream);
  for (const x of [-10.55, 10.55]) {
    k.slab(0.5, 1.1, 13.5, x, 0.5, 0, C.brick);
    k.slab(0.5, 7.5, 13.5, x, 1.6, 0, C.cream);
  }
  // Красные угловые пилястры и межэтажный пояс.
  for (const x of [-10.3, 10.3]) {
    for (const z of [-6.75, 6.75]) k.slab(0.8, 8.0, 0.6, x, 1.1, z, C.red, { r: 0.08 });
  }
  k.box(22.0, 0.34, 14.1, 0, 5.2, 0, C.red, { r: 0.06 });
  k.box(22.7, 0.34, 14.5, 0, 9.0, 0, C.darkRed, { r: 0.08 });

  // Двускатная крыша: красная, с рядами черепицы; светлая лицевая кромка.
  k.gableRoof({ w: 23.6, d: 15.6, rise: 2.9, y: 9.15, color: C.roof, edge: C.cream, ridge: C.darkRed, tiles: C.roofTile, courses: 8 });
  k.prism(21.6, 0.3, 2.45, 0, 9.18, 7.0, C.cream);

  // Часовая башня на левом углу: кирпичный ствол, циферблаты, шатёр и флюгер.
  k.slab(3.0, 4.6, 3.0, -8.3, 10.0, 0.5, C.brick, { r: 0.08 });
  k.box(3.4, 0.3, 3.4, -8.3, 14.7, 0.5, C.cream, { r: 0.07 });
  k.cone(2.35, 2.6, 4, -8.3, 16.1, 0.5, C.roof, { rot: [0, Math.PI / 4, 0] });
  k.sphere(0.2, -8.3, 17.5, 0.5, C.gold, { w: 8, h: 6 });
  for (const dir of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    k.at([-8.3 + dir[0] * 1.52, 12.9, 0.5 + dir[1] * 1.52], Math.atan2(dir[0], dir[1]), () => {
      k.cyl(0.74, 0.74, 0.1, 26, 0, 0, 0, C.darkRed, { rot: [Math.PI / 2, 0, 0] });
      k.cyl(0.6, 0.6, 0.1, 26, 0, 0, 0.04, C.white, { rot: [Math.PI / 2, 0, 0], tinted: false });
      k.box(0.07, 0.42, 0.05, 0, 0.16, 0.1, 0x3d2d24, { tinted: false });
      k.box(0.3, 0.06, 0.05, 0.12, 0, 0.1, 0x3d2d24, { tinted: false });
    });
  }
  k.box(1.6, 0.9, 0.3, -8.3, 11.4, 2.05, C.navy, { r: 0.05 }); // жалюзи звонницы
  for (let i = 0; i < 4; i++) k.box(1.4, 0.05, 0.08, -8.3, 11.15 + i * 0.2, 2.22, C.cream, { tinted: false });

  // Два гаража: неподвижные косяки, короб над проёмом и тёмный проём. Сами секции ворот подвижные
  // (mechanisms/gate.js, см. city-mechanisms.js) и едут вверх в короб, поэтому в слитую геометрию не входят.
  for (const x of GARAGE_X) {
    for (const side of [-1, 1]) k.box(0.53, 3.95, 0.34, x + side * (GATE.width / 2 + 0.265), 2.75, 6.85, C.red, { r: 0.08 });
    k.box(5.9, 0.575, 0.34, x, 5.04, 6.85, C.red, { r: 0.08 }); // красный наличник над проёмом
    for (const side of [-1, 1]) k.box(0.3, 3.75, 0.44, x + side * (GATE.width / 2 + 0.15), 2.92, 7.08, C.navy, { r: 0.04 });
    k.box(5.2, 0.5, 0.44, x, 4.97, 7.08, C.navy, { r: 0.05 }); // короб: сюда уходят секции
    // Сигнальный фонарь над воротами.
    k.box(0.42, 0.42, 0.36, x, 5.55, 7.1, C.darkRed, { r: 0.07 });
    k.box(0.28, 0.3, 0.4, x, 5.57, 7.18, C.gold, { tinted: false });
  }

  // Входная дверь с остеклением справа (E — вход в учебную пожарную часть).
  k.door(7.72, 2.4, 6.75, { w: 2.2, h: 3.1, leaf: C.green, frame: C.cream, glass: C.glass, handle: C.gold, step: C.stone, leaves: false });
  k.box(3.2, 0.2, 1.4, 7.72, 4.35, 7.4, C.red, { r: 0.07 }); // козырёк
  for (const sx of [-1, 1]) k.box(0.1, 0.5, 1.2, 7.72 + sx * 1.5, 4.08, 7.35, C.darkRed);

  // Окна второго этажа: белые рамы, красные подоконники, ящики с цветами.
  for (const x of [-8.35, -5.3, -2.25, 2.25, 5.3, 8.35]) {
    k.window(x, 7.05, 6.75, { w: 1.9, h: 1.7, glass: C.glass, frame: C.white, sill: C.red, lintel: null, flowerBox: x % 2 === 0 || x < 0 ? { box: C.darkRed, leaf: 0x5f9a64, blooms: [0xf4b6c2, 0xfff0b8, 0xffffff] } : null });
  }
  // Боковые и задние окна.
  for (const [pos, rot, zs] of [[[10.7, 0, 0], Math.PI / 2, [-3.8, 0, 3.8]], [[-10.7, 0, 0], -Math.PI / 2, [-3.8, 0, 3.8]]]) {
    k.at(pos, rot, () => zs.forEach((z) => {
      k.window(z, 3.1, 0, { w: 1.6, h: 1.8, glass: C.glass, frame: C.white, sill: C.stone });
      k.window(z, 7.05, 0, { w: 1.6, h: 1.7, glass: C.glass, frame: C.white, sill: C.red });
    }));
  }

  // Эмблема на фронтоне: щит с лучами и звездой.
  k.at([0, 10.7, 7.1], 0, () => {
    k.cyl(0.9, 0.9, 0.16, 24, 0, 0, 0, C.darkRed, { rot: [Math.PI / 2, 0, 0] });
    k.cyl(0.72, 0.72, 0.16, 24, 0, 0, 0.05, C.gold, { rot: [Math.PI / 2, 0, 0], tinted: false });
    for (let i = 0; i < 4; i++) k.box(0.15, 0.9, 0.08, 0, 0, 0.16, C.red, { rot: [0, 0, (i * Math.PI) / 4], tinted: false });
    k.cyl(0.18, 0.18, 0.1, 12, 0, 0, 0.2, C.darkRed, { rot: [Math.PI / 2, 0, 0], tinted: false });
  });

  // Конусы и гидрант у ворот: детали рабочего двора.
  for (const x of [-9.2, 3.8]) {
    k.cone(0.26, 0.7, 10, x, 0.37, 8.6, 0xf28b35);
    k.cyl(0.3, 0.3, 0.06, 10, x, 0.04, 8.6, 0xfff6e6);
  }
  k.cyl(0.2, 0.24, 0.8, 10, 10.2, 0.4, 8.7, C.red);
  k.sphere(0.22, 10.2, 0.84, 8.7, C.darkRed, { w: 8, h: 5 });
  k.cyl(0.07, 0.07, 0.5, 6, 10.2, 0.55, 8.9, C.gold);

  return k.build({ groundAO: { height: 2.2, strength: 0.3 }, bands: [{ y0: 8.7, y1: 9.1, strength: 0.16 }] });
}

/** Коллизии оболочки здания; гаражные порталы блокируются отдельно, пока секционные ворота закрыты. */
export function fireStationCollisionBoxes() {
  const boxes = [];
  const add = (minX, maxX, minY, maxY, minZ, maxZ) => boxes.push({ minX, maxX, minY, maxY, minZ, maxZ });
  add(-12, 12, 0.5, 9.1, -8, -7.2);
  add(-12, -11.2, 0.5, 9.1, -7.2, 7.2);
  add(11.2, 12, 0.5, 9.1, -7.2, 7.2);
  let edge = -12;
  for (const x of GARAGE_X) {
    const lo = x - GATE.width / 2;
    const hi = x + GATE.width / 2;
    if (lo > edge) add(edge, lo, 0.5, GATE.baseY + GATE.height, 6.5, 7.0);
    edge = hi;
  }
  if (edge < 12) add(edge, 12, 0.5, GATE.baseY + GATE.height, 6.5, 7.0);
  add(-12, 12, 4.75, 9.1, 6.5, 7.0);
  return boxes;
}

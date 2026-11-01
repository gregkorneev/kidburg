// Цветочная лавка: самое «живое» здание площади — шалфейные стены, розовые навесы, арка с плющом, стеллажи
// с цветами и маленькая оранжерея сбоку. Фасад смотрит в +Z. Одна вершинно-окрашенная геометрия для InstancedMesh.
import { createPrefabKit } from './art/prefab-kit.js';
import { bush, flower, planterBox } from './art/flora.js';

const C = {
  wall: 0xdfe9d4, wallShade: 0xc9d9bf, trim: 0xfbf7ec, roof: 0x9a5651, roofTile: 0x7d4340, glass: 0xa6cfd6, frame: 0x7fa584,
  frameDark: 0x4f7a5e, door: 0x6d9a7b, stone: 0xd6cdb9, awnA: 0xeaa6bd, awnB: 0xfff7ee, wood: 0x9b6f48, woodLight: 0xc9985f,
  leaf: 0x58985f, leafDark: 0x3f7a4f, pink: 0xe99ab5, yellow: 0xf0cd67, lilac: 0xb9a0e0, red: 0xe0646d, white: 0xfffaf0,
};
const BLOOMS = [C.pink, C.yellow, C.lilac, C.red, C.white];

export const FLOWER_SHOP_SIGNS = Object.freeze([
  { text: 'ЦВЕТОЧНАЯ ЛАВКА', x: 0, y: 8.2, z: 4.95, w: 6.6, h: 1.0, color: '#3d6e4d', border: '#e99ab5', background: '#fffaf0' },
]);

const bucket = (k, x, y, z, i) => {
  k.cyl(0.26, 0.2, 0.42, 9, x, y + 0.21, z, i % 2 ? C.wood : C.frameDark);
  for (let j = 0; j < 4; j++) {
    const a = j * 1.6 + i;
    flower(k, x + Math.cos(a) * 0.12, y + 0.36 + (j % 2) * 0.12, z + Math.sin(a) * 0.12, BLOOMS[(i + j) % BLOOMS.length], 0.9);
  }
};

export function buildFlowerShopGeometry() {
  const k = createPrefabKit({ seed: 13 });

  // Основание, корпус, угловые пилястры и карниз.
  k.slab(16.0, 0.4, 10.0, 0, 0, 0, C.stone, { r: 0.1 });
  k.slab(15.2, 8.5, 9.1, 0, 0.4, 0, C.wall);
  k.slab(15.4, 0.9, 9.3, 0, 0.4, 0, C.wallShade);
  for (const x of [-7.5, 7.5]) k.slab(0.5, 8.8, 9.3, x, 0.4, 0, C.trim, { r: 0.07 });
  k.box(15.5, 0.26, 9.4, 0, 4.7, 0, C.trim, { r: 0.06 });
  k.box(15.9, 0.34, 9.8, 0, 9.0, 0, C.trim, { r: 0.08 });

  // Крыша и слуховое окно в мансарде.
  k.gableRoof({ w: 17.2, d: 10.8, rise: 3.1, y: 9.2, color: C.roof, edge: C.trim, ridge: C.roofTile, tiles: C.roofTile, courses: 7 });
  k.prism(3.4, 2.0, 1.55, -3.8, 10.25, 3.2, C.wall);
  k.at([-3.8, 10.25, 4.2], 0, () => k.window(0, 0.8, 0, { w: 1.2, h: 1.1, glass: C.glass, frame: C.trim, rows: 1, mullions: 1, flowerBox: { box: C.wood, leaf: C.leaf, blooms: BLOOMS } }));
  k.slab(1.1, 2.8, 1.1, 5.0, 10.2, -2.4, 0xc9684f, { r: 0.06 });

  // Верхние окна с ставнями и цветочными ящиками.
  for (const x of [-4.8, -1.6, 1.6, 4.8]) {
    k.window(x, 6.9, 4.55, { w: 1.8, h: 2.0, glass: C.glass, frame: C.trim, sill: C.trim, shutters: C.frame, flowerBox: { box: C.wood, leaf: C.leaf, blooms: BLOOMS } });
  }

  // Витрины с растениями и розовыми навесами.
  for (const sx of [-1, 1]) {
    const x = sx * 4.7;
    k.window(x, 2.45, 4.55, { w: 4.2, h: 3.0, glass: C.glass, frame: C.trim, sill: C.frame, mullions: 3, rows: 2 });
    k.box(3.8, 0.12, 0.4, x, 1.75, 4.82, C.woodLight, { r: 0.03 });
    for (let j = 0; j < 5; j++) {
      const px = x - 1.5 + j * 0.75;
      k.cyl(0.19, 0.15, 0.3, 8, px, 1.95, 4.84, j % 2 ? C.wood : C.frameDark);
      k.sphere(0.24, px, 2.32, 4.84, j % 2 ? C.leaf : C.leafDark, { w: 7, h: 5 });
      k.sphere(0.1, px, 2.5, 4.9, BLOOMS[j % BLOOMS.length], { w: 5, h: 4, tinted: false });
    }
    k.awning(x, 4.5, 4.58, { w: 4.8, depth: 1.7, drop: 0.65, stripes: 8, a: C.awnA, b: C.awnB });
  }

  // Вход под аркой из плюща.
  k.door(0, 2.3, 4.55, { w: 1.9, h: 3.0, leaf: C.door, frame: C.trim, glass: C.glass, handle: C.yellow, step: C.stone, leaves: false });
  for (const sx of [-1, 1]) k.box(0.2, 3.9, 0.2, sx * 1.35, 2.15, 5.5, C.frameDark, { r: 0.05 });
  k.torus(1.35, 0.1, 0, 4.1, 5.5, C.frameDark, { rot: [0, 0, 0], arc: Math.PI, radial: 6, tubular: 18 });
  for (let i = 0; i < 12; i++) {
    const a = Math.PI * (i / 11);
    k.sphere(0.2, Math.cos(a) * 1.35, 4.1 + Math.sin(a) * 1.35, 5.5, i % 3 ? C.leaf : C.leafDark, { w: 6, h: 5 });
    if (i % 2) k.sphere(0.1, Math.cos(a) * 1.38, 4.1 + Math.sin(a) * 1.38, 5.62, BLOOMS[i % BLOOMS.length], { w: 5, h: 4, tinted: false });
  }
  for (const sx of [-1, 1]) for (let j = 0; j < 5; j++) k.sphere(0.2, sx * 1.35, 0.9 + j * 0.78, 5.5, j % 2 ? C.leaf : C.leafDark, { w: 6, h: 5 });

  // Оранжерея справа: стеклянный пристрой с рамой и растениями внутри.
  k.at([9.0, 0, 1.0], 0, () => {
    k.slab(3.6, 0.3, 6.4, 0, 0, 0, C.stone, { r: 0.06 });
    for (const [x, z] of [[-1.7, -3.0], [1.7, -3.0], [-1.7, 3.0], [1.7, 3.0]]) k.box(0.14, 3.4, 0.14, x, 1.95, z, C.trim);
    k.box(3.5, 3.0, 6.2, 0, 1.9, 0, C.glass, { tinted: false });
    for (let i = 1; i < 4; i++) k.box(0.06, 3.0, 6.3, -1.75 + i * 0.875, 1.9, 0, C.trim, { tinted: false });
    k.prism(3.8, 6.5, 1.1, 0, 3.55, 0, C.trim);
    for (let i = 0; i < 4; i++) { k.sphere(0.4, -0.9 + (i % 2) * 1.8, 0.7, -2 + i * 1.3, C.leaf, { w: 7, h: 5 }); k.sphere(0.14, -0.9 + (i % 2) * 1.8, 1.05, -2 + i * 1.3, BLOOMS[i], { w: 5, h: 4, tinted: false }); }
  });

  // Уличные стеллажи: ступенчатая подставка с вёдрами и цветочные ящики вдоль фасада.
  for (const [x, z] of [[-6.8, 7.2], [6.0, 7.4]]) {
    for (let tier = 0; tier < 3; tier++) {
      k.box(2.2 - tier * 0.4, 0.08, 0.8 - tier * 0.12, x, 0.35 + tier * 0.42, z - tier * 0.12, C.wood, { r: 0.02 });
      for (const sx of [-1, 1]) k.box(0.08, 0.35 + tier * 0.42, 0.08, x + sx * (1.0 - tier * 0.2), (0.35 + tier * 0.42) / 2, z - tier * 0.12, C.wood);
    }
    for (let i = 0; i < 7; i++) bucket(k, x - 0.9 + (i % 3) * 0.9 * (1 - 0.2 * Math.floor(i / 3)), 0.4 + Math.floor(i / 3) * 0.42, z - Math.floor(i / 3) * 0.12, i);
  }
  planterBox(k, -2.6, 7.3, 0, { length: 2.6, depth: 0.8, wood: true });
  planterBox(k, 2.6, 7.3, 0, { length: 2.6, depth: 0.8, wood: true });
  bush(k, -8.2, 6.0, 0.9, 2);
  bush(k, 8.0, 6.2, 0.8, 3);
  for (let i = 0; i < 6; i++) flower(k, -8.6 + (i % 3) * 0.35, 0.05, 7.0 + Math.floor(i / 3) * 0.35, BLOOMS[i % BLOOMS.length], 1);

  return k.build({ groundAO: { height: 2.0, strength: 0.28 }, bands: [{ y0: 8.7, y1: 9.1, strength: 0.15 }] });
}

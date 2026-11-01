// Пекарня: тёплое, уютное здание с полосатыми навесами, витринами с булочками и уличными деталями.
// Положительное Z — сторона входа. Одна вершинно-окрашенная геометрия для InstancedMesh.
import { createPrefabKit } from './art/prefab-kit.js';
import { bin, bush, flower } from './art/flora.js';

const C = {
  cream: 0xf6e8cc, peach: 0xe8b491, trim: 0xfff1d8, cocoa: 0x805143, roof: 0xb65a4b, roofTile: 0x963f35, dark: 0x843c38,
  glass: 0x8cc3c9, awnA: 0xc96156, awnB: 0xfff1d8, gold: 0xedbc61, wood: 0x9b6748, woodLight: 0xc28a5c, pastry: 0xdca45e,
  bread: 0xb87939, brick: 0xc9684f, stone: 0xdcd0b0, green: 0x668a5c, chalk: 0x2f3b3a,
};

export const BAKERY_SIGNS = Object.freeze([
  { text: 'ПЕКАРНЯ', x: 0, y: 8.3, z: 6.95, w: 5.2, h: 1.05, color: '#6f3a2e', border: '#c96156', background: '#fff0d4' },
]);

export function buildBakeryGeometry() {
  const k = createPrefabKit({ seed: 12 });

  // Цоколь, двухэтажный корпус с поясом, угловыми пилястрами и карнизом.
  k.slab(17.6, 0.45, 13.4, 0, 0, 0, C.stone, { r: 0.1 });
  k.slab(17.2, 8.5, 13.0, 0, 0.45, 0, C.cream);
  k.slab(17.5, 0.9, 13.3, 0, 0.45, 0, C.peach);
  k.box(17.6, 0.3, 13.3, 0, 4.7, 0, C.peach, { r: 0.06 });
  k.box(17.9, 0.4, 13.6, 0, 9.2, 0, C.trim, { r: 0.08 });
  for (const x of [-8.5, 8.5]) k.slab(0.6, 8.7, 0.5, x, 0.45, 6.55, C.peach, { r: 0.06 });

  // Крыша с черепицей и кирпичной трубой.
  k.gableRoof({ w: 19.0, d: 14.6, rise: 3.2, y: 9.4, color: C.roof, edge: C.trim, ridge: C.dark, tiles: C.roofTile, courses: 8 });
  k.slab(1.3, 3.0, 1.3, 5.2, 10.2, -2.6, C.brick, { r: 0.07 });
  k.box(1.6, 0.25, 1.6, 5.2, 13.3, -2.6, C.stone, { r: 0.06 });
  // Слуховое окно на крыше: уютный акцент над вывеской.
  k.prism(3.2, 2.0, 1.5, 0, 10.45, 3.6, C.cream);
  k.at([0, 10.45, 4.6], 0, () => k.window(0, 0.75, 0, { w: 1.2, h: 1.0, glass: C.glass, frame: C.trim, rows: 1, mullions: 1 }));

  // Витрины первого этажа с полками, булочками и подоконными ящиками.
  for (const sx of [-1, 1]) {
    const x = sx * 5.15;
    k.window(x, 2.55, 6.5, { w: 4.6, h: 3.2, glass: C.glass, frame: C.trim, sill: C.peach, mullions: 3, rows: 2 });
    k.box(4.2, 0.14, 0.34, x, 1.75, 6.78, C.woodLight, { r: 0.04 });
    k.box(4.2, 0.14, 0.34, x, 2.8, 6.78, C.woodLight, { r: 0.04 });
    for (let j = 0; j < 6; j++) {
      k.sphere(0.27, x - 1.65 + j * 0.66, 2.04, 6.82, j % 2 ? C.pastry : C.bread, { s: [1.15, 0.85, 1], w: 8, h: 6 });
      k.sphere(0.2, x - 1.65 + j * 0.66, 3.03, 6.82, j % 2 ? C.bread : C.pastry, { s: [1.25, 0.8, 1], w: 7, h: 5 });
    }
    // Навес со скруглённой бахромой над витриной.
    k.awning(x, 4.55, 6.52, { w: 5.4, depth: 1.9, drop: 0.7, stripes: 9, a: C.awnA, b: C.awnB });
  }
  // Окна второго этажа с ставнями и цветами.
  for (const x of [-6.0, -2.2, 2.2, 6.0]) {
    k.window(x, 7.0, 6.5, { w: 1.9, h: 2.0, glass: C.glass, frame: C.trim, sill: C.peach, lintel: null, shutters: C.awnA, flowerBox: { box: C.wood, leaf: 0x5f9a64, blooms: [0xf4b6c2, 0xfff0b8, 0xffffff] } });
  }

  // Центральный вход с дверью-с-окнами, светильниками и ступеньками.
  k.door(0, 2.35, 6.5, { w: 2.5, h: 3.4, leaf: C.wood, frame: C.trim, glass: C.glass, handle: C.gold, step: C.peach, leaves: false });
  for (const x of [-2.0, 2.0]) {
    k.box(0.12, 0.7, 0.14, x, 3.5, 6.75, C.dark);
    k.sphere(0.22, x, 3.05, 6.9, 0xffe3a0, { w: 8, h: 6, tinted: false });
  }
  // Объёмная вывеска-эмблема: булка-батон на кронштейне над дверью.
  k.box(6.0, 0.18, 0.3, 0, 9.0, 6.82, C.cocoa, { r: 0.06 });
  k.sphere(1.0, 0, 9.7, 7.05, C.bread, { s: [1.5, 0.52, 0.46], w: 14, h: 9 });
  for (const x of [-0.66, 0, 0.66]) k.box(0.1, 0.5, 0.06, x, 9.74, 7.45, C.cream, { rot: [0, 0, -0.5], tinted: false });
  k.cyl(0.04, 0.04, 0.7, 5, 0, 9.35, 7.05, C.dark);

  // Уличные детали: столик с двумя табуретами, корзины с хлебом, меловая доска, бочка с цветами, урна.
  k.cyl(0.55, 0.55, 0.08, 14, -2.5, 0.92, 9.0, C.woodLight);
  k.cyl(0.07, 0.09, 0.86, 8, -2.5, 0.45, 9.0, C.dark);
  k.cyl(0.32, 0.32, 0.08, 10, -2.5, 0.05, 9.0, C.dark);
  for (const [dx, dz] of [[-0.9, 0], [0.9, 0.1]]) {
    k.cyl(0.26, 0.26, 0.08, 10, -2.5 + dx, 0.58, 9.0 + dz, C.awnA);
    k.cyl(0.04, 0.04, 0.54, 6, -2.5 + dx, 0.28, 9.0 + dz, C.dark);
  }
  k.sphere(0.2, -2.5, 1.05, 9.0, C.bread, { s: [1.3, 0.8, 1], w: 7, h: 5 });
  for (const [x, z] of [[3.2, 8.6], [4.3, 8.4]]) {
    k.cyl(0.42, 0.34, 0.5, 12, x, 0.25, z, C.wood);
    for (let i = 0; i < 4; i++) k.sphere(0.19, x + Math.cos(i * 1.7) * 0.2, 0.62, z + Math.sin(i * 1.7) * 0.2, i % 2 ? C.bread : C.pastry, { s: [1.2, 0.8, 1], w: 6, h: 5 });
  }
  k.box(0.9, 1.15, 0.08, 1.9, 0.65, 8.2, C.chalk, { r: 0.04, rot: [-0.1, 0.3, 0] });
  k.box(0.9, 0.08, 0.5, 1.9, 0.04, 8.15, C.wood, { ry: 0.3 });
  k.cyl(0.5, 0.42, 0.7, 12, -6.6, 0.35, 8.2, C.wood);
  k.at([0, 0.62, 0], 0, () => bush(k, -6.6, 8.2, 0.55, 1)); // куст растёт из бочки
  for (let i = 0; i < 5; i++) flower(k, -6.6 + Math.cos(i * 1.3) * 0.3, 0.7, 8.2 + Math.sin(i * 1.3) * 0.3, [0xf4b6c2, 0xfff0b8, 0xffffff, 0xffc27a, 0xc7b5f4][i], 0.9);
  bin(k, 6.7, 8.3);

  return k.build({ groundAO: { height: 2.0, strength: 0.3 }, bands: [{ y0: 8.7, y1: 9.15, strength: 0.15 }] });
}

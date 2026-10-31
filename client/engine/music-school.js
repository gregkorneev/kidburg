// Музыкальная школа: изящное здание в голубой гамме с нотными мотивами — «клавишный» пояс под карнизом,
// медальон со скрипичным ключом над входом и небольшие ноты на панелях. Фасад смотрит в +Z.
import { createPrefabKit } from './art/prefab-kit.js';
import { bush } from './art/flora.js';

const C = {
  wall: 0xf3eddf, blue: 0x91c7d2, blueDark: 0x427c91, blueDeep: 0x2d5367, roof: 0x9a5349, roofTile: 0x7c3f3a, roofEdge: 0xfff9ed,
  white: 0xfff9ed, glass: 0x8fc3d6, wood: 0x98715d, gold: 0xe4bb5e, door: 0x466d86, stone: 0xd6cdbd, cream: 0xf9eccb, notes: 0x28485d, key: 0x2b3540,
};

export const MUSIC_SCHOOL_SIGNS = Object.freeze([
  { text: 'МУЗЫКАЛЬНАЯ ШКОЛА', x: 0, y: 4.55, z: 7.13, w: 7.2, h: 0.78, color: '#2d5367', border: '#e4bb5e', background: '#fdf6e6' },
]);

// Контур скрипичного ключа (x — в метрах от оси, y — от нижней точки ключа).
const CLEF = [
  [[0.17, 11.9], [0.08, 10.7], [-0.02, 9.4], [-0.08, 8.1], [-0.1, 6.85], [-0.11, 5.7], [-0.17, 4.92], [-0.38, 4.7], [-0.66, 4.8], [-0.73, 5.08]],
  [[0.17, 11.9], [0.12, 12.65], [0.32, 13.22], [0.71, 13.32], [1.02, 13.05], [1.1, 12.48], [0.89, 11.91], [0.48, 11.45], [-0.06, 11.02], [-0.43, 10.52], [-0.42, 9.98], [-0.08, 9.61], [0.38, 9.65]],
  [[-0.08, 9.55], [-0.77, 9.37], [-1.27, 8.88], [-1.47, 8.13], [-1.3, 7.37], [-0.78, 6.88], [-0.06, 6.72], [0.7, 6.91], [1.17, 7.39], [1.31, 8.06], [1.1, 8.66], [0.65, 8.95], [0.13, 8.92], [-0.26, 8.6], [-0.33, 8.16], [-0.09, 7.88], [0.26, 7.9]],
];

export function buildMusicSchoolGeometry() {
  const k = createPrefabKit({ seed: 14 });
  const note = (x, y, z, s, color) => {
    k.sphere(0.2 * s, x, y, z, color, { s: [1.35, 0.72, 0.4], w: 8, h: 6, rot: [0, 0, 0.3] });
    k.box(0.07 * s, 0.8 * s, 0.08 * s, x + 0.22 * s, y + 0.42 * s, z, color);
    k.box(0.34 * s, 0.1 * s, 0.08 * s, x + 0.36 * s, y + 0.8 * s, z, color, { rot: [0, 0, -0.25] });
  };

  // Цоколь, корпус, голубые пилястры, пояс и «клавишный» фриз.
  k.slab(19.4, 0.5, 11.0, 0, 0, 0, C.stone, { r: 0.1 });
  k.slab(18.2, 8.6, 10.2, 0, 0.5, 0, C.wall);
  k.slab(18.4, 0.9, 10.4, 0, 0.5, 0, C.blue);
  for (const x of [-9.0, 9.0]) k.slab(0.7, 8.8, 0.55, x, 0.5, 5.15, C.blue, { r: 0.08 });
  k.box(18.8, 0.28, 10.6, 0, 4.4, 0, C.blueDark, { r: 0.06 });
  k.box(19.2, 0.4, 10.8, 0, 9.2, 0, C.white, { r: 0.08 });
  k.box(19.6, 0.2, 11.0, 0, 9.5, 0, C.blueDark, { r: 0.05 });
  for (let i = 0; i < 36; i++) {
    const x = -8.75 + i * 0.5;
    k.box(0.4, 0.5, 0.12, x, 8.82, 5.24, C.white, { tinted: false });
    if ([1, 2, 4, 5, 6].includes(i % 7)) k.box(0.24, 0.3, 0.14, x + 0.25, 8.9, 5.27, C.key, { tinted: false });
  }

  // Крыша с черепицей.
  k.gableRoof({ w: 21.2, d: 12.2, rise: 3.1, y: 9.6, color: C.roof, edge: C.roofEdge, ridge: C.roofTile, tiles: C.roofTile, courses: 8 });
  k.cyl(0.9, 1.1, 0.4, 14, 5.8, 12.1, -2.0, C.blueDark);
  k.sphere(0.9, 5.8, 12.7, -2.0, C.blue, { s: [1, 0.7, 1], w: 10, h: 6 });
  k.sphere(0.14, 5.8, 13.4, -2.0, C.gold, { w: 6, h: 5 });

  // Окна второго этажа и витрины классов; на боковых стенах — те же окна.
  for (const x of [-6.7, -4.2, 4.2, 6.7]) {
    k.window(x, 6.75, 5.1, { w: 1.7, h: 2.2, glass: C.glass, frame: C.white, sill: C.blueDark, lintel: C.blue, shutters: null });
    k.window(x, 2.7, 5.1, { w: 1.7, h: 2.7, glass: C.glass, frame: C.white, sill: C.blueDark, lintel: C.blue });
  }
  for (const [pos, rot] of [[[9.1, 0, 0], Math.PI / 2], [[-9.1, 0, 0], -Math.PI / 2]]) {
    k.at(pos, rot, () => [-2.8, 0, 2.8].forEach((z) => {
      k.window(z, 2.7, 0, { w: 1.7, h: 2.7, glass: C.glass, frame: C.white, sill: C.blueDark });
      k.window(z, 6.75, 0, { w: 1.7, h: 2.2, glass: C.glass, frame: C.white, sill: C.blueDark, lintel: C.blue });
    }));
  }

  // Вход: лестница, дверь, козырёк на колонках и золотые ручки.
  k.slab(4.8, 0.3, 1.6, 0, 0.5, 6.1, C.stone, { r: 0.07 });
  k.slab(4.2, 0.26, 1.1, 0, 0.8, 6.0, C.white, { r: 0.07 });
  k.door(0, 2.7, 5.1, { w: 2.5, h: 3.3, leaf: C.door, frame: C.white, glass: C.glass, handle: C.gold });
  k.box(7.8, 0.9, 2.0, 0, 4.55, 6.1, C.blueDark, { r: 0.08 });
  k.box(8.0, 0.14, 2.15, 0, 5.07, 6.1, C.white, { r: 0.05 });
  for (const sx of [-1, 1]) {
    k.cyl(0.14, 0.17, 3.3, 10, sx * 3.4, 2.45, 6.95, C.white);
    k.cyl(0.24, 0.2, 0.18, 10, sx * 3.4, 0.89, 6.95, C.stone);
  }
  for (const sx of [-1, 1]) {
    k.box(0.1, 0.4, 0.1, sx * 1.6, 3.2, 5.4, 0x2f3b3a);
    k.sphere(0.18, sx * 1.6, 2.9, 5.45, 0xffe9a8, { w: 7, h: 6, tinted: false });
  }

  // Медальон со скрипичным ключом над козырьком.
  k.at([0, 7.1, 5.1], 0, () => {
    k.cyl(1.85, 1.85, 0.16, 28, 0, 0, 0.04, C.blueDeep, { rot: [Math.PI / 2, 0, 0] });
    k.cyl(1.6, 1.6, 0.14, 28, 0, 0, 0.1, C.cream, { rot: [Math.PI / 2, 0, 0], tinted: false });
    const s = 0.26;
    for (const stroke of CLEF) {
      k.tube(stroke.map(([x, y]) => [x * s, (y - 9.0) * s, 0.28]), 0.052, C.blueDeep, { radial: 5 });
      k.tube(stroke.map(([x, y]) => [x * s, (y - 9.0) * s, 0.33]), 0.036, C.gold, { radial: 5 });
    }
  });

  // Нотные панели по бокам и нотный стан на козырьке.
  for (const sx of [-1, 1]) {
    k.box(1.0, 1.9, 0.14, sx * 8.0, 6.7, 5.2, C.blue, { r: 0.05 });
    note(sx * 8.0 - 0.1, 6.2, 5.35, 0.8, C.gold);
    note(sx * 8.0 + 0.1, 7.0, 5.35, 0.55, C.notes);
  }
  
  // Двор: клумбы и скамья-ноты у входа.
  for (const sx of [-1, 1]) {
    k.box(2.2, 0.4, 1.0, sx * 3.6, 0.2, 7.6, C.stone, { r: 0.08 });
    bush(k, sx * 3.6, 7.6, 0.55, 2);
    for (let i = 0; i < 4; i++) k.sphere(0.11, sx * 3.6 - 0.7 + i * 0.47, 0.8, 7.9, [0xf4b6c2, 0xfff0b8, 0xc7b5f4, 0xffffff][i], { w: 5, h: 4, tinted: false });
  }
  k.bench(-7.2, 7.4, 0, { width: 2.0, metal: C.blueDeep });
  k.bench(7.2, 7.4, 0, { width: 2.0, metal: C.blueDeep });

  return k.build({ groundAO: { height: 2.0, strength: 0.28 }, bands: [{ y0: 9.0, y1: 9.5, strength: 0.14 }] });
}

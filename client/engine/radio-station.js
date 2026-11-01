// Радиостанция: самое «современное» здание площади — плоская крыша с парапетом, круглая студия-башня со стеклянным
// поясом, решётчатая мачта с маячком и спутниковая тарелка. Фасад смотрит в +Z.
import { createPrefabKit } from './art/prefab-kit.js';
import { bin } from './art/flora.js';

const C = {
  wall: 0xf3e9d6, wallTeal: 0x6ca4ac, trim: 0xfff8e9, dark: 0x345568, roofFlat: 0xc9b99a, parapet: 0xfff1d8, orange: 0xf28b35,
  glass: 0x86c2d2, glassDark: 0x3d6f82, door: 0x3a6872, brass: 0xf0c85f, stone: 0xd0c8b4, aerial: 0x506875, red: 0xe0462f, white: 0xffffff,
};

/** Верх стойки тарелки и шар маячка на мачте (координаты здания): подвижные части ставит city-mechanisms.js. */
export const DISH_POST = Object.freeze({ x: -1.5, z: -3.4, top: 10.4 });
export const MAST_BEACON = Object.freeze({ x: 4.6, y: 16.5, z: -2.4 });

export const RADIO_STATION_SIGNS = Object.freeze([
  { text: 'РАДИО', x: 0, y: 7.55, z: 5.95, w: 3.8, h: 1.05, color: '#345568', border: '#f28b35', background: '#fff5df' },
]);

export function buildRadioStationGeometry() {
  const k = createPrefabKit({ seed: 15 });

  // Основание и корпус студии с цветным цоколем.
  k.slab(16.2, 0.45, 11.9, 0, 0, 0, C.stone, { r: 0.1 });
  k.slab(15.4, 8.3, 11.3, 0, 0.45, 0, C.wall);
  k.slab(15.6, 1.0, 11.5, 0, 0.45, 0, C.wallTeal);
  k.box(15.7, 0.3, 11.6, 0, 4.85, 0, C.wallTeal, { r: 0.07 });
  // Плоская крыша с парапетом и козырьком над входом.
  k.box(16.0, 0.34, 11.9, 0, 9.0, 0, C.parapet, { r: 0.09 });
  k.slab(15.0, 0.12, 10.9, 0, 9.17, 0, C.roofFlat);
  for (const [w, d, x, z] of [[16.0, 0.34, 0, 5.8], [16.0, 0.34, 0, -5.8], [0.34, 11.9, 7.9, 0], [0.34, 11.9, -7.9, 0]]) k.box(w, 0.5, d, x, 9.45, z, C.parapet, { r: 0.07 });
  k.slab(5.6, 0.22, 1.5, 0, 9.0, 6.3, C.orange, { r: 0.06 }); // оранжевый «язык» над вывеской

  // Круглая студия-башня слева: стеклянный пояс и купол.
  const tx = -7.0;
  const tz = 3.6;
  k.cyl(2.4, 2.5, 8.2, 24, tx, 4.55, tz, C.wall);
  k.cyl(2.55, 2.55, 0.4, 24, tx, 4.9, tz, C.wallTeal);
  k.cyl(2.48, 2.48, 2.2, 24, tx, 6.6, tz, C.glass, { tinted: false });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    k.box(0.12, 2.3, 0.12, tx + Math.cos(a) * 2.5, 6.6, tz + Math.sin(a) * 2.5, C.trim, { tinted: false });
  }
  k.cyl(2.65, 2.65, 0.34, 24, tx, 8.8, tz, C.parapet);
  k.sphere(2.4, tx, 9.0, tz, C.orange, { s: [1, 0.55, 1], w: 18, h: 8 });
  k.sphere(0.2, tx, 10.4, tz, C.brass, { w: 8, h: 6 });

  // Студийные витрины и верхние окна.
  for (const sx of [-1, 1]) {
    const x = sx * 3.5;
    k.window(x, 2.7, 5.65, { w: 3.1, h: 3.0, glass: C.glassDark, frame: C.trim, sill: C.wallTeal, mullions: 2, rows: 2 });
    for (let i = 0; i < 4; i++) k.box(0.04, 2.6 - (i % 2) * 0.4, 0.04, x - 1.2 + i * 0.8, 2.7, 5.98, C.glass, { tinted: false }); // блики-ленты
  }
  for (const x of [-4.2, -1.4, 1.4, 4.2, 6.6]) {
    k.window(x, 6.9, 5.65, { w: 1.9, h: 2.0, glass: C.glass, frame: C.trim, sill: C.wallTeal, lintel: null });
  }
  // Вход: двустворчатая дверь, ступени, поручни.
  k.door(0, 2.4, 5.65, { w: 2.4, h: 3.2, leaf: C.door, frame: C.trim, glass: C.glass, handle: C.brass, step: C.stone, leaves: false });
  k.box(4.6, 0.26, 1.5, 0, 4.35, 6.4, C.wallTeal, { r: 0.07 });
  for (const sx of [-1, 1]) k.box(0.14, 3.4, 0.14, sx * 2.1, 2.5, 6.9, C.trim);
  // Эмблема: микрофон и три дуги сигнала по сторонам вывески.
  k.at([0, 7.55, 5.65], 0, () => {
    for (const sx of [-1, 1]) for (let r = 0; r < 3; r++) {
      const pts = [];
      for (let t = -0.8; t <= 0.8 + 1e-3; t += 0.16) pts.push([sx * (2.6 + Math.cos(t) * (0.35 + r * 0.28)), Math.sin(t) * (0.35 + r * 0.28), 0.55]);
      k.tube(pts, 0.05, r === 0 ? C.orange : C.dark, { radial: 5 });
    }
  });

  // Боковые и задние окна.
  for (const [pos, rot, zs] of [[[7.7, 0, 0], Math.PI / 2, [-2.6, 1.6]], [[-7.7, 0, -1.2], -Math.PI / 2, [-2.4, 0.8]]]) {
    k.at(pos, rot, () => zs.forEach((z) => {
      k.window(z, 2.9, 0, { w: 1.7, h: 2.2, glass: C.glass, frame: C.trim, sill: C.wallTeal });
      k.window(z, 6.9, 0, { w: 1.7, h: 2.0, glass: C.glass, frame: C.trim, sill: C.wallTeal });
    }));
  }

  // Решётчатая мачта на крыше с поперечинами, оттяжками и красным маячком.
  const mx = 4.6;
  const mz = -2.4;
  for (const [dx, dz] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) k.cyl(0.07, 0.1, 7.2, 6, mx + dx, 12.8, mz + dz, C.aerial);
  for (let i = 0; i < 6; i++) {
    const y = 9.7 + i * 1.15;
    k.box(0.9, 0.06, 0.06, mx, y, mz - 0.4, C.aerial, { tinted: false });
    k.box(0.9, 0.06, 0.06, mx, y, mz + 0.4, C.aerial, { tinted: false });
    k.box(0.06, 0.06, 0.9, mx - 0.4, y, mz, C.aerial, { tinted: false });
    k.box(0.06, 0.06, 0.9, mx + 0.4, y, mz, C.aerial, { tinted: false });
  }
  for (const y of [14.1, 15.0]) k.box(2.4, 0.09, 0.09, mx, y, mz, C.aerial, { tinted: false });
  for (const [ex, ez] of [[-3.5, -3.0], [3.0, 2.5], [-3.5, 3.5]]) k.tube([[mx, 14.2, mz], [mx + ex * 0.5, 11.8, mz + ez * 0.5], [mx + ex, 9.2, mz + ez]], 0.025, C.aerial, { radial: 4 });
  // Стойка спутниковой тарелки: сама тарелка и маячок мачты — подвижные детали (mechanisms/antenna.js).
  k.cyl(0.08, 0.1, 1.2, 6, DISH_POST.x, 9.8, DISH_POST.z, C.aerial);
  k.cyl(0.18, 0.22, 0.12, 8, DISH_POST.x, 9.26, DISH_POST.z, C.dark);

  bin(k, 7.0, 8.0);
  k.bench(-3.5, 8.2, 0, { width: 2.0, metal: C.dark });
  k.bench(3.5, 8.2, 0, { width: 2.0, metal: C.dark });

  return k.build({ groundAO: { height: 2.0, strength: 0.28 }, bands: [{ y0: 8.6, y1: 9.0, strength: 0.14 }] });
}

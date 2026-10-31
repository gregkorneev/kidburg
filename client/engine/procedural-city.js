// Мэрия: главное общественное здание площади. Фасад смотрит в +Z, корпус 22 × 14 м (коллайдер задаёт prefabs.js).
// Один вершинно-окрашенный BufferGeometry для InstancedMesh; вывеска-табличка добавляется отдельно (CITY_HALL_SIGNS).
import { createPrefabKit } from './art/prefab-kit.js';

const C = {
  wall: 0xf1e7d0, wallShade: 0xe3d6ba, trim: 0xfff6e3, stone: 0xd9ccb2, stoneDark: 0xb9aa8d,
  roof: 0xa8392c, roofTile: 0x8c2d24, roofEdge: 0xfff0d2, glass: 0x86bccd, door: 0x6a3f2b,
  brass: 0xe3b95c, clockFace: 0xfff8e8, clockRim: 0x8c2d24, hand: 0x3d2d24, copper: 0x5fa392, shutter: 0x4f7f8a,
};

export const CITY_HALL_SIGNS = Object.freeze([
  { text: 'МЭРИЯ', x: 0, y: 7.4, z: 7.43, w: 5.4, h: 0.7, color: '#7a2c24', border: '#c9533e' },
]);

export function buildCityHallGeometry() {
  const k = createPrefabKit({ seed: 10 });

  // Цоколь и корпус.
  k.slab(20.2, 0.7, 11.6, 0, 0, 0, C.stoneDark, { r: 0.12 });
  k.slab(19.6, 0.3, 11.0, 0, 0.7, 0, C.stone, { r: 0.08 });
  k.slab(18.4, 8.6, 10.4, 0, 0.9, 0, C.wall);
  // Рустованные углы: чередующиеся блоки.
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 12; i++) {
      const wide = i % 2 === 0;
      k.box(wide ? 0.95 : 0.7, 0.62, 0.36, sx * (9.2 - (wide ? 0.38 : 0.26)), 1.45 + i * 0.7, 5.24, C.trim, { r: 0.04 });
    }
  }
  // Пояс между этажами и венчающий карниз с зубчиками.
  k.box(19.0, 0.3, 10.9, 0, 4.7, 0, C.trim, { r: 0.06 });
  k.box(19.8, 0.46, 11.4, 0, 9.55, 0, C.trim, { r: 0.1 });
  k.box(19.2, 0.2, 10.8, 0, 9.18, 0, C.wallShade);
  for (let i = 0; i < 31; i++) k.box(0.28, 0.22, 0.3, -9.0 + i * 0.6, 9.0, 5.45, C.trim, { tinted: false });

  // Крыша с черепицей и часовой башенкой на коньке.
  k.gableRoof({ w: 21.6, d: 12.2, rise: 3.5, y: 9.78, color: C.roof, edge: C.roofEdge, ridge: C.roofTile, tiles: C.roofTile, courses: 8 });
  k.slab(3.6, 2.2, 3.6, 0, 12.0, 0, C.wall, { r: 0.1 });
  k.box(4.1, 0.3, 4.1, 0, 14.1, 0, C.trim, { r: 0.08 });
  k.cone(2.6, 2.0, 4, 0, 15.25, 0, C.copper, { rot: [0, Math.PI / 4, 0] });
  k.sphere(0.24, 0, 16.4, 0, C.brass, { w: 8, h: 6 });
  k.cyl(0.05, 0.05, 0.7, 5, 0, 16.9, 0, C.brass);
  for (const dir of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    k.at([dir[0] * 1.82, 13.0, dir[1] * 1.82], Math.atan2(dir[0], dir[1]), () => {
      k.cyl(0.8, 0.8, 0.12, 28, 0, 0, 0, C.clockRim, { rot: [Math.PI / 2, 0, 0] });
      k.cyl(0.66, 0.66, 0.12, 28, 0, 0, 0.05, C.clockFace, { rot: [Math.PI / 2, 0, 0], tinted: false });
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        k.box(0.05, i % 3 === 0 ? 0.16 : 0.09, 0.04, Math.sin(a) * 0.55, Math.cos(a) * 0.55, 0.13, C.hand, { rot: [0, 0, -a], tinted: false });
      }
      k.box(0.07, 0.46, 0.05, 0, 0.18, 0.14, C.hand, { tinted: false });
      k.box(0.34, 0.06, 0.05, 0.14, -0.03, 0.14, C.hand, { rot: [0, 0, 0.4], tinted: false });
    });
  }

  // Входная группа: ступени, колонны, антаблемент, фронтон с эмблемой.
  k.slab(8.6, 0.32, 3.6, 0, 0.9, 6.0, C.stone, { r: 0.08 });
  k.slab(7.8, 0.3, 3.0, 0, 1.22, 5.9, C.stone, { r: 0.08 });
  k.slab(7.2, 0.28, 2.6, 0, 1.52, 5.8, C.stone, { r: 0.08 });
  for (const x of [-2.7, -0.9, 0.9, 2.7]) {
    k.cyl(0.4, 0.46, 0.34, 14, x, 2.0, 6.0, C.stoneDark);
    k.cyl(0.32, 0.38, 4.5, 16, x, 4.4, 6.0, C.trim);
    k.cyl(0.46, 0.34, 0.3, 14, x, 6.75, 6.0, C.stoneDark);
    k.box(1.0, 0.18, 1.0, x, 6.98, 6.0, C.trim, { r: 0.05 });
  }
  k.box(8.2, 0.55, 2.9, 0, 7.4, 5.9, C.trim, { r: 0.08 });
  k.box(8.5, 0.18, 3.1, 0, 7.75, 5.95, C.stone, { r: 0.05 });
  k.prism(8.6, 2.9, 1.7, 0, 7.8, 5.95, C.wall);
  k.prism(9.0, 0.3, 1.95, 0, 7.72, 7.45, C.trim);
  k.cyl(0.55, 0.55, 0.16, 22, 0, 8.6, 7.52, C.brass, { rot: [Math.PI / 2, 0, 0] });
  k.cyl(0.4, 0.4, 0.16, 22, 0, 8.6, 7.58, C.roof, { rot: [Math.PI / 2, 0, 0] });
  k.sphere(0.2, 0, 8.6, 7.68, C.roofEdge, { w: 8, h: 6 });

  // Центральные двери, фонари и вазоны.
  k.door(0, 3.4, 5.2, { w: 2.9, h: 3.1, leaf: C.door, frame: C.trim, handle: C.brass });
  for (const x of [-3.7, 3.7]) {
    k.box(0.22, 0.5, 0.22, x, 3.3, 5.45, C.brass, { tinted: false });
    k.sphere(0.2, x, 3.0, 5.45, 0xffe9a8, { w: 7, h: 6, tinted: false });
    k.box(0.34, 0.12, 0.34, x, 3.65, 5.45, C.stoneDark);
  }
  for (const x of [-4.6, 4.6]) {
    k.cyl(0.4, 0.3, 0.7, 10, x, 2.0, 7.0, C.stoneDark);
    k.sphere(0.5, x, 2.55, 7.0, 0x5f9a64, { w: 8, h: 6 });
    for (let i = 0; i < 4; i++) k.sphere(0.12, x + Math.cos(i * 1.6) * 0.35, 2.75 + (i % 2) * 0.1, 7.0 + Math.sin(i * 1.6) * 0.35, [0xf4b6c2, 0xfff0b8, 0xc7b5f4, 0xffc27a][i], { w: 5, h: 4, tinted: false });
  }

  // Окна по бокам портика: два этажа, ставни и подоконники.
  const row = (y, h, sx) => {
    for (const x of [5.5, 7.7]) k.window(sx * x, y, 5.2, { w: 1.5, h, glass: C.glass, frame: C.trim, sill: C.stone, lintel: C.stone, shutters: y > 4 ? C.shutter : null });
  };
  for (const sx of [-1, 1]) {
    row(2.95, 2.4, sx);
    row(6.9, 2.3, sx);
  }
  // Бока и задняя стена: те же окна.
  for (const [pos, rot, xs] of [[[9.2, 0, 0], Math.PI / 2, [-3, 0, 3]], [[-9.2, 0, 0], -Math.PI / 2, [-3, 0, 3]], [[0, 0, -5.2], Math.PI, [-6.6, -3.3, 0, 3.3, 6.6]]]) {
    k.at(pos, rot, () => {
      for (const x of xs) {
        k.window(x, 2.95, 0, { w: 1.5, h: 2.4, glass: C.glass, frame: C.trim, sill: C.stone });
        k.window(x, 6.9, 0, { w: 1.5, h: 2.3, glass: C.glass, frame: C.trim, sill: C.stone, lintel: C.stone });
      }
    });
  }
  return k.build({ groundAO: { height: 2.2, strength: 0.32 }, bands: [{ y0: 8.7, y1: 9.15, strength: 0.18 }] });
}

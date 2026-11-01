import * as THREE from 'three';
import { createPrefabKit } from '../../engine/art/prefab-kit.js';
import { PALETTE } from '../../engine/art/palette.js';
import { stdMat } from '../../engine/art/materials.js';
import { QUALITY_PRESETS } from '../../engine/art/quality.js';
import { ROOM } from './layout.js';
import { addPastryDisplays } from './patisserie.js';

const color = (value) => Number.parseInt(value.replace('#', ''), 16);
const C = {
  cream: color(PALETTE.plaster), pale: color(PALETTE.trim), peach: 0xe8b491,
  floor: color(PALETTE.plasterShade), tile: color(PALETTE.paver), wood: color(PALETTE.wood),
  darkWood: color(PALETTE.woodDark), brick: color(PALETTE.brick), roof: color(PALETTE.roof),
  glass: 0xcbd6c8, windowGlass: 0xb9d4d8, water: 0xadd5df,
  bread: 0xb87939, pastry: 0xdca45e, egg: 0xf8edcf,
  green: color(PALETTE.green), gold: color(PALETTE.yellow), chalk: color(PALETTE.charcoal),
};

/** Статичная внутренняя оболочка и крупное оборудование, сведённые в одну vertex-color геометрию. */
export function buildBakeryInteriorGeometry({ detail = true, includeBase = true } = {}) {
  const k = createPrefabKit({ seed: detail ? 54 : 53, tint: 0.025 });
  const width = ROOM.maxX - ROOM.minX;
  const depth = ROOM.maxZ - ROOM.minZ;
  const midX = (ROOM.minX + ROOM.maxX) / 2;
  const midZ = (ROOM.minZ + ROOM.maxZ) / 2;

  if (includeBase) {
  // Тёплый пол, четыре стены и потолок образуют цельный интерьер без щелей на стыках.
  k.slab(width, 0.24, depth, midX, -0.24, midZ, C.floor, { r: 0.06 });
  k.slab(width, ROOM.wallHeight, 0.32, midX, 0, ROOM.minZ + 0.16, C.cream, { r: 0.08 });
  k.slab(0.32, ROOM.wallHeight, depth, ROOM.minX + 0.16, 0, midZ, C.cream, { r: 0.08 });
  k.slab(0.32, ROOM.wallHeight, depth, ROOM.maxX - 0.16, 0, midZ, C.cream, { r: 0.08 });
  k.slab(5.2, ROOM.wallHeight, 0.32, -5.9, 0, ROOM.maxZ - 0.16, C.cream, { r: 0.06 });
  k.slab(5.2, ROOM.wallHeight, 0.32, 5.9, 0, ROOM.maxZ - 0.16, C.cream, { r: 0.06 });
  k.slab(1.78, 3.55, 0.32, -2.41, 0, ROOM.maxZ - 0.16, C.cream, { r: 0.05 });
  k.slab(1.78, 3.55, 0.32, 2.41, 0, ROOM.maxZ - 0.16, C.cream, { r: 0.05 });
  k.slab(6.6, 2.05, 0.32, 0, 3.55, ROOM.maxZ - 0.16, C.cream, { r: 0.06 });
  k.slab(width, 0.42, depth, midX, 5.24, midZ, C.pale, { r: 0.08 });
  // Обои имеют собственную глубину и остаются за рамами окон и настенным декором.
  k.box(16.3, 2.95, 0.02, 0, 3.56, -6.15, 0xf5d1d9);
  for (const x of [-8.16, 8.16]) k.box(0.02, 2.05, 12.1, x, 4.06, 0, 0xf5d1d9);
  for (let x = -7.8; x <= 7.8; x += 0.9) k.box(0.055, 2.9, 0.012, x, 3.56, -6.13, 0xffe9e5);
  for (const x of [-8.14, 8.14]) for (let z = -5.7; z <= 5.7; z += 0.9) {
    k.box(0.012, 2.0, 0.055, x, 4.06, z, 0xffe9e5);
  }
  // Кремовая обшивка отделяет стены от каменного пола и закрывает стыки по периметру.
  k.box(width - 0.4, 0.22, 0.12, 0, 0.2, ROOM.minZ + 0.31, C.wood, { r: 0.035 });
  k.box(0.12, 0.22, depth - 0.5, ROOM.minX + 0.31, 0.2, 0, C.wood, { r: 0.035 });
  k.box(0.12, 0.22, depth - 0.5, ROOM.maxX - 0.31, 0.2, 0, C.wood, { r: 0.035 });
  k.box(width - 0.75, 0.1, 0.14, 0, 1.22, ROOM.minZ + 0.3, C.peach, { r: 0.025 });
  k.box(0.14, 0.1, depth - 0.85, ROOM.minX + 0.3, 1.22, 0, C.peach, { r: 0.025 });
  k.box(0.14, 0.1, depth - 0.85, ROOM.maxX - 0.3, 1.22, 0, C.peach, { r: 0.025 });
  for (const x of [-7.7, -5.3, 5.3, 7.7]) {
    k.box(0.14, 1.05, 0.12, x, 0.72, ROOM.minZ + 0.29, C.peach, { r: 0 });
  }
  for (const x of [ROOM.minX + 0.30, ROOM.maxX - 0.30]) {
    for (const z of [-4.65, -1.65, 1.35, 4.35]) {
      k.box(0.08, 1.72, 2.24, x, 2.15, z, C.cream, { r: 0 });
      k.box(0.12, 0.08, 2.3, x, 1.27, z, C.wood, { r: 0.025 });
    }
    k.box(0.12, 0.08, depth - 0.85, x, 3.03, 0, C.wood, { r: 0.025 });
  }
  // Парные окна утоплены в стену: отдельные стёкла, деревянные переплёты и опорные подоконники.
  for (const { wallX, paneX, inside, z } of [
    { wallX: -8.15, paneX: -8.02, inside: 1, z: -3.0 },
    { wallX: 8.15, paneX: 8.02, inside: -1, z: -3.65 },
  ]) {
    k.box(0.12, 1.52, 2.18, wallX, 3.72, z, C.peach, { r: 0.05 });
    const frameX = wallX + inside * 0.11;
    for (const dz of [-0.96, 0, 0.96]) k.box(0.2, 1.42, 0.11, frameX, 3.72, z + dz, C.darkWood, { r: 0.025 });
    for (const y of [3.0, 3.72, 4.44]) for (const dz of [-0.48, 0.48]) {
      k.box(0.2, 0.12, 0.85, frameX, y, z + dz, C.darkWood, { r: 0.025 });
    }
    for (const dz of [-0.48, 0.48]) for (const y of [3.36, 4.08]) {
      k.box(0.055, 0.57, 0.74, paneX, y, z + dz, C.windowGlass, { r: 0.03, tinted: false });
    }
    for (const dz of [-1.08, 1.08]) k.box(0.2, 1.66, 0.16, frameX, 3.72, z + dz, C.wood, { r: 0.035 });
    for (const y of [2.88, 4.56]) k.box(0.2, 0.16, 2.32, frameX, y, z, C.wood, { r: 0.035 });
    k.box(0.42, 0.14, 2.48, frameX, 2.78, z, C.darkWood, { r: 0 });
    k.box(0.48, 0.12, 2.56, frameX, 2.86, z, C.wood, { r: 0 });
    for (const dz of [-0.86, 0.86]) k.tube([
      [frameX, 2.88, z + dz], [frameX, 2.66, z + dz], [frameX - inside * 0.18, 2.58, z + dz],
    ], 0.035, C.wood);
    k.box(0.36, 0.12, 2.38, frameX, 4.66, z, C.pale, { r: 0 });
  }
  for (const [x, z] of [[-7.94, -2.22], [7.94, -2.87]]) {
    k.cyl(0.13, 0.1, 0.18, 8, x, 3.02, z, 0xe8b491);
    k.sphere(0.18, x, 3.26, z, 0x86b99d, { s: [0.8, 1.1, 0.8], w: 7, h: 5 });
    k.sphere(0.1, x, 3.35, z, 0xa8cdb3, { w: 7, h: 5 });
  }
  // Встроенный стеллаж на правой стене собран на боковых стойках и треугольных опорах.
  for (const y of [1.55, 2.55, 3.55]) k.box(0.2, 0.12, 2.65, 8.02, y, 1.0, C.wood, { r: 0 });
  for (const z of [-0.25, 2.25]) k.box(0.14, 2.2, 0.14, 8.02, 2.65, z, C.darkWood, { r: 0 });
  for (const y of [1.62, 2.62, 3.62]) for (const z of [-0.12, 2.12]) k.tube([
    [7.94, y - 0.34, z], [7.94, y - 0.1, z], [7.77, y - 0.1, z],
  ], 0.035, C.darkWood);
  k.box(0.22, 0.18, 2.9, 8.02, 4.1, 1.0, C.pale, { r: 0 });
  for (const z of [-4.5, -1.5, 1.5, 4.5]) k.box(width - 0.6, 0.12, 0.2, 0, 5.2, z, C.wood, { r: 0 });

  // Подвесные светильники объединяют рабочие места, не занимая проходы.
  for (const [x, z] of [[-6.2, 0.5], [0, -4.3], [5, -0.4]]) {
    k.cyl(0.025, 0.025, 0.62, 6, x, 4.83, z, C.darkWood);
    k.cyl(0.12, 0.38, 0.28, 10, x, 4.4, z, C.green);
    k.cyl(0.29, 0.29, 0.035, 10, x, 4.25, z, C.pale);
  }

  // Иллюстрированные рамки на задней стене, без плоскостей на одной глубине.
  for (const x of [-5.3, 5.3]) {
    k.box(1.48, 1.3, 0.12, x, 3.8, -6.05, C.wood, { r: 0.05 });
    k.box(1.25, 1.08, 0.07, x, 3.8, -5.95, C.pale, { r: 0 });
  }
  // Пирожное и хлеб служат простыми иллюстрациями, читаемыми из комнаты.
  k.cyl(0.26, 0.18, 0.32, 9, -5.3, 3.63, -5.87, 0xe99a9b);
  k.sphere(0.25, -5.3, 3.92, -5.86, 0xfff0e5, { s: [1, 0.7, 0.3], w: 8, h: 5 });
  k.sphere(0.08, -5.3, 4.12, -5.84, 0xc7505b, { w: 7, h: 5 });
  k.sphere(0.27, 5.3, 3.8, -5.85, C.bread, { s: [1.65, 0.65, 0.35], w: 8, h: 5 });
  for (const x of [5.1, 5.3, 5.5]) k.box(0.05, 0.15, 0.035, x, 3.83, -5.73, C.pale, { rot: [0, 0, -0.45] });

  // Входная группа: кремовые пилястры и деревянное обрамление в масштабе персонажа.
  for (const x of [-3.18, 3.18]) {
    k.box(0.34, 4.6, 0.48, x, 2.3, 6.13, C.pale, { r: 0.06 });
    k.box(0.5, 0.22, 0.62, x, 4.72, 6.08, C.wood, { r: 0.05 });
    k.box(0.5, 0.28, 0.62, x, 0.16, 6.08, C.wood, { r: 0.05 });
  }
  // Две створки: деревянные переплёты, нижние панели и отдельные стеклянные поля.
  for (const x of [-1.5, 1.5]) k.box(0.15, 2.7, 0.3, x, 1.35, 5.94, C.wood, { r: 0.035 });
  for (const x of [-0.66, 0.66]) {
    k.box(1.28, 2.48, 0.18, x, 1.28, 6.02, C.wood, { r: 0.045 });
    k.box(0.96, 1.38, 0.08, x, 1.67, 5.9, C.glass, { r: 0.04, tinted: false });
    k.box(0.96, 0.54, 0.09, x, 0.48, 5.89, C.peach, { r: 0.035 });
    k.box(0.96, 0.09, 0.1, x, 0.83, 5.86, C.pale, { r: 0.025 });
    k.box(1.08, 0.12, 0.13, x, 2.44, 5.85, C.pale, { r: 0 });
    const handleX = x + (x < 0 ? 0.44 : -0.44);
    k.sphere(0.065, handleX, 1.12, 5.79, C.gold, { w: 7, h: 5 });
    k.tube([[handleX, 0.94, 5.78], [handleX, 1.3, 5.78]], 0.025, C.gold);
  }
  k.box(3.02, 0.18, 0.38, 0, 2.65, 5.96, C.wood, { r: 0.045 });
  // Тёплая фрамуга с тремя светлыми стеклянными секциями.
  k.box(2.68, 0.48, 0.1, 0, 3.0, 5.88, C.glass, { r: 0.035, tinted: false });
  for (const x of [-1.42, 0, 1.42]) k.box(0.09, 0.52, 0.14, x, 3.0, 5.82, C.pale, { r: 0.02 });
  k.box(3.02, 0.14, 0.28, 0, 3.29, 5.9, C.wood, { r: 0.035 });
  // Небольшая эмблема-батон вместо крупного технического декора.
  k.sphere(0.3, 0, 3.43, 5.72, C.bread, { s: [1.5, 0.5, 0.3], w: 8, h: 5 });
  for (const x of [-0.22, 0, 0.22]) k.tube([[x - 0.045, 3.44, 5.48], [x + 0.045, 3.52, 5.48]], 0.018, C.pale);
  k.box(3.5, 0.08, 0.72, 0, 0.04, 5.54, C.tile, { r: 0.035 });

  // Пекарская вывеска и верхняя стеновая полка разбивают пустое поле кладки.
  k.box(4.8, 1.05, 0.16, 0, 4.18, -6.12, C.wood, { r: 0.08 });
  k.box(4.48, 0.76, 0.1, 0, 4.18, -6.0, C.pale, { r: 0.06 });
  k.sphere(0.38, -1.35, 4.18, -5.9, C.bread, { s: [1.4, 0.52, 0.35], w: 8, h: 5 });
  for (const x of [1.15, 1.65, 2.15]) k.sphere(0.25, x, 4.12, -5.88, C.pastry, { s: [1.0, 0.62, 0.38], w: 7, h: 5 });
  k.box(6.6, 0.12, 0.48, 0, 2.8, -6.05, C.wood, { r: 0.05 });
  for (const x of [-2.75, 2.75]) k.tube([[x, 2.18, -5.95], [x, 2.5, -5.95], [x, 2.72, -5.77]], 0.045, C.darkWood);
  // Рамки и невысокая обшивка добавляют ритм задней стене, не забивая её декором.
  k.box(15.8, 0.1, 0.14, 0, 1.18, -6.08, C.wood, { r: 0.025 });
  k.box(15.8, 0.1, 0.14, 0, 2.15, -6.08, C.wood, { r: 0.025 });
  for (const x of [-7.2, -4.8, 4.8, 7.2]) k.box(0.1, 0.88, 0.12, x, 1.66, -6.08, C.peach, { r: 0.025 });
  k.box(0.12, 5.6, 0.16, 0, 3.0, -6.12, C.peach);
  k.box(16.5, 0.18, 0.2, 0, 5.45, -6.12, C.pale, { r: 0 });

  // Ингредиентная стойка. Рабочая зона игрока находится перед ней, у прохода.
  k.slab(2.3, 0.18, 1.25, -6.2, 0.92, 0.53, C.wood, { r: 0.06 });
  for (const x of [-7.1, -5.3]) k.slab(0.14, 0.92, 0.14, x, 0, 0.53, C.darkWood, { r: 0 });
  k.box(2.1, 0.3, 0.1, -6.2, 0.54, 1.16, C.peach, { r: 0 });
  k.box(2.18, 0.08, 1.18, -6.2, 1.08, 0.53, C.pale, { r: 0 });
  // Четыре ингредиента на виду: вода, молоко, яйца и соль.
  k.cyl(0.105, 0.14, 0.27, 10, -7.0, 1.245, 0.43, C.water, { r: 0.025 });
  k.cyl(0.14, 0.105, 0.09, 10, -7.0, 1.425, 0.43, C.water);
  k.cyl(0.065, 0.085, 0.13, 9, -7.0, 1.535, 0.43, C.water);
  k.cyl(0.07, 0.085, 0.06, 9, -7.0, 1.63, 0.43, C.pale);
  k.cyl(0.07, 0.085, 0.055, 9, -7.0, 1.685, 0.43, C.gold);
  k.tube([[-7.1, 1.35, 0.55], [-7.2, 1.4, 0.55], [-7.2, 1.58, 0.55], [-7.1, 1.62, 0.55]], 0.025, C.pale);
  k.cyl(0.135, 0.14, 0.3, 10, -6.38, 1.25, 0.43, C.pale, { r: 0.035 });
  k.cyl(0.14, 0.09, 0.08, 10, -6.38, 1.44, 0.43, C.pale);
  k.cyl(0.07, 0.085, 0.13, 9, -6.38, 1.545, 0.43, C.pale);
  k.cyl(0.075, 0.09, 0.07, 8, -6.38, 1.645, 0.43, C.wood);
  k.tube([[-6.25, 1.38, 0.53], [-6.18, 1.43, 0.53], [-6.18, 1.55, 0.53], [-6.25, 1.59, 0.53]], 0.025, C.wood);
  k.box(0.19, 0.1, 0.035, -6.38, 1.27, 0.56, C.peach, { r: 0.02 });
  k.box(0.62, 0.08, 0.42, -5.77, 1.15, 0.43, C.wood, { r: 0.045 });
  for (const x of [-5.98, -5.77, -5.56]) k.box(0.035, 0.1, 0.42, x, 1.22, 0.43, C.pale, { r: 0.012 });
  for (const z of [0.3, 0.55]) k.box(0.62, 0.1, 0.035, -5.77, 1.22, z, C.pale, { r: 0.012 });
  for (const [x, z] of [[-5.98, 0.3], [-5.77, 0.3], [-5.56, 0.3], [-5.98, 0.55], [-5.77, 0.55], [-5.56, 0.55]]) {
    k.sphere(0.105, x, 1.27, z, C.egg, { s: [0.82, 1.05, 0.82], w: 7, h: 5 });
  }
  k.cyl(0.095, 0.12, 0.22, 8, -5.2, 1.24, 0.43, C.pale);
  k.cyl(0.105, 0.11, 0.045, 8, -5.2, 1.37, 0.43, C.wood);
  k.cyl(0.055, 0.075, 0.06, 8, -5.2, 1.42, 0.43, C.gold);
  for (const [dx, dz] of [[-0.025, 0], [0.025, 0], [0, 0.035]]) k.sphere(0.012, -5.2 + dx, 1.456, 0.43 + dz, C.chalk, { w: 5, h: 3 });
  // Низкая стойка наставника обозначает место беседы и оставляет игроку свободный подход.
  k.slab(1.75, 0.12, 0.55, -6.2, 0.92, 2.48, C.wood, { r: 0.05 });
  for (const x of [-6.9, -5.5]) k.slab(0.12, 0.92, 0.12, x, 0, 2.48, C.darkWood, { r: 0 });

  // Стол замеса и формовки.
  k.slab(3.3, 0.18, 1.25, 0, 0.95, -4.62, C.wood, { r: 0.07 });
  for (const x of [-1.42, 1.42]) for (const z of [-5.05, -4.19]) k.slab(0.14, 0.95, 0.14, x, 0, z, C.darkWood, { r: 0 });
  k.box(3.02, 0.34, 0.1, 0, 0.68, -3.99, C.peach, { r: 0 });
  k.box(3.12, 0.08, 1.16, 0, 1.08, -4.62, C.pale, { r: 0 });
  k.cyl(0.42, 0.42, 0.12, 12, -0.75, 1.12, -4.58, C.pale);
  k.cyl(0.31, 0.31, 0.1, 12, 0.8, 1.12, -4.58, C.gold);
  k.box(0.85, 0.09, 0.12, 0, 1.09, -4.18, C.darkWood, { r: 0 }); // скалка

  // Закрытая печь: цельный корпус, тёмное окно и ручки; никаких игровых опасных состояний.
  k.slab(2.4, 2.15, 1.45, 5, 0, -1.15, C.brick, { r: 0.1 });
  k.box(1.72, 1.42, 0.16, 5, 1.65, -0.43, C.wood, { r: 0.1 });
  k.box(1.44, 1.12, 0.12, 5, 1.65, -0.31, 0x5d3933, { r: 0.08 });
  k.box(0.1, 0.34, 0.15, 5.69, 1.6, -0.24, C.gold, { r: 0.035 });
  k.box(0.85, 0.07, 0.12, 5, 2.28, -0.2, C.gold, { r: 0.02 });
  for (const x of [4.68, 5.0, 5.32]) k.sphere(0.055, x, 2.34, -0.13, C.darkWood, { w: 6, h: 4 });
  k.cyl(0.065, 0.08, 0.08, 8, 5.0, 2.58, -0.25, C.brick);
  k.box(2.65, 0.16, 1.65, 5, 2.48, -1.15, C.pale, { r: 0.06 });
  k.box(2.5, 0.26, 1.55, 5, 0.18, -1.15, C.darkWood, { r: 0.06 });
  k.box(0.42, 1.12, 0.38, 5.12, 3.04, -1.15, C.brick, { r: 0.06 });
  k.box(0.58, 0.14, 0.54, 5.12, 3.66, -1.15, C.wood, { r: 0.045 });
  for (const y of [3.12, 3.35]) k.box(0.22, 0.045, 0.08, 5.12, y, -0.92, C.darkWood, { r: 0.015 });
  // Видимые противни и хлеб в окне печи.
  for (const y of [1.12, 1.68]) {
    k.box(1.2, 0.055, 0.72, 5, y, -0.31, C.darkWood, { r: 0.025 });
    for (const x of [4.68, 5.0, 5.32]) k.sphere(0.12, x, y + 0.12, -0.3, C.pastry, { s: [1.25, 0.6, 0.75], w: 6, h: 4 });
  }

  // Полка охлаждения и стойка выдачи — отдельные, с широким проходом между ними.
  for (const x of [4.15, 6.05]) k.slab(0.12, 2.5, 0.12, x, 0, 4.8, C.darkWood, { r: 0 });
  for (const y of [0.85, 1.65, 2.45]) k.box(2.05, 0.12, 0.95, 5.1, y, 4.8, C.wood, { r: 0.05 });
  addPastryDisplays(k);
  // Лотки и пакеты остаются внутри существующих границ стеллажа.
  for (const x of [4.4, 5.8]) {
    k.box(0.3, 0.38, 0.22, x, 1.16, 5.1, 0xe8c39d, { r: 0.025 });
    k.box(0.18, 0.045, 0.03, x, 1.22, 4.975, C.peach);
  }
  k.slab(2.8, 1.05, 1.0, -3.4, 0.25, 5.7, C.wood, { r: 0.08 });
  k.box(2.55, 0.15, 0.82, -3.4, 1.37, 5.7, C.pale, { r: 0.06 });
  for (const x of [-4.55, -2.25]) k.slab(0.13, 1.25, 0.13, x, 0, 5.7, C.darkWood, { r: 0 });
  // Витрина прилавка с открытым фасадом, бумажные пакеты и булочки для выдачи.
  for (const x of [-4.42, -2.38]) k.box(0.08, 0.66, 0.58, x, 1.82, 5.64, C.glass, { r: 0.03, tinted: false });
  k.box(2.08, 0.06, 0.54, -3.4, 2.16, 5.64, C.glass, { r: 0.03, tinted: false });
  k.box(2.08, 0.06, 0.12, -3.4, 1.52, 5.87, C.wood, { r: 0.025 });
  k.box(2.24, 0.1, 0.68, -3.4, 1.42, 5.64, C.wood, { r: 0 });

  for (const x of [-4.2, -2.6]) {
    k.box(0.34, 0.4, 0.08, x, 1.24, 5.1, C.pale, { r: 0 });
    k.box(0.36, 0.05, 0.09, x, 1.46, 5.1, C.gold, { r: 0.02 });
  }

  // Плиточная дорожка связывает вход, ингредиенты, формовку, печь и выдачу.
  k.flatShape([
    [-1.4, -3.3], [2.3, -3.3], [2.3, -0.2], [6.8, -0.2],
    [6.8, 4.0], [3.2, 4.0], [3.2, 3.4], [6.2, 3.4], [6.2, 0.65],
    [1.4, 0.65], [1.4, 5.6], [-1.4, 5.6], [-1.4, 4.5], [-3.8, 4.5],
    [-3.8, 3.3], [-1.4, 3.3], [-1.4, 1.2], [-4.8, 1.2], [-4.8, -0.2], [-1.4, -0.2],
  ], 0.005, 0.018, C.tile);
  }

  if (detail) {
    // Мешки с мукой хранятся отдельно от подготовленных ингредиентов; завязки и метки дают им форму мешков.
    for (const [x, z, scale] of [[-7.78, 1.45, 1], [-7.78, 2.08, 0.82], [-7.75, 2.62, 0.72]]) {
      k.sphere(0.34, x, 0.34, z, C.pale, { s: [scale, 0.85, 0.76], w: 8, h: 5 });
      k.sphere(0.12, x, 0.61, z, C.wood, { s: [0.55, 1.0, 0.55], w: 6, h: 4 });
      k.tube([[x - 0.1, 0.57, z], [x, 0.64, z], [x + 0.1, 0.57, z]], 0.018, C.gold, { segments: 6, radial: 4 });
      k.box(0.14, 0.1, 0.025, x, 0.3, z + 0.24, C.peach, { r: 0.015 });
    }
    k.box(0.55, 0.07, 0.14, -3.4, 1.5, 5.22, C.bread, { r: 0 }); // бумага для упаковки
    k.sphere(0.3, -0.1, 1.25, -4.55, C.pale, { s: [1.1, 0.52, 0.88], w: 8, h: 5 });
    for (const x of [-0.72, 0.0, 0.72]) k.sphere(0.12, x, 1.36, -4.55, C.pastry, { s: [1, 0.65, 0.8], w: 6, h: 4 });
    // Бумажные свёртки и подвесная утварь делают рабочее место обжитым.
    for (const x of [-1.0, 0, 1.0]) k.box(0.28, 0.38, 0.26, x, 1.42, -4.48, C.pale, { r: 0.05 });
    k.box(0.8, 0.06, 0.1, -6.1, 1.8, 0.5, C.darkWood, { r: 0.025 });
    for (const x of [-6.38, -5.82]) k.tube([[x, 1.78, 0.5], [x, 1.52, 0.5]], 0.025, C.gold);
    // Две маленькие настенные эмблемы над рабочими зонами.
    k.box(0.08, 0.72, 0.82, ROOM.minX + 0.28, 3.48, -2.2, C.wood, { r: 0.06 });
    k.sphere(0.24, ROOM.minX + 0.38, 3.48, -2.2, C.pastry, { s: [0.3, 1.35, 0.72], w: 7, h: 5 });
    k.box(0.08, 0.72, 0.82, ROOM.maxX - 0.28, 3.48, 1.5, C.wood, { r: 0.06 });
    k.sphere(0.24, ROOM.maxX - 0.38, 3.48, 1.5, C.bread, { s: [0.3, 1.35, 0.72], w: 7, h: 5 });
  }

  return k.build({ groundAO: { height: 2, strength: 0.28 }, bands: [{ y0: 5.25, y1: 5.55, strength: 0.12 }] });
}

/** Создаёт общий интерьер, цель-маркер и ресурсы с полным локальным lifecycle. */
export function createBakeryInterior({ quality = 'medium' } = {}) {
  const group = new THREE.Group();
  group.name = 'bakery-interior';
  const material = stdMat(0xffffff, { vertexColors: true, roughness: 0.88 });
  const baseGeometry = buildBakeryInteriorGeometry({ detail: false, includeBase: true });
  const detailGeometry = buildBakeryInteriorGeometry({ detail: true, includeBase: false });
  const base = new THREE.Mesh(baseGeometry, material);
  const detail = new THREE.Mesh(detailGeometry, material);
  base.castShadow = detail.castShadow = true;
  base.receiveShadow = detail.receiveShadow = true;
  base.name = 'bakery-static';
  detail.name = 'bakery-detail';
  group.add(base, detail);

  const productMaterial = material;
  const makeProduct = (stage, seed, productColor, scale, position) => {
    const kit = createPrefabKit({ seed, tint: 0.02 });
    kit.sphere(0.34, 0, 0, 0, productColor, { s: scale, w: 9, h: 6 });
    const geometry = kit.build({ groundAO: null, underside: 1 });
    const mesh = new THREE.Mesh(geometry, productMaterial);
    mesh.position.set(...position);
    mesh.visible = false;
    mesh.name = `bakery-product-${stage}`;
    group.add(mesh);
    return mesh;
  };
  const dough = makeProduct('dough', 61, C.pale, [1.25, 0.75, 0.9], [0, 1.55, -4.58]);
  const loaf = makeProduct('loaf', 62, C.bread, [1.45, 0.8, 0.86], [5.05, 1.55, 4.78]);

  const markerGroup = new THREE.Group();
  const ringGeometry = new THREE.RingGeometry(0.72, 0.86, 28);
  ringGeometry.rotateX(-Math.PI / 2);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: PALETTE.yellow, transparent: true, opacity: 0.76, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.position.y = 0.035;
  const diamondGeometry = new THREE.OctahedronGeometry(0.2, 0);
  const diamondMaterial = new THREE.MeshBasicMaterial({ color: PALETTE.orange });
  const diamond = new THREE.Mesh(diamondGeometry, diamondMaterial);
  diamond.position.y = 2.6;
  markerGroup.add(ring, diamond);
  markerGroup.visible = false;
  group.add(markerGroup);

  let currentQuality = QUALITY_PRESETS[quality] ? quality : 'medium';
  let currentStage = 'waiting_order';
  const setQuality = (level) => {
    currentQuality = QUALITY_PRESETS[level] ? level : 'medium';
    detail.visible = currentQuality !== 'low';
    dough.visible = currentStage === 'product_shaped';
    loaf.visible = currentStage === 'product_baked' || currentStage === 'product_ready';
    markerGroup.visible = Boolean(markerGroup.userData.target);
    return currentQuality;
  };
  setQuality(currentQuality);
  const setStage = (stage) => {
    currentStage = stage;
    dough.visible = stage === 'product_shaped';
    loaf.visible = stage === 'product_baked' || stage === 'product_ready';
    if (stage === 'product_ready') loaf.position.set(-2.75, 1.55, 5.53);
    else loaf.position.set(5.05, 1.55, 4.78);
  };
  setStage(currentStage);

  return {
    group,
    setQuality,
    setStage,
    setTarget(position) {
      markerGroup.userData.target = position;
      markerGroup.visible = Boolean(position);
      if (position) markerGroup.position.set(position.x, 0, position.z);
    },
    update(_dt, elapsed) {
      if (markerGroup.visible) {
        const pulse = 1 + Math.sin(elapsed * 3.1) * 0.055;
        ring.scale.setScalar(pulse);
        ringMaterial.opacity = 0.58 + Math.sin(elapsed * 3.1) * 0.17;
        diamond.position.y = 2.6 + Math.sin(elapsed * 2.3) * 0.11;
        diamond.rotation.y = elapsed * 1.4;
      }
    },
    dispose() {
      group.removeFromParent();
      baseGeometry.dispose();
      detailGeometry.dispose();
      dough.geometry.dispose();
      loaf.geometry.dispose();
      ringGeometry.dispose();
      ringMaterial.dispose();
      diamondGeometry.dispose();
      diamondMaterial.dispose();
    },
  };
}

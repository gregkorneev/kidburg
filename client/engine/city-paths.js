// Дорожки города: заменяют единый placeholder 8×8. Размеры берутся из tools/build-world/layout.js (PATHS), а в мире
// все сегменты имеют один ID, поэтому вариант выбирается по положению инстанса. Подложка лежит НИЖЕ мощения
// площади и подъездов (верх 0.06 против 0.1), поэтому z-fighting исключён: это утоптанная песчаная дорожка
// с мелкой галькой, которая выглядит как «живой» путь рядом с мощёными подъездами.
import { createPrefabKit } from './art/prefab-kit.js';
import { PATHS } from '../../tools/build-world/layout.js';

const COLORS = { sand: 0xe8d6a8, sandDark: 0xd9c392, pebble: [0xf4ead2, 0xcfc3a6, 0xe3d5b2] };

const hash = (i) => {
  let h = Math.imul(i + 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** ID дорожки по координатам инстанса или null, если сегмент неизвестен. */
export function pathIdAt(x, z) {
  return PATHS.find((p) => Math.abs(p.x - x) < 0.01 && Math.abs(p.z - z) < 0.01)?.id ?? null;
}

export function buildPathGeometry({ width, depth }) {
  const kit = createPrefabKit({ seed: Math.round(width * 31 + depth) });
  kit.slab(width, 0.06, depth, 0, 0, 0, COLORS.sand, { r: 0.02 });
  // Тёмные полосы колеи вдоль длинной стороны.
  const alongX = width >= depth;
  const lanes = Math.max(1, Math.round((alongX ? depth : width) / 1.6));
  for (let i = 0; i < lanes; i++) {
    const offset = ((i + 0.5) / lanes - 0.5) * (alongX ? depth : width);
    if (alongX) kit.box(width - 0.3, 0.012, 0.5, 0, 0.063, offset, COLORS.sandDark, { tinted: false });
    else kit.box(0.5, 0.012, depth - 0.3, offset, 0.063, 0, COLORS.sandDark, { tinted: false });
  }
  // Мелкая галька.
  const count = Math.min(90, Math.round(width * depth * 0.9));
  for (let i = 0; i < count; i++) {
    const x = (hash(i * 3) - 0.5) * (width - 0.4);
    const z = (hash(i * 3 + 1) - 0.5) * (depth - 0.4);
    kit.sphere(0.04 + hash(i * 3 + 2) * 0.03, x, 0.052, z, COLORS.pebble[i % 3], { s: [1.3, 0.5, 1], w: 5, h: 4 });
  }
  return kit.build({ groundAO: null, underside: 1 });
}

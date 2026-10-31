// Растения и городская мебель в стиле Kidburg: деревья трёх форм, кусты, клумбы, фонари, урны, указатели.
// Все функции добавляют детали в createPrefabKit(): одна вершинно-окрашенная геометрия на префаб.
import { createPrefabKit } from './prefab-kit.js';

export const FLORA_COLORS = Object.freeze({
  trunk: 0x9a6b47, trunkDark: 0x7a5238, birch: 0xf2ead8, birchMark: 0x4a4038,
  leaf: [0x5f9a64, 0x78b36c, 0x93c470, 0x4f8a5d],
  pine: [0x2f6b52, 0x3f7a5a, 0x4d8c63],
  bloom: [0xf4b6c2, 0xfff0b8, 0xffffff, 0xffc27a, 0xc7b5f4],
  stone: 0xe9dfc7, stoneDark: 0xc9bc9f, soil: 0x8f6948,
  metal: 0x2f5a60, metalDark: 0x24454a, warm: 0xffe9a8, wood: 0xb8774c, woodDark: 0x8a5a3a,
  cream: 0xfff3d8,
});

const pickFrom = (list, i) => list[Math.abs(i) % list.length];

/** Лиственное дерево: ствол с корнями и пышная крона из мягких шаров. s — масштаб. */
export function roundTree(kit, x, z, s = 1, tone = 0) {
  const { trunk, leaf } = FLORA_COLORS;
  kit.cyl(0.2 * s, 0.34 * s, 2.3 * s, 8, x, 1.15 * s, z, trunk);
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1 + tone;
    kit.sphere(0.2 * s, x + Math.cos(a) * 0.3 * s, 0.1 * s, z + Math.sin(a) * 0.3 * s, trunk, { s: [1.3, 0.6, 1.3], w: 6, h: 4 });
  }
  const blobs = [[0, 3.55, 0, 1.55], [0.85, 3.0, 0.35, 1.05], [-0.8, 3.1, -0.3, 1.1], [0.1, 4.4, -0.1, 0.95], [-0.2, 3.05, 0.85, 0.95]];
  blobs.forEach(([bx, by, bz, br], i) => kit.sphere(br * s, x + bx * s, by * s, z + bz * s, pickFrom(leaf, i + tone), { w: 9, h: 7 }));
}

/** Ель: тёмно-зелёные конусы ярусами. */
export function pineTree(kit, x, z, s = 1, tone = 0) {
  const { trunk, pine } = FLORA_COLORS;
  kit.cyl(0.16 * s, 0.26 * s, 1.4 * s, 7, x, 0.7 * s, z, trunk);
  const tiers = [[1.7, 1.9, 1.55], [1.4, 1.8, 2.7], [1.1, 1.7, 3.8], [0.75, 1.5, 4.8]];
  tiers.forEach(([r, h, y], i) => kit.cone(r * s, h * s, 8, x, y * s, z, pickFrom(pine, i + tone)));
  kit.cone(0.28 * s, 0.6 * s, 6, x, 5.85 * s, z, pickFrom(pine, tone + 2));
}

/** Берёза: светлый ствол с отметинами и лёгкая кудрявая крона. */
export function birchTree(kit, x, z, s = 1, tone = 0) {
  const { birch, birchMark, leaf } = FLORA_COLORS;
  kit.cyl(0.13 * s, 0.2 * s, 3.4 * s, 7, x, 1.7 * s, z, birch);
  for (const [y, rot] of [[0.8, 0.3], [1.5, -0.5], [2.2, 0.8]]) {
    kit.box(0.2 * s, 0.07 * s, 0.05 * s, x + 0.12 * s * Math.cos(rot), y * s, z + 0.12 * s * Math.sin(rot), birchMark, { ry: rot });
  }
  const light = [0x9bcb6b, 0x86bd68, 0xaed57a];
  [[0, 3.9, 0, 1.05], [0.6, 3.4, 0.25, 0.75], [-0.55, 3.45, -0.2, 0.78], [0.1, 4.6, 0.1, 0.65]].forEach(([bx, by, bz, br], i) => {
    kit.sphere(br * s, x + bx * s, by * s, z + bz * s, pickFrom(light, i + tone), { s: [1, 1.15, 1], w: 8, h: 6 });
  });
}

/** Куст из трёх-четырёх шаров. */
export function bush(kit, x, z, s = 1, tone = 0) {
  const { leaf } = FLORA_COLORS;
  [[0, 0.5, 0, 0.62], [0.5, 0.4, 0.15, 0.45], [-0.45, 0.42, -0.1, 0.48], [0.05, 0.62, -0.4, 0.4]].forEach(([bx, by, bz, br], i) => {
    kit.sphere(br * s, x + bx * s, by * s, z + bz * s, pickFrom(leaf, i + tone), { s: [1, 0.85, 1], w: 8, h: 6 });
  });
}

/** Один цветок: стебель, листик и пятилепестковая головка. */
export function flower(kit, x, y, z, color, s = 1) {
  const { leaf } = FLORA_COLORS;
  kit.cyl(0.025 * s, 0.03 * s, 0.4 * s, 4, x, y + 0.2 * s, z, leaf[3], { tinted: false });
  kit.sphere(0.1 * s, x + 0.07 * s, y + 0.16 * s, z, leaf[1], { s: [1.3, 0.4, 0.8], w: 5, h: 4 });
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    kit.sphere(0.075 * s, x + Math.cos(a) * 0.1 * s, y + 0.44 * s, z + Math.sin(a) * 0.1 * s, color, { s: [1, 0.55, 1], w: 5, h: 4, tinted: false });
  }
  kit.sphere(0.055 * s, x, y + 0.46 * s, z, 0xf5d86e, { w: 5, h: 4, tinted: false });
}

/** Круглая клумба-бордюр с кустиками и цветами. */
export function roundBed(kit, x, z, radius = 1.2, tone = 0) {
  const { stone, soil, bloom } = FLORA_COLORS;
  kit.cyl(radius, radius * 1.04, 0.3, 18, x, 0.15, z, stone);
  kit.cyl(radius * 1.06, radius * 1.06, 0.07, 18, x, 0.32, z, 0xf6efe0);
  kit.cyl(radius * 0.86, radius * 0.86, 0.06, 18, x, 0.31, z, soil);
  bush(kit, x - radius * 0.25, z - radius * 0.1, radius * 0.5, tone);
  const count = Math.round(radius * 5);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + tone;
    const rr = radius * (0.35 + (i % 3) * 0.17);
    flower(kit, x + Math.cos(a) * rr, 0.32, z + Math.sin(a) * rr, pickFrom(bloom, i + tone), 0.85);
  }
}

/** Прямоугольная клумба-ящик (вдоль локальной оси X), rotY — поворот. */
export function planterBox(kit, x, z, rotY = 0, { length = 3, depth = 0.9, tone = 0, wood = false } = {}) {
  const { stone, soil, bloom, woodDark } = FLORA_COLORS;
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  const at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  const body = wood ? woodDark : stone;
  kit.box(length, 0.46, depth, x, 0.23, z, body, { ry: rotY, r: 0.08 });
  kit.box(length - 0.2, 0.06, depth - 0.2, x, 0.47, z, soil, { ry: rotY, tinted: false });
  const n = Math.max(3, Math.round(length * 2.4));
  for (let i = 0; i < n; i++) {
    const [px, pz] = at(-length / 2 + 0.3 + (i * (length - 0.6)) / (n - 1), ((i % 2) - 0.5) * depth * 0.4);
    if (i % 3 === 1) bush(kit, px, pz, 0.34, tone + i);
    else flower(kit, px, 0.48, pz, pickFrom(bloom, i + tone), 0.95);
  }
}

/** Фонарь в стиле пожарной части: тёмно-зелёная стойка, колпак и тёплая лампа. */
export function lampPost(kit, x, z, { height = 4.2 } = {}) {
  const { metal, metalDark, warm } = FLORA_COLORS;
  kit.cyl(0.32, 0.4, 0.3, 8, x, 0.15, z, metalDark);
  kit.cyl(0.2, 0.26, 0.35, 8, x, 0.45, z, metal);
  kit.cyl(0.075, 0.11, height - 0.5, 8, x, 0.6 + (height - 0.5) / 2, z, metal);
  kit.torus(0.14, 0.035, x, height * 0.55, z, metalDark, { radial: 5, tubular: 10 });
  kit.sphere(0.2, x, height + 0.05, z, warm, { s: [1, 1.15, 1], w: 9, h: 7, tinted: false });
  kit.cyl(0.08, 0.38, 0.22, 10, x, height + 0.34, z, metalDark);
  kit.sphere(0.07, x, height + 0.5, z, metalDark, { w: 6, h: 5 });
}

/** Урна: ведро на ножках с крышкой. */
export function bin(kit, x, z, rotY = 0) {
  const { metal, metalDark } = FLORA_COLORS;
  kit.cyl(0.3, 0.26, 0.78, 10, x, 0.55, z, metal);
  kit.cyl(0.33, 0.33, 0.08, 10, x, 0.97, z, metalDark);
  kit.cyl(0.07, 0.07, 0.12, 6, x, 1.05, z, metalDark);
  for (let i = 0; i < 3; i++) kit.box(0.4, 0.06, 0.05, x, 0.45 + i * 0.22, z + 0.27, metalDark, { ry: rotY });
  kit.cyl(0.25, 0.25, 0.14, 8, x, 0.075, z, metalDark);
}

/** Указатель: столб и две стрелки-таблички (направление задаёт angle для каждой). */
export function signpost(kit, x, z, arrows = [{ angle: 0, color: 0xd9482f, y: 2.35 }, { angle: Math.PI * 0.8, color: 0x3f8a68, y: 1.95 }]) {
  const { metal, cream } = FLORA_COLORS;
  kit.cyl(0.07, 0.09, 2.9, 7, x, 1.45, z, metal);
  kit.sphere(0.12, x, 3.0, z, metal, { w: 6, h: 5 });
  for (const arrow of arrows) {
    kit.box(1.5, 0.34, 0.07, x + Math.sin(arrow.angle) * 0.0, arrow.y, z, arrow.color, { ry: arrow.angle, r: 0.05 });
    kit.box(0.26, 0.26, 0.07, x + Math.cos(arrow.angle) * 0.82, arrow.y, z - Math.sin(arrow.angle) * 0.82, arrow.color, { ry: arrow.angle + Math.PI / 4, rot: [0, arrow.angle + Math.PI / 4, 0], r: 0.03 });
    kit.box(1.1, 0.12, 0.08, x, arrow.y, z, cream, { ry: arrow.angle, tinted: false });
  }
}

/** Информационный стенд на двух столбах (плоскость стенда смотрит вдоль +Z локально, поворот rotY). */
export function infoStand(kit, x, z, rotY = 0) {
  const { woodDark, cream, wood } = FLORA_COLORS;
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  for (const sx of [-0.8, 0.8]) kit.box(0.14, 1.9, 0.14, x + sx * c, 0.95, z - sx * s, woodDark, { ry: rotY });
  kit.box(2.0, 1.2, 0.1, x, 1.5, z, wood, { ry: rotY, r: 0.05 });
  kit.box(1.76, 0.96, 0.06, x + s * 0.06, 1.5, z + c * 0.06, cream, { ry: rotY, r: 0.03, tinted: false });
  kit.box(2.2, 0.12, 0.28, x + s * 0.02, 2.17, z + c * 0.02, woodDark, { ry: rotY, r: 0.04 });
}

/** Невысокий белый забор-штакетник вдоль отрезка. */
export function picketFence(kit, x0, z0, x1, z1, { color = 0xfff6e6, post = 0xefe3c8 } = {}) {
  const length = Math.hypot(x1 - x0, z1 - z0);
  const angle = Math.atan2(-(z1 - z0), x1 - x0);
  const count = Math.max(2, Math.round(length / 0.4));
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    kit.box(0.14, 0.9, 0.05, x0 + (x1 - x0) * t, 0.45, z0 + (z1 - z0) * t, color, { ry: angle });
  }
  for (const y of [0.3, 0.68]) kit.box(length, 0.08, 0.06, (x0 + x1) / 2, y, (z0 + z1) / 2, post, { ry: angle });
}

/** Валун. */
export function rock(kit, x, z, s = 1, tone = 0) {
  const colors = [0xb8bdb4, 0xa3a89f, 0xc9ccbf];
  kit.sphere(0.5 * s, x, 0.26 * s, z, pickFrom(colors, tone), { s: [1.2, 0.7, 1], w: 6, h: 5, rot: [0, tone, 0] });
}

// ── Готовые префабы для мира (ID 1, 2, 3) ─────────────────────────────────

const solo = (fn, options) => {
  const kit = createPrefabKit({ seed: 7 });
  fn(kit);
  return kit.build(options);
};

export const TREE_BUILDERS = Object.freeze({
  round: () => solo((k) => roundTree(k, 0, 0, 1)),
  pine: () => solo((k) => pineTree(k, 0, 0, 1)),
  birch: () => solo((k) => birchTree(k, 0, 0, 1)),
});
export const TREE_VARIANTS = Object.freeze(Object.keys(TREE_BUILDERS));

export const buildBenchPrefab = () => solo((k) => k.bench(0, 0, 0, { width: 2 }), { groundAO: { height: 0.5, strength: 0.25 } });
export const buildLampPrefab = () => solo((k) => lampPost(k, 0, 0));

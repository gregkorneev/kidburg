// Модели интерактивного мира: футбольный мяч, ящик, дорожный конус, цветочный горшок, разметка поля и ворота.
// Всё процедурное, геометрии и материалы общие (sharedGeometry): мячей и предметов может быть много, а ресурсов — по одному.
import * as THREE from 'three';
import { BALL, FIELD, PROP_TYPES, goalGeometry } from '../../../shared/interaction-contracts.js';
import { FLORA_COLORS } from './flora.js';
import { sharedGeometry } from './materials.js';
import { createPrefabKit } from './prefab-kit.js';

const solo = (fn, options) => {
  const kit = createPrefabKit({ seed: 11, tint: 0.02 });
  fn(kit);
  return kit.build({ groundAO: null, underside: 0.9, ...options });
};

const vertexMaterial = (options = {}) => {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.78, metalness: 0, ...options });
  m.userData.shared = true;
  return m;
};
let propMat = null;
let ballMat = null;
let lineMat = null;
let netMat = null;
export const propMaterial = () => (propMat ??= vertexMaterial());
export const ballMaterial = () => (ballMat ??= vertexMaterial({ roughness: 0.46 }));
/** Разметка лежит поверх газона: небольшой сдвиг глубины убирает мерцание. */
export const pitchMaterial = () => {
  if (!lineMat) {
    lineMat = vertexMaterial({ roughness: 0.95 });
    lineMat.polygonOffset = true;
    lineMat.polygonOffsetFactor = -2;
    lineMat.polygonOffsetUnits = -2;
  }
  return lineMat;
};
export const netMaterial = () => {
  if (!netMat) {
    netMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
    netMat.userData.shared = true;
  }
  return netMat;
};

// ── Мяч ───────────────────────────────────────────────────────────────────

/** Направления вершин икосаэдра: центры 12 «пятиугольников» на мяче. */
const PENTAGON_DIRS = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  return raw.map((v) => new THREE.Vector3(...v).normalize());
})();

/** Мяч единичной сборки: белая сфера с тёмными пятиугольными панелями и светло-серыми швами. */
export function buildBallGeometry() {
  return sharedGeometry('ball:football', () => {
    const geometry = new THREE.IcosahedronGeometry(BALL.radius, 3).toNonIndexed();
    const position = geometry.attributes.position;
    const colors = new Float32Array(position.count * 3);
    const white = new THREE.Color(0xfbf8f0);
    const dark = new THREE.Color(0x2a3036);
    const seam = new THREE.Color(0xcfd3d6);
    const centroid = new THREE.Vector3();
    for (let i = 0; i < position.count; i += 3) {
      centroid.set(0, 0, 0);
      for (let k = 0; k < 3; k++) centroid.add(new THREE.Vector3().fromBufferAttribute(position, i + k));
      centroid.normalize();
      let best = -1;
      for (const dir of PENTAGON_DIRS) best = Math.max(best, centroid.dot(dir));
      // cos 0.93 ≈ 21°: тёмное пятно вокруг каждой вершины; кольцо вокруг него — шов.
      const color = best > 0.935 ? dark : best > 0.905 ? seam : white;
      for (let k = 0; k < 3; k++) color.toArray(colors, (i + k) * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    return geometry;
  });
}

export function createBallMesh() {
  const mesh = new THREE.Mesh(buildBallGeometry(), ballMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.name = 'ball';
  return mesh;
}

// ── Предметы ──────────────────────────────────────────────────────────────

const PROP_BUILDERS = {
  crate(k) {
    const { wood, woodDark } = FLORA_COLORS;
    const s = 0.7;
    k.box(s, 0.6, s, 0, 0.3, 0, wood, { r: 0.04 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.08, 0.64, 0.08, sx * (s / 2 - 0.02), 0.3, sz * (s / 2 - 0.02), woodDark);
    for (const y of [0.14, 0.46]) k.box(s + 0.03, 0.07, s + 0.03, 0, y, 0, woodDark, { r: 0.02 });
    k.box(s * 0.92, 0.03, 0.06, 0, 0.3, s / 2 + 0.005, woodDark, { rot: [0, 0, 0.7], tinted: false });
  },
  cone(k) {
    k.box(0.5, 0.05, 0.5, 0, 0.025, 0, 0x2f3a3d, { r: 0.02 });
    k.cyl(0.07, 0.2, 0.5, 12, 0, 0.3, 0, 0xf2762e);
    k.cyl(0.115, 0.14, 0.1, 12, 0, 0.35, 0, 0xfff7e8, { tinted: false });
    k.cyl(0.085, 0.1, 0.08, 12, 0, 0.45, 0, 0xfff7e8, { tinted: false });
  },
  pot(k) {
    const { soil, leaf, bloom } = FLORA_COLORS;
    k.cyl(0.3, 0.2, 0.42, 12, 0, 0.21, 0, 0xc97a4e);
    k.cyl(0.33, 0.33, 0.07, 12, 0, 0.44, 0, 0xb86a42);
    k.cyl(0.27, 0.27, 0.04, 12, 0, 0.44, 0, soil, { tinted: false });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      k.sphere(0.14, Math.cos(a) * 0.13, 0.62, Math.sin(a) * 0.13, leaf[i % leaf.length], { w: 6, h: 4, s: [1, 1.3, 1] });
    }
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + 0.5;
      k.sphere(0.07, Math.cos(a) * 0.12, 0.8 + (i % 2) * 0.05, Math.sin(a) * 0.12, bloom[i % bloom.length], { w: 6, h: 5, tinted: false });
    }
  },
};

export const buildPropGeometry = (type) => sharedGeometry(`prop:${type}`, () => solo(PROP_BUILDERS[type] ?? PROP_BUILDERS.crate));

export function createPropMesh(type) {
  if (!Object.hasOwn(PROP_TYPES, type)) throw new RangeError(`Неизвестный предмет: ${type}`);
  const mesh = new THREE.Mesh(buildPropGeometry(type), propMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = `prop:${type}`;
  return mesh;
}

// ── Поле и ворота ─────────────────────────────────────────────────────────

/** Разметка (мел) и более светлый газон поля: плоская вершинно-окрашенная геометрия вокруг точки (FIELD.x, FIELD.z). */
export function buildPitchGeometry() {
  return sharedGeometry('pitch:marking', () => {
    const kit = createPrefabKit({ seed: 3, tint: 0 });
    const hw = FIELD.halfW;
    const hd = FIELD.halfD;
    const line = 0.12;
    const white = 0xfffbee;
    kit.box(hw * 2 + 3, 0.02, hd * 2 + 3, 0, 0.012, 0, 0x8fc778, { tinted: false });
    kit.box(hw * 2 + 0.2, 0.025, line, 0, 0.02, -hd, white, { tinted: false });
    kit.box(hw * 2 + 0.2, 0.025, line, 0, 0.02, hd, white, { tinted: false });
    for (const sx of [-1, 1]) kit.box(line, 0.025, hd * 2, sx * hw, 0.02, 0, white, { tinted: false });
    kit.box(line, 0.025, hd * 2, 0, 0.02, 0, white, { tinted: false });
    kit.cyl(2.6, 2.6, 0.022, 36, 0, 0.018, 0, white, { tinted: false });
    kit.cyl(2.48, 2.48, 0.026, 36, 0, 0.0185, 0, 0x8fc778, { tinted: false });
    for (const sx of [-1, 1]) {
      kit.box(3.2, 0.025, line, sx * (hw - 1.6), 0.02, -4.2, white, { tinted: false });
      kit.box(3.2, 0.025, line, sx * (hw - 1.6), 0.02, 4.2, white, { tinted: false });
      kit.box(line, 0.025, 8.4, sx * (hw - 3.2), 0.02, 0, white, { tinted: false });
    }
    return kit.build({ groundAO: null, underside: 1 });
  });
}

/** Каркас ворот (опоры, перекладина, дуги сзади) + сетка — группа в локальных координатах поля. */
export function createGoal(side) {
  const { posts, walls } = goalGeometry(FIELD);
  const group = new THREE.Group();
  group.name = `goal:${side}`;
  const geometry = sharedGeometry(`goal:frame:${side}`, () =>
    solo((k) => {
      const white = 0xfdfdf8;
      const lineX = side * FIELD.halfW;
      const backX = lineX + side * FIELD.goalDepth;
      const half = FIELD.goalWidth / 2;
      const h = FIELD.goalHeight;
      for (const dz of [-half, half]) {
        k.cyl(FIELD.postRadius, FIELD.postRadius, h, 8, lineX, h / 2, dz, white, { tinted: false });
        k.cyl(0.05, 0.05, h * 0.9, 6, backX, h * 0.45, dz, white, { tinted: false });
        k.cyl(0.04, 0.04, FIELD.goalDepth, 6, (lineX + backX) / 2, h, dz, white, { rot: [0, 0, Math.PI / 2], tinted: false });
      }
      k.cyl(FIELD.postRadius, FIELD.postRadius, FIELD.goalWidth, 8, lineX, h, 0, white, { rot: [Math.PI / 2, 0, 0], tinted: false });
      k.cyl(0.04, 0.04, FIELD.goalWidth, 6, backX, h, 0, white, { rot: [Math.PI / 2, 0, 0], tinted: false });
    }),
  );
  const frame = new THREE.Mesh(geometry, propMaterial());
  frame.castShadow = true;
  group.add(frame);
  const netGeometry = sharedGeometry(`goal:net:${side}`, () => {
    const lineX = side * FIELD.halfW;
    const backX = lineX + side * FIELD.goalDepth;
    const half = FIELD.goalWidth / 2;
    const h = FIELD.goalHeight;
    const pos = [];
    const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    quad([backX, 0, -half], [backX, 0, half], [backX, h, half], [backX, h, -half]);
    for (const dz of [-half, half]) quad([lineX, 0, dz], [backX, 0, dz], [backX, h, dz], [lineX, h, dz]);
    quad([lineX, h, -half], [backX, h, -half], [backX, h, half], [lineX, h, half]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return g;
  });
  group.add(new THREE.Mesh(netGeometry, netMaterial()));
  void posts;
  void walls;
  return group;
}

/** Поле целиком: разметка и двое ворот. Позиция — центр поля. */
export function createPitch() {
  const group = new THREE.Group();
  group.name = 'pitch';
  group.position.set(FIELD.x, 0, FIELD.z);
  const marking = new THREE.Mesh(buildPitchGeometry(), pitchMaterial());
  marking.receiveShadow = true;
  group.add(marking, createGoal(-1), createGoal(1));
  return group;
}

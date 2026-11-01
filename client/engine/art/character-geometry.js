// Общая геометрия тела персонажа: все формы строятся один раз на уровень детализации и делятся между людьми
// (sharedGeometry), поэтому новый персонаж стоит несколько Mesh с готовыми буферами, а не сотни вершин заново.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { sharedGeometry } from './materials.js';

export const ARM_LENGTH = 0.86;
export const TORSO_Y = 0.86;
export const TORSO_DEPTH = 0.8;
export const HIP_Y = 0.92;
export const ANKLE_Y = 0.21;
export const THIGH_LEN = 0.37;
export const SHIN_LEN = 0.34;
export const HEAD_RADII = Object.freeze({ x: 0.47, y: 0.45, z: 0.43 });

/** Умеренные различия комплекции: коллайдеры и скорость от них не зависят (это только вид). */
export const BUILD_PARAMS = Object.freeze({
  standard: { w: 1, h: 1, shoulderX: 0.47, hands: 1, belly: 1 },
  compact: { w: 1.05, h: 0.93, shoulderX: 0.47, hands: 0.95, belly: 1.12 },
  broad: { w: 1.1, h: 1.04, shoulderX: 0.53, hands: 1.06, belly: 0.96 },
});

const FACE_PARAMS = {
  round: { jaw: 0.1, cheek: 0.05, chin: 0, brow: 0 },
  oval: { jaw: 0.2, cheek: 0, chin: 0.1, brow: 0 },
  wide: { jaw: 0.04, cheek: 0.1, chin: -0.02, brow: 0.02 },
  heart: { jaw: 0.3, cheek: 0.02, chin: 0.04, brow: 0.07 },
};

const RADIAL = [8, 12, 16];
const SPHERE = [[12, 8], [20, 14], [32, 20]];
const SMALL = [[7, 5], [10, 6], [16, 10]];
const level = (detail) => Math.max(0, Math.min(2, detail | 0));

/** Оставляет у геометрии только position+normal без индекса: так любые детали сливаются в один буфер. */
function plain(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  return g;
}

/** Запекает эллипсоид/форму в геометрию: [x,y,z] положение, [sx,sy,sz] размер, rot — углы Эйлера. */
export function bake(geometry, position = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0]) {
  const g = plain(geometry);
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
  g.applyMatrix4(matrix);
  return g;
}

export function blobPart(position, scale, rotation, segments = [12, 8]) {
  return bake(new THREE.SphereGeometry(1, segments[0], segments[1]), position, scale, rotation);
}

export function mergeParts(parts) {
  const merged = mergeGeometries(parts, false);
  parts.forEach((part) => part.dispose());
  return merged;
}

/** Профиль вращения [радиус-доля, высота-доля] → единичная фигура высотой 1 (от −0.5 до 0.5), радиус 1. */
function unitLathe(points, radial) {
  // LatheGeometry даёт наружные нормали, только если профиль идёт снизу вверх.
  const ordered = points[0][1] > points[points.length - 1][1] ? [...points].reverse() : points;
  return new THREE.LatheGeometry(ordered.map(([r, y]) => new THREE.Vector2(r, y)), radial);
}

const LIMB_PROFILES = {
  upperArm: [[0, 0.5], [0.72, 0.47], [1, 0.32], [0.97, 0.05], [0.86, -0.3], [0.8, -0.47], [0, -0.5]],
  forearm: [[0, 0.5], [0.8, 0.47], [0.95, 0.32], [0.84, -0.1], [0.72, -0.4], [0.7, -0.48], [0, -0.5]],
  sleeveShort: [[0, 0.5], [0.82, 0.48], [1, 0.3], [1.06, -0.2], [1.12, -0.5], [0, -0.5]],
  thigh: [[0, 0.5], [0.84, 0.47], [1, 0.3], [0.94, -0.1], [0.8, -0.4], [0.76, -0.48], [0, -0.5]],
  shin: [[0, 0.5], [0.74, 0.47], [0.86, 0.3], [0.84, 0.05], [0.66, -0.35], [0.62, -0.48], [0, -0.5]],
};

/** Конечность единичной высоты; на сцене масштабируется как (радиус, длина, радиус). */
export function limbGeometry(kind, detail = 1) {
  const d = level(detail);
  return sharedGeometry(`c:limb:${kind}:${d}`, () => unitLathe(LIMB_PROFILES[kind], RADIAL[d]));
}

const TORSO_BASE = [[0, 0], [0.3, 0], [0.38, 0.08], [0.41, 0.22], [0.44, 0.45], [0.465, 0.62], [0.43, 0.78], [0.31, 0.88], [0.17, 0.93], [0, 0.95]];

function torsoProfile(build) {
  const p = BUILD_PARAMS[build] ?? BUILD_PARAMS.standard;
  return TORSO_BASE.map(([r, h]) => [r * (r > 0.38 && h < 0.3 ? p.w * p.belly : p.w), h * p.h]);
}

export function torsoRadiusAt(build, y) {
  const profile = torsoProfile(build);
  for (let i = 1; i < profile.length; i++) {
    const [r0, y0] = profile[i - 1];
    const [r1, y1] = profile[i];
    if (y <= y1) return r0 + ((r1 - r0) * (y - y0)) / Math.max(1e-6, y1 - y0);
  }
  return 0.1;
}

export function torsoGeometry(build = 'standard', detail = 1) {
  const d = level(detail);
  return sharedGeometry(`c:torso:${build}:${d}`, () => unitLathe(torsoProfile(build).map(([r, h]) => [r, h]), RADIAL[d] + 8));
}

/** Голова: шар, мягко деформированный под форму лица (подбородок, щёки, лоб), с гладкими нормалями. */
export function headGeometry(shape = 'round', detail = 1) {
  const d = level(detail);
  return sharedGeometry(`c:head:${shape}:${d}`, () => {
    const s = FACE_PARAMS[shape] ?? FACE_PARAMS.round;
    const g = new THREE.SphereGeometry(1, SPHERE[d][0], SPHERE[d][1]);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const ux = pos.getX(i);
      const uy = pos.getY(i);
      const uz = pos.getZ(i);
      const lower = Math.max(0, -uy);
      const upper = Math.max(0, uy);
      let x = ux * HEAD_RADII.x;
      let y = uy * HEAD_RADII.y;
      let z = uz * HEAD_RADII.z;
      x *= 1 - s.jaw * lower ** 1.6 + s.cheek * Math.exp(-(((uy + 0.25) / 0.35) ** 2)) + s.brow * upper;
      if (y < 0) y *= 1 + s.chin * lower * lower * 2;
      if (uz > 0 && lower > 0) z *= 1 - 0.12 * s.jaw * lower;
      if (uz < 0) z *= 1.05;
      pos.setXYZ(i, x, y, z);
    }
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    const smooth = mergeVertices(g, 1e-4);
    smooth.computeVertexNormals();
    g.dispose();
    return smooth;
  });
}

/** Поверхность головы спереди на высоте y и ширине x (приблизительно) — чтобы глаза и нос «сидели» на лице. */
export function headFrontZ(shape, x, y) {
  const s = FACE_PARAMS[shape] ?? FACE_PARAMS.round;
  const uy = Math.max(-1, Math.min(1, y / HEAD_RADII.y));
  const lower = Math.max(0, -uy);
  const upper = Math.max(0, uy);
  const widthK = 1 - s.jaw * lower ** 1.6 + s.cheek * Math.exp(-(((uy + 0.25) / 0.35) ** 2)) + s.brow * upper;
  const nx = x / (HEAD_RADII.x * widthK);
  const inside = Math.max(0.04, 1 - nx * nx - uy * uy);
  return HEAD_RADII.z * Math.sqrt(inside) * (1 - 0.12 * s.jaw * lower);
}

/** Ладонь с большим пальцем: «варежка» мультяшной формы, зеркальная для левой и правой руки. */
export function handGeometry(side, detail = 1) {
  const d = level(detail);
  return sharedGeometry(`c:hand:${side}:${d}`, () => {
    const small = SMALL[d];
    return mergeParts([
      blobPart([0, -0.11, 0], [0.108, 0.135, 0.085], [0, 0, 0], small),
      blobPart([0, -0.2, 0.012], [0.095, 0.075, 0.075], [0, 0, 0], small),
      blobPart([-side * 0.095, -0.07, 0.05], [0.04, 0.08, 0.04], [0.5, 0, -side * 0.5], [8, 6]),
    ]);
  });
}

/** Обувь: верх и подошва — два общих буфера на стиль. Начало координат — щиколотка, носок смотрит в +Z. */
export function shoeGeometry(style, part, detail = 1) {
  const d = level(detail);
  return sharedGeometry(`c:shoe:${style}:${part}:${d}`, () => {
    const seg = SMALL[d];
    if (part === 'sole') {
      if (style === 'safety') {
        return mergeParts([
          blobPart([0, -0.175, 0.07], [0.225, 0.055, 0.33], [0, 0, 0], seg),
          blobPart([0, -0.1, 0.27], [0.19, 0.1, 0.13], [0, 0, 0], seg), // защитный бампер
        ]);
      }
      if (style === 'boot') return mergeParts([blobPart([0, -0.175, 0.05], [0.205, 0.05, 0.3], [0, 0, 0], seg), blobPart([0, -0.16, -0.1], [0.19, 0.065, 0.12], [0, 0, 0], seg)]);
      return mergeParts([
        blobPart([0, -0.172, 0.08], [0.215, 0.055, 0.33], [0, 0, 0], seg),
        // шнуровка: три светлые перемычки по верху стопы
        blobPart([0, 0.03, 0.0], [0.085, 0.02, 0.022], [0.15, 0, 0], [8, 5]),
        blobPart([0, 0.038, 0.08], [0.085, 0.02, 0.022], [0.0, 0, 0], [8, 5]),
        blobPart([0, 0.03, 0.16], [0.085, 0.02, 0.022], [-0.2, 0, 0], [8, 5]),
      ]);
    }
    if (style === 'boot' || style === 'safety') {
      const big = style === 'safety' ? 1.1 : 1;
      return mergeParts([
        blobPart([0, -0.06, 0.07], [0.19 * big, 0.14 * big, 0.28 * big], [0, 0, 0], seg),
        blobPart([0, 0.03, -0.02], [0.175 * big, 0.17, 0.17 * big], [0, 0, 0], seg),
        blobPart([0, -0.07, 0.2], [0.17 * big, 0.1, 0.15], [0, 0, 0], seg),
      ]);
    }
    return mergeParts([
      blobPart([0, -0.075, 0.08], [0.185, 0.115, 0.28], [0, 0, 0], seg),
      blobPart([0, -0.1, 0.22], [0.165, 0.09, 0.15], [0, 0, 0], seg),
      blobPart([0, -0.01, -0.03], [0.165, 0.08, 0.15], [0, 0, 0], seg),
    ]);
  });
}

export function pelvisGeometry(detail = 1) {
  const d = level(detail);
  return sharedGeometry(`c:pelvis:${d}`, () => blobPart([0, 0, 0], [0.37, 0.19, 0.29], [0, 0, 0], SMALL[d]));
}

/** Ухо, нос и шея — кожа, общая для лица данного вида. */
export function facePartsGeometry({ faceShape, noseStyle, earHeight }, detail = 1) {
  const d = level(detail);
  return sharedGeometry(`c:faceparts:${faceShape}:${noseStyle}:${earHeight}:${d}`, () => {
    const parts = [];
    const small = [10, 7];
    const earY = earHeight ? 0.06 : -0.01;
    for (const side of [-1, 1]) {
      const x = HEAD_RADII.x * (1 - (FACE_PARAMS[faceShape]?.jaw ?? 0) * Math.max(0, -earY / HEAD_RADII.y) ** 1.6) - 0.012;
      parts.push(blobPart([side * x, earY, -0.01], [0.06, 0.105, 0.075], [0, side * 0.25, side * 0.15], small));
    }
    const noseZ = headFrontZ(faceShape, 0, -0.04);
    if (noseStyle === 'round') parts.push(blobPart([0, -0.045, noseZ + 0.012], [0.085, 0.07, 0.07], [0, 0, 0], small));
    else if (noseStyle === 'pointy') parts.push(blobPart([0, -0.05, noseZ + 0.025], [0.05, 0.075, 0.095], [0.35, 0, 0], small));
    else parts.push(blobPart([0, -0.05, noseZ + 0.008], [0.062, 0.055, 0.058], [0, 0, 0], small));
    parts.push(bake(new THREE.CylinderGeometry(1, 1.06, 1, RADIAL[d]), [0, -0.43, -0.02], [0.165, 0.2, 0.15]));
    return mergeParts(parts);
  });
}

/** Круглый диск-румянец для обеих щёк (общая геометрия, форма лица влияет на посадку). */
export function cheekGeometry(faceShape, detail = 1) {
  return sharedGeometry(`c:cheeks:${faceShape}:${level(detail)}`, () => mergeParts([-1, 1].map((side) => {
    const z = headFrontZ(faceShape, side * 0.29, -0.1) - 0.02;
    return blobPart([side * 0.29, -0.1, z], [0.078, 0.046, 0.022], [0, side * 0.62, 0], [8, 6]);
  })));
}

/** Простые общие примитивы для деталей одежды и лица (единичный размер, масштабируются на Mesh). */
export const unit = {
  sphere: (detail = 1) => sharedGeometry(`c:u:sphere:${level(detail)}`, () => new THREE.SphereGeometry(1, SMALL[level(detail)][0], SMALL[level(detail)][1])),
  ball: (detail = 1) => sharedGeometry(`c:u:ball:${level(detail)}`, () => new THREE.SphereGeometry(1, SPHERE[level(detail)][0], SPHERE[level(detail)][1])),
  dome: () => sharedGeometry('c:u:dome', () => new THREE.SphereGeometry(1, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2)),
  cyl: () => sharedGeometry('c:u:cyl', () => new THREE.CylinderGeometry(1, 1, 1, 14)),
  ring: () => sharedGeometry('c:u:ring', () => new THREE.CylinderGeometry(1, 1, 1, 22, 1, true)),
  cone: () => sharedGeometry('c:u:cone', () => new THREE.ConeGeometry(1, 1, 7)),
  box: () => sharedGeometry('c:u:box', () => new THREE.BoxGeometry(1, 1, 1)),
  arc: () => sharedGeometry('c:u:arc', () => new THREE.TorusGeometry(1, 0.14, 6, 14, Math.PI)),
  torus: () => sharedGeometry('c:u:torus', () => new THREE.TorusGeometry(1, 0.1, 6, 22)),
  /** Капля шириной 1 и высотой 1: широкая у корня (вверху), острая к кончику (внизу). */
  drop: () => sharedGeometry('c:u:drop', () => unitLathe([[0, 0.5], [0.62, 0.38], [1, 0.1], [0.78, -0.2], [0.34, -0.42], [0, -0.5]], 9)),
};

/** Дуга-дужка наушников: полуокружность в плоскости XY (выпуклая вверх), тонкая трубка. */
unit.band = () => sharedGeometry('c:u:band', () => new THREE.TorusGeometry(1, 0.055, 6, 22, Math.PI));

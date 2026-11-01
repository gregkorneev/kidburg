// Лицо: глаза с веками и взглядом, брови, рот, румянец и система эмоций с плавными переходами.
// Эмоции — чисто визуальные: они не меняют диалог и игровую логику и не передаются по сети (каждый клиент считает их сам).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sharedGeometry, stdMat } from './materials.js';
import { blobPart, cheekGeometry, headFrontZ, unit } from './character-geometry.js';

export const EXPRESSIONS = Object.freeze(['neutral', 'happy', 'surprised', 'thinking', 'sad', 'focused', 'confused']);

/** Числа, которыми описывается лицо; текущее значение плавно догоняет целевое (см. updateFace). */
const FACE_KEYS = ['browY', 'browTilt', 'browAsym', 'lid', 'lidLow', 'mouthCurve', 'mouthOpen', 'mouthWidth', 'eyeScale', 'headPitch', 'headTilt', 'gazeX', 'gazeY'];

const NEUTRAL = { browY: 0, browTilt: 0, browAsym: 0, lid: 0, lidLow: 0, mouthCurve: 0.35, mouthOpen: 0, mouthWidth: 1, eyeScale: 1, headPitch: 0, headTilt: 0, gazeX: 0, gazeY: 0 };
const TARGETS = {
  neutral: {},
  happy: { browY: 0.025, lid: 0.05, lidLow: 0.3, mouthCurve: 1, mouthOpen: 0.22, mouthWidth: 1.18, headPitch: -0.05, headTilt: 0.03 },
  surprised: { browY: 0.075, mouthCurve: 0, mouthOpen: 0.85, mouthWidth: 0.55, eyeScale: 1.13, headPitch: -0.07 },
  thinking: { browY: 0.02, browAsym: 0.05, browTilt: 0.12, lid: 0.16, mouthCurve: -0.1, mouthWidth: 0.78, headTilt: 0.13, headPitch: -0.02, gazeX: 0.3, gazeY: 0.22 },
  sad: { browY: -0.005, browTilt: 0.42, lid: 0.3, mouthCurve: -0.85, mouthOpen: 0.05, mouthWidth: 0.88, headPitch: 0.12, gazeY: -0.15 },
  focused: { browY: -0.02, browTilt: -0.32, lid: 0.24, lidLow: 0.12, mouthCurve: 0.02, mouthWidth: 0.85, headPitch: 0.04 },
  confused: { browY: 0.01, browTilt: 0.16, browAsym: 0.045, lid: 0.08, mouthCurve: -0.25, mouthOpen: 0.14, mouthWidth: 0.82, headTilt: -0.14, gazeX: -0.1 },
};

const EYE_SHAPE = {
  round: { rx: 0.105, ry: 0.125, tilt: 0 },
  wide: { rx: 0.125, ry: 0.105, tilt: 0.02 },
  tall: { rx: 0.092, ry: 0.15, tilt: 0 },
  almond: { rx: 0.115, ry: 0.108, tilt: 0.16 },
};
const BROW_STYLE = {
  soft: { w: 1, t: 1, rise: 0, tilt: 0 },
  arched: { w: 0.95, t: 0.9, rise: 0.015, tilt: -0.08 },
  thick: { w: 1.1, t: 1.5, rise: -0.005, tilt: 0.02 },
  flat: { w: 1.05, t: 1, rise: 0, tilt: -0.02 },
};
const MOUTH_STYLE = { small: { w: 0.82, thick: 0.9, skew: 0 }, wide: { w: 1.2, thick: 1.05, skew: 0 }, smirk: { w: 1, thick: 1, skew: 0.12 } };

const colored = (geometry, color) => {
  const c = new THREE.Color(color);
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b], i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
};

/** Глаз целиком (белок, радужка, зрачок, блик) в одном буфере с вершинными цветами. */
function eyeGeometry(shape, side, iris, detail) {
  return sharedGeometry(`c:eye:${shape}:${side}:${iris}:${detail}`, () => {
    const { rx, ry } = EYE_SHAPE[shape];
    const seg = [[6, 5], [9, 6], [16, 10]][detail];
    const parts = [
      colored(blobPart([0, 0, 0], [rx, ry, 0.055], [0, 0, 0], seg), '#fffdf6'),
      colored(blobPart([side * -0.004, -0.004, 0.032], [rx * 0.7, ry * 0.76, 0.034], [0, 0, 0], seg), iris),
      colored(blobPart([side * -0.004, -0.004, 0.05], [rx * 0.4, ry * 0.46, 0.02], [0, 0, 0], [8, 6]), '#1d2323'),
      colored(blobPart([side * rx * 0.2, ry * 0.3, 0.062], [rx * 0.19, ry * 0.17, 0.011], [0, 0, 0], [6, 5]), '#ffffff'),
    ];
    const merged = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    return merged;
  });
}

/** Лицо: eyes, lids, brows, mouth (open/smile), cheeks; cur/target — числа эмоции. */
export function buildFace(head, look, { skin, hairMaterial, detail = 1 } = {}) {
  const shape = look.faceShape;
  const eyeSpec = EYE_SHAPE[look.eyeShape] ?? EYE_SHAPE.round;
  const size = look.eyeSize ?? 1;
  const rx = eyeSpec.rx;
  const ry = eyeSpec.ry;
  const spacing = shape === 'wide' ? 0.195 : shape === 'heart' ? 0.175 : 0.185;
  const eyeY = 0.035 + (shape === 'oval' ? -0.01 : 0);
  const browSpec = BROW_STYLE[look.browStyle] ?? BROW_STYLE.soft;
  const mouthSpec = MOUTH_STYLE[look.mouthStyle] ?? MOUTH_STYLE.small;
  const sphere = unit.sphere(detail);
  const eyeMat = stdMat('#ffffff', { roughness: 0.3, vertexColors: true });
  const eyes = [];
  const lids = [];
  const brows = [];

  for (const side of [-1, 1]) {
    const x = side * spacing;
    const z = headFrontZ(shape, x, eyeY) - 0.014;
    const eye = new THREE.Group();
    eye.position.set(x, eyeY, z);
    eye.scale.setScalar(size);
    eye.add(new THREE.Mesh(eyeGeometry(look.eyeShape in EYE_SHAPE ? look.eyeShape : 'round', side, look.eyeColor, detail), eyeMat));
    head.add(eye);
    eyes.push(eye);

    const upper = new THREE.Mesh(sphere, skin);
    upper.position.set(x, eyeY, z + 0.006);
    upper.visible = false;
    head.add(upper);
    let lower = null;
    if (detail >= 1) {
      lower = new THREE.Mesh(sphere, skin);
      lower.position.set(x, eyeY, z + 0.006);
      lower.visible = false;
      head.add(lower);
    }
    lids.push({ upper, lower, x, y: eyeY, z: z + 0.006, rx: rx * 1.14 * size, ry: ry * size, rz: 0.066 * size, side, tilt: eyeSpec.tilt });

    const browY = eyeY + ry * size + 0.075 + browSpec.rise;
    const slope = (headFrontZ(shape, x, browY + 0.02) - headFrontZ(shape, x, browY - 0.02)) / 0.04;
    const brow = new THREE.Mesh(sphere, hairMaterial);
    brow.userData.base = { y: browY, tilt: browSpec.tilt };
    brow.position.set(x, browY, headFrontZ(shape, x, browY) + 0.002);
    brow.scale.set(0.105 * browSpec.w, 0.03 * browSpec.t, 0.028);
    brow.rotation.set(Math.atan(slope), 0, 0);
    head.add(brow);
    brows.push(brow);
  }

  const cheeks = new THREE.Mesh(cheekGeometry(shape, detail), stdMat('#f08f84', { roughness: 0.9 }));
  head.add(cheeks);

  const mouth = new THREE.Group();
  mouth.position.set(0, -0.165, headFrontZ(shape, 0, -0.165) - 0.012);
  mouth.rotation.z = mouthSpec.skew;
  head.add(mouth);
  const open = new THREE.Mesh(sphere, stdMat('#7a3c36', { roughness: 0.6 }));
  open.position.set(0, -0.005, 0);
  open.scale.set(0.065, 0.02, 0.02);
  mouth.add(open);
  const smile = new THREE.Mesh(unit.arc(), stdMat('#b9584f', { roughness: 0.6 }));
  smile.position.set(0, 0.02, 0.005);
  smile.rotation.z = Math.PI;
  mouth.add(smile);

  return {
    eyes, lids, brows, mouth, open, smile, cheeks,
    mouthSpec, eyeSize: size, detail,
    cur: { ...NEUTRAL }, target: { ...NEUTRAL }, expression: 'neutral',
  };
}

/** Целевое лицо для эмоции с силой 0..1 (1 — полная). */
export function expressionTarget(name, intensity = 1) {
  const spec = TARGETS[name] ?? TARGETS.neutral;
  const result = {};
  for (const key of FACE_KEYS) result[key] = NEUTRAL[key] + ((spec[key] ?? NEUTRAL[key]) - NEUTRAL[key]) * intensity;
  return result;
}

export function setFaceTarget(face, name, intensity = 1) {
  Object.assign(face.target, expressionTarget(name, intensity));
  face.expression = name;
}

const approach = (value, target, rate, dt) => value + (target - value) * Math.min(1, dt * rate);
const pose = { headPitch: 0, headTilt: 0 };

/**
 * Один кадр лица: догоняет целевую эмоцию, добавляет моргание, речь и взгляд.
 * ctx: blink (0..1 закрытие века), talkBeat (−1..1 «удар» фразы), talkOpen (0..1), gazeX, gazeY.
 * Возвращает наклон головы, согласованный с эмоцией (объект общий — читать сразу).
 */
export function updateFace(face, dt, ctx) {
  const { cur, target } = face;
  const rate = face.detail === 0 ? 14 : 8;
  for (const key of FACE_KEYS) cur[key] = approach(cur[key], target[key], rate, dt);

  const upperCover = Math.min(1, Math.max(cur.lid, ctx.blink));
  const lowerCover = Math.min(0.7, cur.lidLow);
  const scale = cur.eyeScale;
  const gx = cur.gazeX + ctx.gazeX;
  const gy = cur.gazeY + ctx.gazeY;
  for (let i = 0; i < face.eyes.length; i++) {
    const eye = face.eyes[i];
    const lid = face.lids[i];
    eye.scale.setScalar(face.eyeSize * scale);
    eye.rotation.set(-gy * 0.5, gx * 0.55, lid.side * lid.tilt);
    const ry = lid.ry * scale;
    const rx = lid.rx * scale;
    if (upperCover > 0.02) {
      const half = upperCover * ry;
      lid.upper.visible = true;
      lid.upper.scale.set(rx, half + 0.0008, lid.rz);
      lid.upper.position.set(lid.x, lid.y + ry * 1.04 - half, lid.z);
    } else lid.upper.visible = false;
    if (lid.lower) {
      if (lowerCover > 0.02) {
        const half = lowerCover * ry;
        lid.lower.visible = true;
        lid.lower.scale.set(rx, half + 0.0008, lid.rz);
        lid.lower.position.set(lid.x, lid.y - ry * 1.04 + half, lid.z);
      } else lid.lower.visible = false;
    }
  }

  // Брови: высота, наклон (внутренние концы вверх — печаль, вниз — сосредоточенность), асимметрия, удар при речи.
  const beat = ctx.talkBeat * 0.012;
  for (let i = 0; i < face.brows.length; i++) {
    const brow = face.brows[i];
    const side = i === 0 ? -1 : 1;
    brow.position.y = brow.userData.base.y + cur.browY + beat + (side < 0 ? cur.browAsym : 0);
    brow.rotation.z = -side * (cur.browTilt + brow.userData.base.tilt * 0.5) + (side < 0 ? cur.browAsym * 1.4 : 0);
  }

  // Рот: знак масштаба по Y даёт улыбку или хмурость; речь добавляет открытие и сглаживает изгиб.
  const open = Math.min(1, cur.mouthOpen + ctx.talkOpen);
  const curve = cur.mouthCurve * (1 - Math.min(0.7, ctx.talkOpen));
  const width = cur.mouthWidth * face.mouthSpec.w;
  const k = Math.abs(curve) < 0.12 ? (curve < 0 ? -0.12 : 0.12) : curve;
  face.smile.scale.set(0.1 * width, 0.07 * k, 0.55 * face.mouthSpec.thick);
  face.open.scale.set(0.06 * width + open * 0.02 * width, 0.02 + open * 0.085, 0.024);
  face.open.visible = open > 0.03;

  pose.headPitch = cur.headPitch;
  pose.headTilt = cur.headTilt;
  return pose;
}

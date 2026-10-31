// Единая система персонажей Kidburg: игроки, другие игроки и наставники строятся одним конструктором.
// Пропорции «большая голова, мягкое тело», лицо с моргающими глазами, смена профессиональной экипировки
// (setPersonEquipment) и процедурная анимация (animateCharacter) — без внешних моделей и скелетов.
// Внешность выводится из числа (id игрока), поэтому любые клиенты видят одного и того же человека без новых полей протокола.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE, pick } from './palette.js';
import { createContactShadow, isSharedResource, sharedGeometry, stdMat } from './materials.js';
import { createLabelSprite } from './labels.js';

export const HAIR_STYLES = Object.freeze(['short', 'bob', 'curly', 'spiky', 'ponytail']);
export const ARM_LENGTH = 0.86;
// Пожарная часть показывает персонажа крупно; в городе его подгоняют под рост игрока 1.8 м.
export const CITY_CHARACTER_SCALE = 0.64;
const TORSO_Y = 0.86;
const TORSO_PROFILE = [[0, 0], [0.34, 0], [0.43, 0.1], [0.47, 0.42], [0.42, 0.74], [0.3, 0.88], [0.16, 0.93], [0, 0.93]];
const TORSO_DEPTH = 0.8;

const geo = {
  ball: () => sharedGeometry('c:ball', () => new THREE.SphereGeometry(1, 20, 13)),
  small: () => sharedGeometry('c:small', () => new THREE.SphereGeometry(1, 12, 8)),
  dome: () => sharedGeometry('c:dome', () => new THREE.SphereGeometry(1, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2)),
  cyl: () => sharedGeometry('c:cyl', () => new THREE.CylinderGeometry(1, 1, 1, 14)),
  ring: () => sharedGeometry('c:ring', () => new THREE.CylinderGeometry(1, 1, 1, 22, 1, true)),
  cone: () => sharedGeometry('c:cone', () => new THREE.ConeGeometry(1, 1, 7)),
  box: () => sharedGeometry('c:box', () => new THREE.BoxGeometry(1, 1, 1)),
  arc: () => sharedGeometry('c:arc', () => new THREE.TorusGeometry(1, 0.14, 6, 14, Math.PI)),
  torso: () => sharedGeometry('c:torso', () => new THREE.LatheGeometry(TORSO_PROFILE.map(([r, h]) => new THREE.Vector2(r, h)), 22)),
};

const m = {
  eye: () => stdMat('#fffdf6', { roughness: 0.3 }),
  iris: () => stdMat('#5a3d2e', { roughness: 0.35 }),
  pupil: () => stdMat('#1d2323', { roughness: 0.2 }),
  eyeVC: () => stdMat('#ffffff', { roughness: 0.3, vertexColors: true }),
  shine: () => stdMat('#ffffff', { roughness: 0.1, emissive: '#ffffff', emissiveIntensity: 0.6 }),
  cheek: () => stdMat('#f08f84', { roughness: 0.9 }),
  mouth: () => stdMat('#7a3c36', { roughness: 0.6 }),
  lip: () => stdMat('#b9584f', { roughness: 0.6 }),
};

const materialOf = (value) => (value?.isMaterial ? value : stdMat(value));

function blob(parent, material, [x, y, z], [sx, sy, sz], { cast = false, receive = false, rotation = null, small = false } = {}) {
  const mesh = new THREE.Mesh(small ? geo.small() : geo.ball(), material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  parent.add(mesh);
  return mesh;
}

function solid(parent, geometry, material, [x, y, z], [sx, sy, sz], { cast = false, receive = false, rotation = null } = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  parent.add(mesh);
  return mesh;
}


function plainGeometry(mesh, withColor = false) {
  mesh.updateMatrix();
  const g = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(mesh.matrix);
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  if (withColor) {
    const color = mesh.material.color;
    const colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([color.r, color.g, color.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  return g;
}

/** Склеивает прямых потомков-Mesh группы по общему материалу: десятки деталей персонажа — единицы вызовов отрисовки. */
function mergeByMaterial(group) {
  const buckets = new Map();
  for (const child of [...group.children]) {
    if (!child.isMesh) continue;
    if (!buckets.has(child.material)) buckets.set(child.material, []);
    buckets.get(child.material).push(child);
  }
  for (const [material, meshes] of buckets) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map((mesh) => plainGeometry(mesh));
    const merged = new THREE.Mesh(mergeGeometries(geometries, false), material);
    merged.castShadow = meshes.some((mesh) => mesh.castShadow);
    merged.receiveShadow = meshes.some((mesh) => mesh.receiveShadow);
    group.remove(...meshes);
    group.add(merged);
    geometries.forEach((g) => g.dispose());
  }
}

/** Склеивает потомков группы в один Mesh с вершинными цветами (глаз = белок + радужка + зрачок + блик). */
function mergeVertexColored(group, material) {
  const meshes = group.children.filter((child) => child.isMesh);
  const geometries = meshes.map((mesh) => plainGeometry(mesh, true));
  const merged = new THREE.Mesh(mergeGeometries(geometries, false), material);
  group.remove(...meshes);
  group.add(merged);
  geometries.forEach((g) => g.dispose());
}

function torsoRadius(y) {
  for (let i = 1; i < TORSO_PROFILE.length; i++) {
    const [r0, y0] = TORSO_PROFILE[i - 1];
    const [r1, y1] = TORSO_PROFILE[i];
    if (y <= y1) return r0 + ((r1 - r0) * (y - y0)) / Math.max(1e-6, y1 - y0);
  }
  return 0.1;
}

/** Внешность по числу: цвет кожи, волос, причёска и одежда стабильны для одного id на всех клиентах. */
export function appearanceFromSeed(seed = 0, color = null) {
  const s = Math.abs(Math.trunc(seed));
  return {
    skin: pick(PALETTE.skin, s * 3 + 1),
    hair: pick(PALETTE.hair, s * 5 + 2),
    hairStyle: HAIR_STYLES[(s * 7 + 3) % (HAIR_STYLES.length - 1)], // «хвост» оставлен наставнику
    outfit: typeof color === 'number' ? `#${new THREE.Color(color).getHexString()}` : pick(PALETTE.outfit, s * 11 + 4),
    pants: pick(['#4d6478', '#6b7a5a', '#6a5f78', '#5b6770'], s * 13 + 5),
  };
}

const GEAR_STYLES = {
  // Игроки: красная куртка, жёлтые светоотражающие полосы, красная каска.
  player: { jacket: PALETTE.red, jacketDark: PALETTE.redDark, stripe: PALETTE.yellow, helmet: PALETTE.red, helmetDark: PALETTE.redDark, badge: PALETTE.yellow, pants: '#3b4a52', glove: PALETTE.charcoal },
  // Наставник: тёмно-бордовая куртка, белая каска и белые полосы — узнаётся издали.
  mentor: { jacket: '#9c3a31', jacketDark: '#7a2c28', stripe: '#f6d56a', helmet: '#fff1d2', helmetDark: '#e0c9a0', badge: '#e8a93a', pants: '#2f3e4a', glove: '#5a4a3c' },
};

function buildHair(head, style, material) {
  // top — макушка и чёлка (прячутся под каской), back — боковые и задние пряди, хвост (видны всегда).
  const top = new THREE.Group();
  const back = new THREE.Group();
  head.add(top, back);
  blob(top, material, [0, 0.14, -0.05], [0.5, 0.36, 0.47], { cast: true });
  const fringe = (xs, y, z, size, tilt) => xs.forEach((x, i) => blob(top, material, [x, y - (i % 2) * 0.02, z], size, { rotation: [0, 0, tilt * (x > 0 ? -1 : 1)], small: true }));
  let tail = null;
  switch (style) {
    case 'bob':
      fringe([-0.3, -0.1, 0.1, 0.3], 0.34, 0.33, [0.17, 0.12, 0.1], 0.3);
      blob(back, material, [-0.42, -0.1, -0.05], [0.12, 0.34, 0.34], { cast: true });
      blob(back, material, [0.42, -0.1, -0.05], [0.12, 0.34, 0.34], { cast: true });
      blob(back, material, [0, -0.08, -0.3], [0.45, 0.42, 0.18], { cast: true });
      break;
    case 'curly':
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        blob(top, material, [Math.sin(a) * 0.38, 0.28 + Math.cos(i * 2) * 0.04, Math.cos(a) * 0.34 - 0.05], [0.19, 0.19, 0.19], { cast: true, small: true });
      }
      blob(top, material, [0, 0.46, -0.04], [0.28, 0.2, 0.28], { small: true });
      blob(back, material, [0, -0.02, -0.34], [0.4, 0.34, 0.14], { cast: true });
      break;
    case 'spiky':
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        solid(top, geo.cone(), material, [Math.sin(a) * 0.26, 0.52, Math.cos(a) * 0.24 - 0.04], [0.13, 0.28, 0.13], { rotation: [Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5] });
      }
      fringe([-0.2, 0, 0.2], 0.36, 0.34, [0.15, 0.1, 0.09], 0.2);
      blob(back, material, [0, 0.0, -0.32], [0.42, 0.32, 0.14], { cast: true });
      break;
    case 'ponytail':
      fringe([-0.32, -0.14, 0.06, 0.24], 0.35, 0.33, [0.17, 0.12, 0.1], 0.35);
      blob(back, material, [0, 0.0, -0.31], [0.44, 0.4, 0.17], { cast: true });
      blob(back, material, [-0.41, -0.02, -0.05], [0.1, 0.3, 0.3], { cast: true });
      blob(back, material, [0.41, -0.02, -0.05], [0.1, 0.3, 0.3], { cast: true });
      tail = new THREE.Group();
      tail.position.set(0, 0.2, -0.42);
      blob(tail, material, [0, -0.28, -0.08], [0.15, 0.36, 0.14], { cast: true });
      blob(tail, stdMat(PALETTE.yellow), [0, -0.02, -0.02], [0.1, 0.07, 0.1], { small: true });
      back.add(tail);
      break;
    default: // short
      fringe([-0.28, -0.1, 0.1, 0.3], 0.33, 0.35, [0.16, 0.1, 0.09], 0.25);
      blob(back, material, [0, 0.02, -0.3], [0.44, 0.34, 0.16], { cast: true });
  }
  return { hair: top, hairBack: back, tail };
}

function buildFace(head, skin, hairMaterial) {
  const eyes = [];
  const brows = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(side * 0.18, 0.04, 0.37);
    head.add(eye);
    blob(eye, m.eye(), [0, 0, 0], [0.115, 0.14, 0.07], { small: true });
    blob(eye, m.iris(), [side * -0.004, -0.005, 0.043], [0.078, 0.1, 0.04], { small: true });
    blob(eye, m.pupil(), [side * -0.004, -0.005, 0.066], [0.042, 0.06, 0.02], { small: true });
    blob(eye, stdMat('#ffffff', { roughness: 0.1 }), [side * 0.022, 0.035, 0.078], [0.02, 0.024, 0.012], { small: true });
    mergeVertexColored(eye, m.eyeVC());
    eyes.push(eye);
    const brow = blob(head, hairMaterial, [side * 0.18, 0.25, 0.385], [0.1, 0.022, 0.025], { rotation: [0, 0, side * 0.12], small: true });
    brows.push(brow);
    blob(head, m.cheek(), [side * 0.29, -0.1, 0.325], [0.075, 0.045, 0.02], { rotation: [0, side * 0.7, 0], small: true });
    blob(head, skin, [side * 0.455, -0.01, 0.0], [0.065, 0.1, 0.055], { small: true });
  }
  blob(head, skin, [0, -0.05, 0.425], [0.07, 0.06, 0.06], { small: true });
  const mouth = new THREE.Group();
  mouth.position.set(0, -0.16, 0.395);
  head.add(mouth);
  const open = blob(mouth, m.mouth(), [0, -0.005, 0], [0.065, 0.02, 0.02], { small: true });
  const smile = solid(mouth, geo.arc(), m.lip(), [0, 0.02, 0.005], [0.085, 0.06, 0.4], { rotation: [0, 0, Math.PI] });
  return { eyes, brows, mouth, open, smile };
}

function buildHelmet(head, style) {
  const helmet = new THREE.Group();
  const shell = stdMat(style.helmet, { roughness: 0.42 });
  const dark = stdMat(style.helmetDark, { roughness: 0.5 });
  const badge = stdMat(style.badge, { roughness: 0.4 });
  solid(helmet, geo.dome(), shell, [0, 0.07, 0], [0.55, 0.52, 0.51], { cast: true });
  solid(helmet, geo.cyl(), dark, [0, 0.065, -0.04], [0.62, 0.035, 0.58], { cast: true });
  blob(helmet, dark, [0, -0.02, -0.46], [0.4, 0.1, 0.18], { rotation: [0.4, 0, 0], small: true });
  solid(helmet, geo.box(), dark, [0, 0.55, -0.02], [0.07, 0.07, 0.62], { cast: true, rotation: [0.05, 0, 0] });
  blob(helmet, badge, [0, 0.27, 0.5], [0.15, 0.14, 0.035], { small: true });
  blob(helmet, shell, [0, 0.27, 0.53], [0.075, 0.07, 0.02], { small: true });
  solid(helmet, geo.cyl(), badge, [0, 0.16, 0], [0.545, 0.03, 0.505]);
  mergeByMaterial(helmet);
  helmet.position.set(0, 0.18, 0);
  head.add(helmet);
  return helmet;
}

/**
 * @param {object} options
 * @param {string} [options.name] подпись над головой
 * @param {object} [options.appearance] skin, hair, hairStyle, outfit, pants (см. appearanceFromSeed)
 * @param {THREE.Material|string} [options.outfit] материал/цвет повседневной одежды (приоритетнее appearance.outfit)
 * @param {'player'|'mentor'} [options.gear] стиль профессиональной экипировки
 * @param {boolean} [options.equipped] экипировка надета сразу (наставник)
 * @param {boolean} [options.helmet] каска надета сразу
 * @param {'clipboard'|null} [options.holding]
 */
export function createCharacter({ name, appearance = {}, outfit, gear = 'player', equipped = false, helmet = false, holding = null, nameScale = 1, subtitle = '' } = {}) {
  const look = { ...appearanceFromSeed(0), ...appearance };
  const style = GEAR_STYLES[gear] ?? GEAR_STYLES.player;
  const skin = stdMat(look.skin, { roughness: 0.62 });
  const hairMaterial = stdMat(look.hair, { roughness: 0.55 });
  const outfitMaterial = materialOf(outfit ?? look.outfit);
  const jacket = stdMat(style.jacket, { roughness: 0.6 });
  const pantsCasual = stdMat(look.pants, { roughness: 0.8 });
  const pantsFire = stdMat(style.pants, { roughness: 0.7 });
  const sneaker = stdMat('#fbf4e4', { roughness: 0.55 });
  const fireBoot = stdMat('#2b3335', { roughness: 0.45 });
  const sole = stdMat('#3a4547', { roughness: 0.7 });
  const reflective = stdMat(style.stripe, { roughness: 0.35, emissive: style.stripe, emissiveIntensity: 0.14 });

  const root = new THREE.Group();
  root.add(createContactShadow(0.62, 0.55, 0.36));
  const body = new THREE.Group();
  root.add(body);

  const torso = solid(body, geo.torso(), outfitMaterial, [0, TORSO_Y, 0], [1, 1, TORSO_DEPTH], { cast: true, receive: true });
  // Воротничок: у повседневной одежды — в цвет, у куртки — тёмный.
  const collar = solid(body, geo.ring(), stdMat('#ffffff', { roughness: 0.8 }), [0, TORSO_Y + 0.9, 0.0], [0.27, 0.07, 0.22]);
  collar.material = stdMat(PALETTE.trim, { roughness: 0.8, side: THREE.DoubleSide });

  // Ноги: пивот в бедре, чтобы ходьба была настоящим махом.
  const legs = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.2, 0.92, 0);
    body.add(pivot);
    const pants = solid(pivot, geo.cyl(), pantsCasual, [0, -0.34, 0], [0.165, 0.68, 0.165], { cast: true, receive: true });
    const boot = blob(pivot, sneaker, [0, -0.78, 0.07], [0.2, 0.135, 0.29], { cast: true });
    const bootSole = blob(pivot, sole, [0, -0.88, 0.07], [0.205, 0.04, 0.3], { small: true });
    const kneeBand = solid(pivot, geo.cyl(), reflective, [0, -0.52, 0], [0.175, 0.06, 0.175]);
    const cuff = solid(pivot, geo.cyl(), reflective, [0, -0.7, 0], [0.18, 0.04, 0.18]);
    kneeBand.visible = cuff.visible = false;
    return { pivot, pants, boot, kneeBand, cuff };
  });

  // Руки: пивот в плече; sleeve растягивается по оси Y (прицеливание рукавом), рука и манжета ездят вместе с ним.
  const arms = [-1, 1].map((side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.53, TORSO_Y + 0.78, 0);
    body.add(shoulder);
    const joint = blob(shoulder, outfitMaterial, [0, 0, 0], [0.19, 0.17, 0.18], { cast: true, small: true });
    const sleeve = solid(shoulder, geo.cyl(), outfitMaterial, [0, -ARM_LENGTH / 2, 0], [0.14, ARM_LENGTH, 0.14], { cast: true });
    const stripe = solid(shoulder, geo.cyl(), reflective, [0, -ARM_LENGTH * 0.7, 0], [0.152, 0.09, 0.152]);
    const hand = blob(shoulder, stdMat(style.glove, { roughness: 0.7 }), [0, -ARM_LENGTH, 0.01], [0.155, 0.16, 0.15], { cast: true, small: true });
    const bareHand = blob(shoulder, skin, [0, -ARM_LENGTH, 0.01], [0.135, 0.15, 0.13], { cast: true, small: true });
    stripe.visible = hand.visible = false;
    return { shoulder, joint, sleeve, stripe, hand, bareHand, side };
  });

  // Голова.
  const headGroup = new THREE.Group();
  headGroup.position.set(0, TORSO_Y + 1.22, 0.02);
  body.add(headGroup);
  blob(headGroup, skin, [0, 0, 0], [0.47, 0.45, 0.43], { cast: true, receive: true });
  solid(headGroup, geo.cyl(), skin, [0, -0.42, -0.02], [0.17, 0.2, 0.15]); // шея едет вместе с головой
  const face = buildFace(headGroup, skin, hairMaterial);
  const { hair, hairBack, tail } = buildHair(headGroup, look.hairStyle, hairMaterial);
  face.brows.forEach((brow) => { headGroup.remove(brow); hairBack.add(brow); });
  mergeByMaterial(headGroup);
  mergeByMaterial(hair);
  mergeByMaterial(hairBack);

  // Экипировка.
  const uniform = new THREE.Group();
  body.add(uniform);
  {
    const radius = torsoRadius(0.36) + 0.012;
    solid(uniform, geo.ring(), reflective, [0, TORSO_Y + 0.36, 0], [radius, 0.1, radius * TORSO_DEPTH + 0.005]);
  }
  const beltRadius = torsoRadius(0.16) + 0.02;
  solid(uniform, geo.ring(), stdMat('#2c3436', { roughness: 0.6 }), [0, TORSO_Y + 0.16, 0], [beltRadius, 0.1, beltRadius * TORSO_DEPTH + 0.01]);
  solid(uniform, geo.box(), stdMat(style.badge, { roughness: 0.35 }), [0, TORSO_Y + 0.16, beltRadius * TORSO_DEPTH + 0.02], [0.14, 0.11, 0.04]);
  solid(uniform, geo.ring(), stdMat(style.jacketDark, { roughness: 0.6, side: THREE.DoubleSide }), [0, TORSO_Y + 0.9, 0.01], [0.29, 0.1, 0.24]);
  // Молния и нагрудный карман делают куртку курткой, а не свитером с полосами.
  solid(uniform, geo.box(), stdMat('#2c3436', { roughness: 0.5 }), [0, TORSO_Y + 0.62, torsoRadius(0.62) * TORSO_DEPTH + 0.005], [0.03, 0.5, 0.02]);
  solid(uniform, geo.box(), stdMat(style.jacketDark, { roughness: 0.6 }), [0.2, TORSO_Y + 0.6, torsoRadius(0.6) * TORSO_DEPTH + 0.005], [0.17, 0.15, 0.025]);
  solid(uniform, geo.box(), stdMat(style.badge, { roughness: 0.4 }), [-0.2, TORSO_Y + 0.64, torsoRadius(0.64) * TORSO_DEPTH + 0.005], [0.1, 0.08, 0.02]);
  mergeByMaterial(uniform);
  uniform.visible = false;

  const helmetGroup = buildHelmet(headGroup, style);
  helmetGroup.visible = false;

  let clipboard = null;
  if (holding === 'clipboard') {
    clipboard = new THREE.Group();
    solid(clipboard, geo.box(), stdMat(PALETTE.wood, { roughness: 0.7 }), [0, 0, 0], [0.34, 0.46, 0.04]);
    solid(clipboard, geo.box(), stdMat('#fffdf3', { roughness: 0.8 }), [0, -0.01, 0.025], [0.28, 0.38, 0.01]);
    solid(clipboard, geo.box(), stdMat(PALETTE.steel, { roughness: 0.4 }), [0, 0.22, 0.03], [0.14, 0.04, 0.03]);
    clipboard.position.set(0.04, -ARM_LENGTH - 0.04, 0.18);
    clipboard.rotation.set(-0.9, 0, 0);
    arms[0].shoulder.add(clipboard);
  }

  const person = root;
  person.userData = {
    body, torso, arms, legs, head: headGroup, face, tail, hair, hairBack, clipboard,
    outfit: outfitMaterial,
    uniform,
    helmet: helmetGroup,
    gearStyle: style,
    gearMaterials: { jacket, pantsCasual, pantsFire, sneaker, fireBoot },
    holding,
    anim: { gait: 0, phase: 0, blinkAt: 2 + Math.random() * 3, blink: 0, wave: 0, talk: 0, look: 0, nod: 0, gesture: null, gestureT: 0, seed: Math.random() * 10, bodyTurn: 0 },
    armsLocked: false,
  };

  if (name) {
    const nameTag = createLabelSprite(name, { kind: 'name', subtitle });
    nameTag.position.set(0, 3.12, 0);
    nameTag.scale.multiplyScalar(nameScale);
    person.userData.nameTag = nameTag;
    person.add(nameTag);
  }

  setPersonEquipment(person, equipped, { helmet: helmet || equipped });
  return person;
}

/** Надеть/снять экипировку: куртка, полосы, пояс, перчатки, сапоги и каска переключаются вместе. */
export function setPersonEquipment(person, equipped, { helmet = Boolean(equipped) } = {}) {
  const active = Boolean(equipped);
  const u = person.userData;
  u.helmet.visible = Boolean(helmet);
  u.hair.visible = !helmet; // макушка и чёлка не должны торчать сквозь каску
  u.uniform.visible = active;
  u.torso.material = active ? u.gearMaterials.jacket : u.outfit;
  u.legs.forEach(({ pants, boot, kneeBand, cuff }) => {
    pants.material = active ? u.gearMaterials.pantsFire : u.gearMaterials.pantsCasual;
    boot.material = active ? u.gearMaterials.fireBoot : u.gearMaterials.sneaker;
    kneeBand.visible = cuff.visible = active;
  });
  u.arms.forEach(({ joint, sleeve, stripe, hand, bareHand }) => {
    joint.material = sleeve.material = active ? u.gearMaterials.jacket : u.outfit;
    stripe.visible = hand.visible = active;
    bareHand.visible = !active;
  });
}

/** Рука тянется к точке на расстоянии `length` от плеча (хват рукава); возвращает всё к покою при length = ARM_LENGTH. */
export function setArmReach(arm, length) {
  arm.sleeve.scale.y = length;
  arm.sleeve.position.y = -length / 2;
  arm.stripe.position.y = -length * 0.7;
  arm.hand.position.y = arm.bareHand.position.y = -length;
}

export function resetArms(person) {
  person.userData.armsLocked = false;
  person.userData.arms.forEach((arm) => {
    arm.shoulder.rotation.set(0, 0, 0);
    setArmReach(arm, ARM_LENGTH);
  });
}

/** Короткий жест: 'wave' (приветствие, 2.4 с) или 'nod' (кивок, 0.9 с). */
export function triggerGesture(person, kind) {
  const anim = person.userData.anim;
  anim.gesture = kind;
  anim.gestureT = 0;
}

const wrapAngle = (a) => ((((a) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
const approach = (value, target, rate, dt) => value + (target - value) * Math.min(1, dt * rate);

/**
 * Процедурная анимация одного кадра.
 * @param {object} state speed 0/1/2 (стоит/идёт/бежит, как поле anim в протоколе), talking, lookYaw (рад., относительно корпуса)
 */
export function animateCharacter(person, dt, t, { speed = 0, talking = false, lookYaw = 0 } = {}) {
  const u = person.userData;
  const a = u.anim;
  a.gait = approach(a.gait, speed, 10, dt);
  a.phase += dt * (8.5 + Math.max(0, a.gait - 1) * 4);
  const walk = Math.min(a.gait, 1);
  const run = Math.max(0, a.gait - 1);
  const swing = Math.sin(a.phase) * (0.62 * walk + 0.28 * run);

  u.legs.forEach(({ pivot }, i) => { pivot.rotation.x = swing * (i ? 1 : -1); });
  const bounce = Math.abs(Math.sin(a.phase)) * (0.05 * walk + 0.035 * run);
  const breath = Math.sin(t * 2 + a.seed) * 0.012 * (1 - walk);
  u.body.position.y = bounce;
  u.body.rotation.x = 0.07 * walk + 0.1 * run;
  u.torso.scale.y = 1 + breath;

  // Жест: волна или кивок по таймеру.
  if (a.gesture) {
    a.gestureT += dt;
    const length = a.gesture === 'wave' ? 2.4 : 0.9;
    if (a.gestureT >= length) a.gesture = null;
  }
  const waving = a.gesture === 'wave';
  a.wave = approach(a.wave, waving ? 1 : 0, 9, dt);
  a.talk = approach(a.talk, talking ? 1 : 0, 6, dt);
  const nod = a.gesture === 'nod' ? Math.sin((a.gestureT / 0.9) * Math.PI) * 0.28 : 0;

  // Голова: лёгкое покачивание, взгляд на собеседника, кивки при разговоре.
  a.look = approach(a.look, THREE.MathUtils.clamp(lookYaw, -0.95, 0.95), 7, dt);
  const idleSway = Math.sin(t * 0.7 + a.seed) * 0.06 * (1 - walk);
  u.head.rotation.set(
    nod + a.talk * Math.sin(t * 2.7) * 0.06 + Math.sin(t * 1.1 + a.seed) * 0.015,
    idleSway + a.look,
    Math.sin(t * 0.9 + a.seed) * 0.02,
  );

  // Моргание.
  a.blinkAt -= dt;
  if (a.blinkAt < 0) {
    a.blink = 0.14;
    a.blinkAt = 2.5 + Math.random() * 3.5;
  }
  a.blink = Math.max(0, a.blink - dt);
  const eyeScale = a.blink > 0 ? 0.12 : 1;
  u.face.eyes.forEach((eye) => { eye.scale.y = approach(eye.scale.y, eyeScale, 40, dt); });

  // Рот: улыбка в покое, открывается при разговоре.
  const open = a.talk * (0.35 + Math.abs(Math.sin(t * 9 + Math.sin(t * 2.3) * 2)) * 0.9);
  u.face.open.scale.y = 0.02 + open * 0.07;
  u.face.smile.scale.y = 0.06 * (1 + a.wave * 0.5) * (1 - Math.min(0.6, open));

  if (u.tail) u.tail.rotation.set(Math.sin(a.phase + 1) * 0.35 * walk + Math.sin(t * 1.6) * 0.04, 0, Math.sin(t * 1.3) * 0.05 + swing * 0.1);

  if (u.armsLocked) return;
  u.arms.forEach(({ shoulder, side }) => {
    const index = side < 0 ? 0 : 1;
    let x = -swing * (index ? 1 : -1) * 0.85;
    let z = side * (0.1 + Math.sin(t * 1.4 + index) * 0.02 + walk * 0.05);
    if (u.holding === 'clipboard' && index === 0) {
      x = -1.1 + Math.sin(t * 1.2) * 0.03 - a.talk * 0.1;
      z = -0.32;
    } else if (index === 1) {
      // Правая рука: приветствие или жестикуляция при разговоре.
      const wave = a.wave;
      const talk = a.talk * (1 - wave);
      x = x * (1 - wave - talk) + (-0.55 + Math.sin(t * 2.3) * 0.25) * talk;
      z = z * (1 - wave - talk) + (0.55 + Math.sin(t * 3.1) * 0.22) * talk + (2.45 + Math.sin(t * 9) * 0.28) * wave;
    }
    shoulder.rotation.set(x, 0, z);
  });
}

/** Угол от направления взгляда корпуса person к точке (x, z) в мире. */
export function yawToward(person, x, z) {
  return wrapAngle(Math.atan2(x - person.position.x, z - person.position.z) - person.rotation.y);
}

/** Освобождает то, что принадлежит одному персонажу; общие геометрии, материалы и текстуры art/ остаются. */
export function disposeCharacter(person) {
  person.traverse((node) => {
    if (node.geometry && !isSharedResource(node.geometry)) node.geometry.dispose();
    const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    for (const material of materials) {
      if (isSharedResource(material)) continue;
      if (material.map && !isSharedResource(material.map)) material.map.dispose();
      material.dispose();
    }
  });
}

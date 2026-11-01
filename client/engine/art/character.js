// Единая система персонажей Kidburg: игроки, другие игроки и наставники строятся одним конструктором.
// Крупная голова, мягкое тело, лицо с веками и эмоциями, причёски, одежда, профессиональные костюмы и процедурная
// анимация — без внешних моделей и скелетов. Внешность выводится из числа (id игрока), поэтому любые клиенты видят
// одного и того же человека без новых полей протокола. Модуль — публичный фасад: геометрия, лицо, волосы, одежда
// и анимация живут в character-*.js, а интерфейс (createCharacter, animateCharacter, setPersonEquipment…) прежний.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createContactShadow, isSharedResource, stdMat } from './materials.js';
import { createLabelSprite } from './labels.js';
import { QUALITY_LEVELS } from './quality.js';
import { shade, resolveAppearance } from './character-appearance.js';
import {
  ANKLE_Y, ARM_LENGTH, BUILD_PARAMS, HIP_Y, SHIN_LEN, THIGH_LEN, TORSO_DEPTH, TORSO_Y,
  facePartsGeometry, handGeometry, headGeometry, limbGeometry, pelvisGeometry, torsoGeometry, unit,
} from './character-geometry.js';
import { buildFace } from './character-face.js';
import { buildHair } from './character-hair.js';
import {
  COSTUMES, TOP_SPEC, buildAccessory, buildCasualTop, ensureCostume, ensureFireKit, ensureGloves, setShoes, shoeMaterials,
} from './character-outfits.js';
import { createAnimState, resetArms, setArmReach, setCarry, setExpression, getExpression, triggerGesture, animateCharacter, yawToward, GESTURES } from './character-animation.js';

export {
  ARM_LENGTH, GESTURES, animateCharacter, getExpression, resetArms, setArmReach, setCarry, setExpression, triggerGesture, yawToward,
};
export {
  ACCESSORIES, BROW_STYLES, BUILDS, EYE_SHAPES, FACE_SHAPES, HAIR_STYLES, MOUTH_STYLES, NOSE_STYLES, SHOE_STYLES, TOP_STYLES, appearanceFromSeed,
} from './character-appearance.js';
export { EXPRESSIONS } from './character-face.js';
export { COSTUMES };

// Пожарная часть показывает персонажа крупно; в городе его подгоняют под рост игрока 1.8 м.
export const CITY_CHARACTER_SCALE = 0.64;
export const COSTUME_IDS = Object.freeze(Object.keys(COSTUMES));

const FIRE_TOP = { gx: 1.08, gz: 1.1, sleeve: 'long', arm: 1.12, cuff: true };

const GEAR_STYLES = {
  // Игроки: красная куртка, жёлтые светоотражающие полосы, красная каска.
  player: { jacket: PALETTE.red, jacketDark: PALETTE.redDark, stripe: PALETTE.yellow, helmet: PALETTE.red, helmetDark: PALETTE.redDark, badge: PALETTE.yellow, pants: '#3b4a52', glove: PALETTE.charcoal },
  // Наставник: тёмно-бордовая куртка, белая каска и белые полосы — узнаётся издали.
  mentor: { jacket: '#9c3a31', jacketDark: '#7a2c28', stripe: '#f6d56a', helmet: '#fff1d2', helmetDark: '#e0c9a0', badge: '#e8a93a', pants: '#2f3e4a', glove: '#5a4a3c' },
};

const materialOf = (value) => (value?.isMaterial ? value : stdMat(value));

let defaultQuality = 'medium';
/** Уровень детализации новых персонажей (low/medium/high); уже созданные не перестраиваются. */
export function setCharacterQuality(level) {
  if (QUALITY_LEVELS.includes(level)) defaultQuality = level;
}
const detailOf = (quality) => Math.max(0, QUALITY_LEVELS.indexOf(quality ?? defaultQuality));

/** Реакции NPC на события игры: чисто визуальные (эмоция + жест), на логику и сервер не влияют. */
export const NPC_REACTIONS = Object.freeze({
  task_success: { expression: 'happy', duration: 2.6, gesture: 'approve' },
  task_error: { expression: 'thinking', duration: 2.4, gesture: null },
  task_complete: { expression: 'happy', duration: 3.2, gesture: 'approve' },
  greet: { expression: 'happy', duration: 2.4, gesture: 'wave' },
  talk_start: { expression: null, duration: 0, gesture: 'nod' },
  explain: { expression: 'focused', duration: 2, gesture: 'point' },
  surprise: { expression: 'surprised', duration: 1.6, gesture: 'surprise' },
});

export function reactToEvent(person, event) {
  const reaction = person.userData.personality?.reactions?.[event] ?? NPC_REACTIONS[event];
  if (!reaction) return false;
  if (reaction.expression) setExpression(person, reaction.expression, { duration: reaction.duration });
  if (reaction.gesture) triggerGesture(person, reaction.gesture);
  return true;
}

const mesh = (parent, geometry, material, { cast = false, receive = false } = {}) => {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  parent.add(m);
  return m;
};

/**
 * @param {object} options
 * @param {string} [options.name] подпись над головой
 * @param {object} [options.appearance] внешность (appearanceFromSeed или частичный набор полей)
 * @param {THREE.Material|string} [options.outfit] материал/цвет повседневной одежды (приоритетнее appearance.outfit)
 * @param {'player'|'mentor'} [options.gear] стиль пожарной экипировки
 * @param {boolean} [options.equipped] экипировка надета сразу
 * @param {boolean} [options.helmet] каска надета сразу
 * @param {'clipboard'|null} [options.holding]
 * @param {'low'|'medium'|'high'} [options.quality] детализация (по умолчанию — setCharacterQuality)
 * @param {{expression?: string, reactions?: object}} [options.personality] характер NPC: типичное лицо и реакции на события
 */
export function createCharacter({ name, appearance = {}, outfit, gear = 'player', equipped = false, helmet = false, holding = null, nameScale = 1, subtitle = '', quality, personality = null } = {}) {
  const look = resolveAppearance(appearance);
  const detail = detailOf(quality);
  const style = GEAR_STYLES[gear] ?? GEAR_STYLES.player;
  const build = BUILD_PARAMS[look.build] ?? BUILD_PARAMS.standard;
  const topName = TOP_SPEC[look.top] ? look.top : 'tee';
  const topSpec = TOP_SPEC[topName];
  const skin = stdMat(look.skin, { roughness: 0.62 });
  const hairMaterial = stdMat(look.hair, { roughness: 0.55 });
  const outfitMaterial = materialOf(outfit ?? look.outfit);
  const gearMaterials = {
    jacket: stdMat(style.jacket, { roughness: 0.6 }),
    pantsCasual: stdMat(look.pants, { roughness: 0.8 }),
    pantsFire: stdMat(style.pants, { roughness: 0.7 }),
    fireBoot: stdMat('#2b3335', { roughness: 0.45 }),
    fireSole: stdMat('#1f2628', { roughness: 0.7 }),
    glove: stdMat(style.glove, { roughness: 0.7 }),
    reflective: stdMat(style.stripe, { roughness: 0.35, emissive: style.stripe, emissiveIntensity: 0.14 }),
  };
  const shoes = shoeMaterials(look);
  gearMaterials.sneaker = look.shoes === 'boot' ? shoes.boot : shoes.sneaker;

  const root = new THREE.Group();
  root.add(createContactShadow(0.62, 0.55, 0.36));
  const body = new THREE.Group();
  root.add(body);
  const lean = new THREE.Group();
  lean.position.y = HIP_Y;
  body.add(lean);
  const spine = new THREE.Group();
  spine.position.y = -HIP_Y;
  lean.add(spine);

  const pelvis = mesh(body, pelvisGeometry(detail), gearMaterials.pantsCasual, { cast: true });
  pelvis.position.set(0, HIP_Y - 0.02, 0);
  const torso = mesh(spine, torsoGeometry(look.build, detail), outfitMaterial, { cast: true, receive: true });
  torso.position.set(0, TORSO_Y, 0);
  torso.scale.set(topSpec.gx, 1, TORSO_DEPTH * topSpec.gz);

  // Ноги: бедро → колено → щиколотка; пивоты дают настоящий мах, согнутое колено и стопу, лежащую на земле.
  const legs = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.2 * build.w, HIP_Y, 0);
    body.add(pivot);
    const thigh = mesh(pivot, limbGeometry('thigh', detail), gearMaterials.pantsCasual, { cast: true, receive: true });
    thigh.position.y = -THIGH_LEN * 0.5;
    thigh.scale.set(0.18, THIGH_LEN * 1.04, 0.18);
    const knee = new THREE.Group();
    knee.position.y = -THIGH_LEN;
    pivot.add(knee);
    const shin = mesh(knee, limbGeometry('shin', detail), gearMaterials.pantsCasual, { cast: true, receive: true });
    shin.position.y = -SHIN_LEN * 0.5;
    shin.scale.set(0.15, SHIN_LEN * 1.02, 0.15);
    const foot = new THREE.Group();
    foot.position.y = -SHIN_LEN;
    knee.add(foot);
    const boot = mesh(foot, shoeGeometryPlaceholder(), gearMaterials.sneaker, { cast: true });
    const sole = mesh(foot, shoeGeometryPlaceholder(), shoes.sole);
    const leg = { pivot, knee, foot, pants: thigh, shin, boot, sole, kneeBand: null, cuff: null };
    setShoes(leg, look.shoes, gearMaterials.sneaker, look.shoes === 'boot' ? shoes.sole : shoes.soleLight, detail);
    return leg;
  });

  // Руки: плечо → локоть → кисть; sleeve растягивается по оси Y (прицеливание рукавом), кисть и манжета едут вместе.
  const shoulderY = TORSO_Y + 0.78 * build.h;
  const handScale = 0.95 * build.hands;
  const arms = [-1, 1].map((side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * build.shoulderX, shoulderY, 0);
    spine.add(shoulder);
    const joint = mesh(shoulder, unit.sphere(detail), outfitMaterial, { cast: true });
    joint.scale.set(0.15 * topSpec.arm, 0.145 * topSpec.arm, 0.145 * topSpec.arm);
    const sleeve = mesh(shoulder, limbGeometry('upperArm', detail), outfitMaterial, { cast: true });
    const bare = mesh(shoulder, limbGeometry('upperArm', detail), skin, { cast: true });
    bare.visible = false;
    const elbow = new THREE.Group();
    shoulder.add(elbow);
    const forearm = mesh(elbow, limbGeometry('forearm', detail), outfitMaterial, { cast: true });
    const elbowBall = mesh(elbow, unit.sphere(detail), outfitMaterial);
    const cuff = mesh(elbow, unit.ring(), stdMat(shade('#ffffff', -0.1), { side: THREE.DoubleSide }));
    cuff.scale.set(0.125, 0.05, 0.125);
    cuff.visible = false;
    const bareHand = mesh(elbow, handGeometry(side, detail), skin, { cast: true });
    bareHand.scale.setScalar(handScale);
    const arm = { shoulder, elbow, joint, sleeve, bare, forearm, elbowBall, cuff, bareHand, hand: null, stripe: null, side, girth: topSpec.arm, cover: 1, reach: ARM_LENGTH, item: null };
    arm.reposition = () => setArmReach(arm, arm.reach);
    return arm;
  });

  // Голова.
  const headGroup = new THREE.Group();
  headGroup.position.set(0, TORSO_Y + 0.95 * build.h + 0.27, 0.02);
  spine.add(headGroup);
  mesh(headGroup, headGeometry(look.faceShape, detail), skin, { cast: true, receive: true });
  mesh(headGroup, facePartsGeometry(look, detail), skin, { cast: true });
  const face = buildFace(headGroup, look, { skin, hairMaterial, detail });
  const { hair, hairBack, tail } = buildHair(headGroup, look.hairStyle, hairMaterial, { detail, tieColor: look.hairStyle === 'ponytail' ? PALETTE.yellow : look.topAccent });

  // Экипировка и одежда: пожарные части строятся при первой надобности (повседневному игроку они не нужны).
  const uniform = new THREE.Group();
  spine.add(uniform);
  const helmetGroup = new THREE.Group();
  helmetGroup.position.set(0, 0.18, 0);
  headGroup.add(helmetGroup);
  uniform.visible = helmetGroup.visible = false;

  let clipboard = null;
  if (holding === 'clipboard') {
    clipboard = new THREE.Group();
    mesh(clipboard, unit.box(), stdMat(PALETTE.wood, { roughness: 0.7 })).scale.set(0.34, 0.46, 0.04);
    const sheet = mesh(clipboard, unit.box(), stdMat('#fffdf3', { roughness: 0.8 }));
    sheet.position.set(0, -0.01, 0.025);
    sheet.scale.set(0.28, 0.38, 0.01);
    const clip = mesh(clipboard, unit.box(), stdMat(PALETTE.steel, { roughness: 0.4 }));
    clip.position.set(0, 0.22, 0.03);
    clip.scale.set(0.14, 0.04, 0.03);
    clipboard.rotation.set(1.55, 0, 0);
    arms[0].elbow.add(clipboard);
    arms[0].item = clipboard;
    clipboard.position.set(0.03, -ARM_LENGTH / 2 - 0.04, 0.1);
  }

  const person = root;
  person.userData = {
    body, lean, spine, torso, torsoBase: { x: topSpec.gx, z: TORSO_DEPTH * topSpec.gz }, arms, legs, pelvis, head: headGroup, face, tail, hair, hairBack, clipboard,
    outfit: outfitMaterial,
    uniform,
    helmet: helmetGroup,
    gearStyle: style,
    gearMaterials,
    shoes,
    holding,
    look,
    detail,
    skin,
    layers: { fire: false, helmet: false, costume: null },
    topDetails: null,
    accessory: null,
    personality: personality ?? null,
    anim: createAnimState(look.seed),
    armsLocked: false,
  };
  arms.forEach((arm) => setArmReach(arm, ARM_LENGTH));
  person.userData.accessory = buildAccessory(person.userData, look, detail);
  if (personality?.expression) setExpression(person, personality.expression, { intensity: personality.intensity ?? 0.5 });

  if (name) {
    const nameTag = createLabelSprite(name, { kind: 'name', subtitle });
    nameTag.position.set(0, 3.12, 0);
    nameTag.scale.multiplyScalar(nameScale);
    person.userData.nameTag = nameTag;
    person.add(nameTag);
  }

  person.userData.layers.fire = Boolean(equipped);
  person.userData.layers.helmet = Boolean(helmet || equipped);
  applyLayers(person);
  return person;
}

// Геометрия обуви подставляется setShoes; до этого Mesh получает общий пустой буфер.
function shoeGeometryPlaceholder() {
  return unit.sphere(0);
}

function topDetailFor(u, topName, material) {
  u.topDetails ??= new Map();
  const key = `${topName}|${material.uuid}`;
  let entry = u.topDetails.get(key);
  if (!entry) {
    entry = buildCasualTop(u.spine, { ...u.look, top: topName }, material, u.detail);
    u.topDetails.set(key, entry);
  }
  return entry.group;
}

/** Единая точка, где слои одежды (повседневная → костюм профессии → пожарная форма) превращаются в видимость и материалы. */
function applyLayers(person) {
  const u = person.userData;
  const { fire, costume: costumeId } = u.layers;
  if (fire) ensureFireKit(person);
  const costume = !fire && costumeId ? ensureCostume(person, costumeId) : null;
  const look = u.look;

  let topMaterial = u.outfit;
  let spec = TOP_SPEC[look.top] ?? TOP_SPEC.tee;
  let detailName = look.top;
  if (fire) {
    topMaterial = u.gearMaterials.jacket;
    spec = FIRE_TOP;
  } else if (costume) {
    if (costume.topMaterial) topMaterial = costume.topMaterial;
    if (costume.spec.topSpec) { spec = TOP_SPEC[costume.spec.topSpec]; detailName = costume.spec.topSpec; }
  }
  const showTopDetail = !fire && (!costume || costume.spec.topDetail);

  u.torso.material = topMaterial;
  u.torsoBase.x = spec.gx;
  u.torsoBase.z = TORSO_DEPTH * spec.gz;
  u.torso.scale.set(spec.gx, u.torso.scale.y, TORSO_DEPTH * spec.gz);
  if (u.topDetails) for (const entry of u.topDetails.values()) entry.group.visible = false;
  if (showTopDetail) topDetailFor(u, detailName, topMaterial).visible = true;

  const short = spec.sleeve === 'short';
  const cuffMaterial = stdMat(shade(`#${topMaterial.color.getHexString()}`, -0.22), { roughness: 0.75, side: THREE.DoubleSide });
  const glove = fire ? u.gearMaterials.glove : costume?.gloveMaterial ?? null;
  if (glove) ensureGloves(person);
  u.arms.forEach((arm) => {
    arm.girth = spec.arm;
    arm.cover = short ? 0.5 : 1;
    arm.sleeve.geometry = limbGeometry(short ? 'sleeveShort' : 'upperArm', u.detail);
    arm.sleeve.material = arm.joint.material = topMaterial;
    arm.forearm.material = arm.elbowBall.material = short ? u.skin : topMaterial;
    arm.joint.scale.set(0.15 * spec.arm, 0.145 * spec.arm, 0.145 * spec.arm);
    arm.cuff.visible = spec.cuff;
    arm.cuff.material = cuffMaterial;
    arm.cuff.scale.set(0.128 * spec.arm, 0.05, 0.128 * spec.arm);
    if (arm.stripe) {
      arm.stripe.visible = fire;
      arm.stripe.scale.set(0.152 * spec.arm, 0.09, 0.152 * spec.arm);
    }
    if (arm.hand) {
      arm.hand.visible = Boolean(glove);
      if (glove) arm.hand.material = glove;
    }
    arm.bareHand.visible = !glove;
    arm.reposition();
  });

  const pants = fire ? u.gearMaterials.pantsFire : costume ? costume.pantsMaterial : u.gearMaterials.pantsCasual;
  u.pelvis.material = pants;
  u.legs.forEach((leg) => {
    leg.pants.material = leg.shin.material = pants;
    if (fire) setShoes(leg, 'safety', u.gearMaterials.fireBoot, u.gearMaterials.fireSole, u.detail);
    else if (costume) setShoes(leg, costume.spec.shoes.style, costume.shoeUpper, costume.shoeSole, u.detail);
    else setShoes(leg, look.shoes, u.gearMaterials.sneaker, look.shoes === 'boot' ? u.shoes.sole : u.shoes.soleLight, u.detail);
    if (leg.kneeBand) leg.kneeBand.visible = leg.cuff.visible = fire;
  });

  u.uniform.visible = fire;
  if (u.costumes) {
    for (const entry of Object.values(u.costumes)) {
      const on = entry === costume;
      entry.spineGroup.visible = on;
      entry.headGroup.visible = on && entry.headGroup.children.length > 0;
    }
  }
  const accessory = u.accessory;
  let accessoryVisible = true;
  if (accessory) {
    const heavy = accessory.kind === 'backpack' || accessory.kind === 'bag';
    const headwear = accessory.kind === 'cap' || accessory.kind === 'headband';
    accessoryVisible = !(heavy && (fire || costume)) && !(headwear && (fire || u.layers.helmet || costume?.spec.hat));
    accessory.group.visible = accessoryVisible;
  }
  const hat = Boolean(costume?.spec.hat);
  const capOn = accessory?.hidesHairTop && accessoryVisible;
  u.helmet.visible = u.layers.helmet;
  u.hair.visible = !(u.layers.helmet || (hat && costume?.spec.hidesHairTop) || capOn);
}

/** Надеть/снять экипировку: куртка, полосы, пояс, перчатки, сапоги и каска переключаются вместе. */
export function setPersonEquipment(person, equipped, { helmet = Boolean(equipped) } = {}) {
  const u = person.userData;
  u.layers.fire = Boolean(equipped);
  u.layers.helmet = Boolean(helmet);
  if (u.layers.helmet) ensureFireKit(person);
  applyLayers(person);
}

/** Костюм профессии ('baker', 'florist', 'musician', 'radio') или null; пожарная форма важнее костюма. */
export function setPersonCostume(person, id) {
  if (id && !COSTUMES[id]) return false;
  person.userData.layers.costume = id || null;
  applyLayers(person);
  return true;
}

export const getPersonCostume = (person) => person.userData.layers.costume;

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

// Одежда и экипировка: повседневные верхи, обувь, аксессуары, пожарный комплект и костюмы профессий.
// Геометрия деталей строится один раз на (вид, комплекцию, детализацию) и делится между людьми по «слотам»:
// слот = роль детали (основной цвет, акцент, тёмный, металл), а цвет слоту выдаёт материал конкретного человека.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { stdMat } from './materials.js';
import { shade } from './character-appearance.js';
import {
  BUILD_PARAMS, HEAD_RADII, TORSO_DEPTH, TORSO_Y, bake, blobPart, headFrontZ, mergeParts, shoeGeometry, torsoRadiusAt, unit,
} from './character-geometry.js';

const cache = new Map();

export const TOP_SPEC = Object.freeze({
  tee: { gx: 1, gz: 1, sleeve: 'short', arm: 1, cuff: false },
  hoodie: { gx: 1.07, gz: 1.1, sleeve: 'long', arm: 1.14, cuff: true },
  jacket: { gx: 1.05, gz: 1.07, sleeve: 'long', arm: 1.08, cuff: true },
  sweater: { gx: 1.06, gz: 1.08, sleeve: 'long', arm: 1.18, cuff: true },
  shirt: { gx: 1, gz: 1, sleeve: 'long', arm: 1.02, cuff: true },
});

/** Список деталей по слотам → слитые общие геометрии. */
function collect() {
  const slots = {};
  const api = {
    add: (slot, geometry) => { (slots[slot] ??= []).push(geometry); return api; },
    box: (slot, p, s, r) => api.add(slot, bake(unit.box(), p, s, r)),
    ball: (slot, p, s, r, seg = [10, 7]) => api.add(slot, blobPart(p, s, r, seg)),
    cyl: (slot, p, s, r) => api.add(slot, bake(unit.cyl(), p, s, r)),
    ring: (slot, p, s, r) => api.add(slot, bake(unit.ring(), p, s, r)),
    torus: (slot, p, s, r) => api.add(slot, bake(unit.torus(), p, s, r)),
    cone: (slot, p, s, r) => api.add(slot, bake(unit.cone(), p, s, r)),
    finish() {
      const result = {};
      for (const [slot, list] of Object.entries(slots)) {
        const merged = mergeParts(list);
        merged.userData.shared = true;
        result[slot] = merged;
      }
      return result;
    },
  };
  return api;
}

const cached = (key, make) => {
  let value = cache.get(key);
  if (!value) { value = make(); cache.set(key, value); }
  return value;
};

/** Меши по слотам внутрь группы: materials[slot] — материал; слот без материала пропускается. */
function attach(group, geoms, materials, cast = false) {
  const meshes = {};
  for (const [slot, geometry] of Object.entries(geoms)) {
    if (!materials[slot]) continue;
    const mesh = new THREE.Mesh(geometry, materials[slot]);
    mesh.castShadow = cast;
    group.add(mesh);
    meshes[slot] = mesh;
  }
  return meshes;
}

/** Точка на поверхности торса спереди: y — доля высоты торса, x — смещение; учитывает полноту одежды. */
function surface(build, spec, y, x = 0) {
  const r = torsoRadiusAt(build, y);
  const rx = r * spec.gx;
  const nx = Math.max(-0.95, Math.min(0.95, x / rx));
  return { rx, z: rx * Math.sqrt(1 - nx * nx) * TORSO_DEPTH * (spec.gz / spec.gx) };
}

const Y = (y) => TORSO_Y + y;

function topGeometry(top, build, detail) {
  return cached(`top:${top}:${build}:${detail}`, () => {
    const spec = TOP_SPEC[top];
    const k = collect();
    const bp = BUILD_PARAMS[build] ?? BUILD_PARAMS.standard;
    const hy = bp.h;
    const neckY = Y(0.9 * hy);
    const ringAt = (slot, y, grow, h) => {
      const r = torsoRadiusAt(build, y) * spec.gx + grow;
      k.ring(slot, [0, Y(y), 0], [r, h, r * TORSO_DEPTH * (spec.gz / spec.gx) + 0.004], [0, 0, 0]);
    };
    const front = (y, x = 0, lift = 0.008) => { const s = surface(build, spec, y, x); return s.z + lift; };
    switch (top) {
      case 'tee':
        k.ring('trim', [0, neckY, 0.0], [0.27, 0.06, 0.22], [0, 0, 0]);
        ringAt('accent', 0.52 * hy, 0.012, 0.09);
        ringAt('accent', 0.4 * hy, 0.012, 0.025);
        break;
      case 'hoodie':
        k.torus('dark', [0, neckY - 0.02, -0.02], [0.3, 0.26, 0.9], [Math.PI / 2, 0, 0]);
        k.ball('dark', [0, neckY + 0.02, -0.2], [0.3, 0.22, 0.16], [0, 0, 0]);
        k.box('dark', [0, Y(0.2 * hy), front(0.2 * hy) + 0.01], [0.5 * spec.gx, 0.22, 0.05], [-0.08, 0, 0]);
        k.cyl('accent', [-0.07, Y(0.68 * hy), front(0.68 * hy, -0.07) + 0.004], [0.012, 0.22, 0.012], [0.08, 0, 0]);
        k.cyl('accent', [0.07, Y(0.68 * hy), front(0.68 * hy, 0.07) + 0.004], [0.012, 0.2, 0.012], [0.08, 0, 0]);
        ringAt('dark', 0.03, 0.012, 0.07);
        k.ball('accent', [0.17, Y(0.55 * hy), front(0.55 * hy, 0.17) + 0.004], [0.07, 0.07, 0.015], [0, 0, 0]);
        break;
      case 'jacket':
        k.ring('dark', [0, neckY, 0.0], [0.29, 0.12, 0.24], [0, 0, 0]);
        k.box('metal', [0, Y(0.5 * hy), front(0.5 * hy) + 0.004], [0.024, 0.8 * hy, 0.014], [0, 0, 0]);
        for (const x of [-0.19, 0.19]) k.box('dark', [x, Y(0.2 * hy), front(0.2 * hy, x) + 0.012], [0.17, 0.13, 0.04], [-0.1, 0, 0]);
        ringAt('dark', 0.035, 0.012, 0.075);
        k.ball('accent', [-0.2, Y(0.64 * hy), front(0.64 * hy, -0.2) + 0.004], [0.08, 0.07, 0.014], [0, 0, 0]);
        break;
      case 'sweater':
        k.torus('light', [0, neckY - 0.03, 0], [0.27, 0.23, 0.55], [Math.PI / 2, 0, 0]);
        ringAt('light', 0.035, 0.014, 0.085);
        ringAt('accent', 0.55 * hy, 0.014, 0.075);
        ringAt('accent', 0.44 * hy, 0.014, 0.03);
        break;
      default: // shirt
        k.box('light', [-0.12, neckY - 0.05, front(0.82 * hy, -0.12) + 0.004], [0.14, 0.08, 0.025], [0.1, 0.1, 0.55]);
        k.box('light', [0.12, neckY - 0.05, front(0.82 * hy, 0.12) + 0.004], [0.14, 0.08, 0.025], [0.1, -0.1, -0.55]);
        k.ring('light', [0, neckY - 0.01, 0], [0.26, 0.04, 0.215], [0, 0, 0]);
        k.box('light', [0, Y(0.45 * hy), front(0.45 * hy) + 0.003], [0.05, 0.78 * hy, 0.012], [0, 0, 0]);
        for (let i = 0; i < 4; i++) k.ball('trim', [0, Y((0.78 - i * 0.2) * hy), front((0.78 - i * 0.2) * hy) + 0.012], [0.02, 0.02, 0.012], [0, 0, 0], [6, 5]);
        k.box('dark', [0.19, Y(0.62 * hy), front(0.62 * hy, 0.19) + 0.006], [0.13, 0.13, 0.02], [0, 0, 0]);
    }
    return k.finish();
  });
}

/** Слоты материалов повседневного верха: main — цвет игрока, остальные — оттенки. */
function topMaterials(look, mainMaterial) {
  const color = `#${mainMaterial.color.getHexString()}`;
  return {
    main: mainMaterial,
    dark: stdMat(shade(color, -0.25), { roughness: 0.75 }),
    light: stdMat(shade(color, 0.4), { roughness: 0.8 }),
    accent: stdMat(look.topAccent, { roughness: 0.7 }),
    trim: stdMat(PALETTE.trim, { roughness: 0.8, side: THREE.DoubleSide }),
    metal: stdMat('#cfd5d3', { roughness: 0.35 }),
  };
}

/** Деталь повседневного верха (воротник, карманы, молния…): одна группа, видна без экипировки. */
export function buildCasualTop(spine, look, mainMaterial, detail) {
  const group = new THREE.Group();
  spine.add(group);
  const materials = topMaterials(look, mainMaterial);
  const ringMaterials = { ...materials, trim: stdMat(PALETTE.trim, { roughness: 0.8, side: THREE.DoubleSide }) };
  attach(group, topGeometry(look.top, look.build, detail), ringMaterials, true);
  return { group, materials };
}

export function shoeMaterials(look) {
  return {
    sneaker: stdMat(look.shoeColor, { roughness: 0.55 }),
    boot: stdMat(look.bootColor, { roughness: 0.6 }),
    sole: stdMat('#3a4547', { roughness: 0.7 }),
    soleLight: stdMat('#f1ead8', { roughness: 0.7 }),
  };
}

export function setShoes(leg, style, upperMaterial, soleMaterial, detail) {
  leg.boot.geometry = shoeGeometry(style, 'upper', detail);
  leg.sole.geometry = shoeGeometry(style, 'sole', detail);
  leg.boot.material = upperMaterial;
  leg.sole.material = soleMaterial;
}

/** Аксессуар по внешности: возвращает {group, hidesHair, anchor} или null. */
export function buildAccessory(u, look, detail) {
  const kind = look.accessory;
  if (!kind || kind === 'none') return null;
  const color = look.accessoryColor;
  const mats = { main: stdMat(color, { roughness: 0.65 }), dark: stdMat(shade(color, -0.35), { roughness: 0.7 }), strap: stdMat('#3a4547', { roughness: 0.7 }), frame: stdMat('#2f3a3d', { roughness: 0.4 }), metal: stdMat('#cfd5d3', { roughness: 0.35 }) };
  const build = look.build;
  const k = collect();
  let parent = u.spine;
  let hidesHairTop = false;
  const back = (y) => torsoRadiusAt(build, y) * TORSO_DEPTH;
  const key = `acc:${kind}:${build}:${look.faceShape}:${detail}`;
  const geoms = cached(key, () => {
    switch (kind) {
      case 'backpack':
        k.ball('main', [0, Y(0.5), -back(0.5) - 0.17], [0.31, 0.38, 0.18], [0, 0, 0], [12, 8]);
        k.ball('dark', [0, Y(0.3), -back(0.3) - 0.3], [0.2, 0.14, 0.07], [0, 0, 0]);
        k.ball('dark', [0, Y(0.73), -back(0.73) - 0.07], [0.2, 0.06, 0.07], [0, 0, 0]);
        for (const x of [-0.2, 0.2]) k.box('strap', [x, Y(0.6), back(0.6) * Math.sqrt(1 - (x / torsoRadiusAt(build, 0.6)) ** 2) * 1.0 + 0.012], [0.07, 0.62, 0.03], [-0.08, 0, 0]);
        break;
      case 'bag':
        k.ring('strap', [0, Y(0.45), 0], [torsoRadiusAt(build, 0.45) + 0.03, 0.07, (torsoRadiusAt(build, 0.45) + 0.03) * TORSO_DEPTH], [0, 0, 0.5]);
        k.ball('main', [-0.5, Y(0.1), 0.02], [0.17, 0.2, 0.26], [0, 0, 0.1], [10, 7]);
        k.ball('dark', [-0.5, Y(0.22), 0.02], [0.18, 0.06, 0.27], [0, 0, 0.1]);
        break;
      case 'glasses':
        for (const side of [-1, 1]) {
          const x = side * 0.185;
          const z = headFrontZ(look.faceShape, x, 0.035) + 0.012;
          k.torus('frame', [x, 0.035, z], [0.125, 0.125, 0.4], [0, 0, 0]);
          k.cyl('frame', [side * 0.42, 0.04, z - 0.2], [0.012, 0.4, 0.012], [Math.PI / 2, 0, 0]);
        }
        k.box('frame', [0, 0.045, headFrontZ(look.faceShape, 0, 0.045) + 0.01], [0.07, 0.015, 0.015], [0, 0, 0]);
        break;
      case 'cap':
        k.add('main', bake(unit.dome(), [0, 0.09, -0.02], [0.52, 0.5, 0.5], [0, 0, 0]));
        k.ball('dark', [0, 0.11, 0.43], [0.32, 0.035, 0.26], [0.3, 0, 0], [12, 6]);
        k.ball('dark', [0, 0.6, -0.02], [0.05, 0.04, 0.05], [0, 0, 0], [6, 5]);
        break;
      case 'headband':
        k.torus('main', [0, 0.2, -0.015], [0.5, 0.45, 0.52], [Math.PI / 2 - 0.12, 0, 0]);
        k.ball('dark', [0.32, 0.27, 0.33], [0.06, 0.06, 0.04], [0, 0, 0], [6, 5]);
        break;
      default:
    }
    return k.finish();
  });
  if (['glasses', 'cap', 'headband'].includes(kind)) parent = u.head;
  if (kind === 'cap') hidesHairTop = true;
  const group = new THREE.Group();
  parent.add(group);
  attach(group, geoms, mats, kind !== 'glasses');
  return { group, kind, hidesHairTop, onHead: parent === u.head };
}

// ---------------------------------------------------------------------------------------------
// Пожарный комплект
// ---------------------------------------------------------------------------------------------

function fireUniformGeometry(build) {
  return cached(`fire:${build}`, () => {
    const spec = { gx: 1.08, gz: 1.1 };
    const k = collect();
    const hy = (BUILD_PARAMS[build] ?? BUILD_PARAMS.standard).h;
    const ringAt = (slot, y, grow, h) => {
      const r = torsoRadiusAt(build, y) * spec.gx + grow;
      k.ring(slot, [0, Y(y), 0], [r, h, r * TORSO_DEPTH * (spec.gz / spec.gx) + 0.005], [0, 0, 0]);
    };
    const z = (y, x = 0) => surface(build, spec, y, x).z + 0.006;
    ringAt('stripe', 0.36 * hy, 0.012, 0.1);
    ringAt('stripe', 0.5 * hy, 0.012, 0.025);
    ringAt('belt', 0.16 * hy, 0.02, 0.1);
    k.box('badge', [0, Y(0.16 * hy), z(0.16 * hy, 0) + 0.014], [0.14, 0.11, 0.04], [0, 0, 0]);
    ringAt('jacketDark', 0.9 * hy, 0.012, 0.11);
    k.box('belt', [0, Y(0.62 * hy), z(0.62 * hy)], [0.03, 0.5 * hy, 0.02], [0, 0, 0]);
    k.box('jacketDark', [0.2, Y(0.6 * hy), z(0.6 * hy, 0.2)], [0.17, 0.15, 0.025], [0, 0, 0]);
    k.box('badge', [-0.2, Y(0.64 * hy), z(0.64 * hy, -0.2)], [0.1, 0.08, 0.02], [0, 0, 0]);
    // Накладки на плечи: защитная куртка читается плотнее повседневной.
    for (const side of [-1, 1]) k.ball('jacketDark', [side * 0.4 * (BUILD_PARAMS[build]?.w ?? 1), Y(0.9 * hy), 0], [0.2, 0.07, 0.19], [0, 0, side * -0.35]);
    return k.finish();
  });
}

function helmetGeometry() {
  return cached('fire:helmet', () => {
    const k = collect();
    k.add('shell', bake(unit.dome(), [0, 0.07, 0], [0.55, 0.52, 0.51]));
    k.cyl('dark', [0, 0.065, -0.04], [0.62, 0.035, 0.58]);
    k.ball('dark', [0, -0.02, -0.46], [0.4, 0.1, 0.18], [0.4, 0, 0], [12, 7]);
    k.box('dark', [0, 0.55, -0.02], [0.07, 0.07, 0.62], [0.05, 0, 0]);
    k.ball('badge', [0, 0.27, 0.5], [0.15, 0.14, 0.035], [0, 0, 0], [10, 7]);
    k.ball('shell', [0, 0.27, 0.53], [0.075, 0.07, 0.02], [0, 0, 0], [8, 6]);
    k.cyl('badge', [0, 0.16, 0], [0.545, 0.03, 0.505]);
    return k.finish();
  });
}

/** Перчаточная «варежка» поверх кожаной ладони: создаётся один раз, материал выдаёт экипировка. */
export function ensureGloves(person) {
  const u = person.userData;
  u.arms.forEach((arm) => {
    if (arm.hand) return;
    arm.hand = new THREE.Mesh(arm.bareHand.geometry, u.gearMaterials.glove);
    arm.hand.scale.copy(arm.bareHand.scale);
    arm.hand.castShadow = true;
    arm.elbow.add(arm.hand);
    arm.hand.visible = false;
    arm.hand.position.y = arm.bareHand.position.y;
  });
}

/** Лениво строит пожарный комплект: куртка, каска, перчатки, светоотражающие кольца, защитная обувь. */
export function ensureFireKit(person) {
  const u = person.userData;
  if (u.fireBuilt) return;
  u.fireBuilt = true;
  const style = u.gearStyle;
  const mats = {
    stripe: u.gearMaterials.reflective,
    belt: stdMat('#2c3436', { roughness: 0.6 }),
    badge: stdMat(style.badge, { roughness: 0.35 }),
    jacketDark: stdMat(style.jacketDark, { roughness: 0.6, side: THREE.DoubleSide }),
  };
  attach(u.uniform, fireUniformGeometry(u.look.build), mats, true);
  attach(u.helmet, helmetGeometry(), {
    shell: stdMat(style.helmet, { roughness: 0.42 }),
    dark: stdMat(style.helmetDark, { roughness: 0.5 }),
    badge: stdMat(style.badge, { roughness: 0.4 }),
  }, true);
  ensureGloves(person);
  u.arms.forEach((arm) => {
    arm.stripe = new THREE.Mesh(unit.cyl(), u.gearMaterials.reflective);
    arm.stripe.visible = false;
    arm.elbow.add(arm.stripe);
    arm.stripe.position.y = -arm.reach * 0.275;
  });
  u.legs.forEach((leg) => {
    leg.kneeBand = new THREE.Mesh(unit.cyl(), u.gearMaterials.reflective);
    leg.kneeBand.scale.set(0.147, 0.05, 0.147);
    leg.knee.add(leg.kneeBand);
    leg.cuff = new THREE.Mesh(unit.cyl(), u.gearMaterials.reflective);
    leg.cuff.scale.set(0.112, 0.045, 0.112);
    leg.cuff.position.y = -0.2;
    leg.knee.add(leg.cuff);
    leg.kneeBand.visible = leg.cuff.visible = false;
  });
}

// ---------------------------------------------------------------------------------------------
// Костюмы профессий
// ---------------------------------------------------------------------------------------------

/**
 * Каждый костюм: цвета (top/pants/shoes/glove), необязательный головной убор, детали на торсе и голове.
 * Игровых механик костюмы не добавляют: это только внешний вид, который выбирает состояние станции.
 */
export const COSTUMES = {
  baker: {
    label: 'Пекарь',
    top: '#f8f4ea', topSpec: 'jacket', pants: '#41566a', shoes: { style: 'safety', upper: '#f1ece0', sole: '#8d99a0' },
    hat: true, hidesHairTop: true, glove: null, topDetail: false,
    spine(k, build) {
      const hy = (BUILD_PARAMS[build] ?? BUILD_PARAMS.standard).h;
      const spec = TOP_SPEC.jacket;
      const z = (y, x = 0) => surface(build, spec, y, x).z;
      k.ring('main', [0, Y(0.9 * hy), 0], [0.29, 0.1, 0.24]);
      k.ring('accent', [0, Y(0.04), 0], [torsoRadiusAt(build, 0.04) * spec.gx + 0.012, 0.07, torsoRadiusAt(build, 0.04) * spec.gx * TORSO_DEPTH + 0.02]);
      for (const x of [-0.1, 0.1]) for (let i = 0; i < 3; i++) k.ball('metal', [x, Y((0.74 - i * 0.2) * hy), z((0.74 - i * 0.2) * hy, x) + 0.01], [0.026, 0.026, 0.016], [0, 0, 0], [6, 5]);
      // Фартук: нагрудник, юбка, карман и лямка.
      k.box('apron', [0, Y(0.4 * hy), z(0.4 * hy) + 0.045], [0.58, 0.62 * hy, 0.03], [-0.04, 0, 0]);
      k.box('apronDark', [0, Y(0.24 * hy), z(0.24 * hy) + 0.07], [0.3, 0.16, 0.03], [-0.04, 0, 0]);
      k.torus('apron', [0, Y(0.87 * hy), 0], [0.3, 0.28, 0.55], [Math.PI / 2 - 0.2, 0, 0]);
      k.box('apron', [0, Y(0.1 * hy), -z(0.1 * hy) - 0.02], [0.5, 0.07, 0.03], [0, 0, 0]);
    },
    head(k) {
      k.cyl('main', [0, 0.5, -0.02], [0.3, 0.2, 0.3]);
      k.ball('main', [0, 0.72, -0.02], [0.4, 0.27, 0.4], [0, 0, 0], [14, 9]);
      k.ball('main', [0.16, 0.66, 0.12], [0.2, 0.18, 0.2], [0, 0, 0], [10, 7]);
      k.ball('main', [-0.16, 0.66, 0.1], [0.2, 0.18, 0.2], [0, 0, 0], [10, 7]);
      k.cyl('accent', [0, 0.4, -0.02], [0.315, 0.04, 0.315]);
    },
    palette: { main: '#fbf7ee', accent: '#d9482f', metal: '#d8d3c4', apron: '#e9edf0', apronDark: '#c7d3da' },
  },
  florist: {
    label: 'Флорист',
    top: null, pants: '#5b6f86', shoes: { style: 'boot', upper: '#4f7d4a', sole: '#2e4a33' },
    glove: '#c8d36b', hat: false, topDetail: true,
    spine(k, build) {
      const hy = (BUILD_PARAMS[build] ?? BUILD_PARAMS.standard).h;
      const spec = TOP_SPEC.shirt;
      const z = (y, x = 0) => surface(build, spec, y, x).z;
      k.box('apron', [0, Y(0.52 * hy), z(0.52 * hy) + 0.04], [0.42, 0.46 * hy, 0.03], [-0.06, 0, 0]);
      k.box('apron', [0, Y(0.18 * hy), z(0.18 * hy) + 0.06], [0.62, 0.34, 0.03], [-0.06, 0, 0]);
      for (const x of [-0.17, 0.17]) k.box('apron', [x, Y(0.88 * hy), z(0.88 * hy) * 0.35], [0.05, 0.12, 0.3], [-0.55, 0, 0]);
      for (const x of [-0.17, 0.17]) k.box('apronDark', [x, Y(0.16 * hy), z(0.16 * hy) + 0.09], [0.2, 0.15, 0.03], [-0.06, 0, 0]);
      k.box('belt', [0, Y(0.33 * hy), z(0.33 * hy) + 0.075], [0.64, 0.035, 0.035], [-0.06, 0, 0]);
      k.ball('petal', [-0.12, Y(0.72 * hy), z(0.72 * hy, -0.12) + 0.06], [0.05, 0.05, 0.016], [0, 0, 0], [6, 5]);
      k.ball('petal', [-0.17, Y(0.7 * hy), z(0.7 * hy, -0.17) + 0.06], [0.05, 0.05, 0.016], [0, 0, 0], [6, 5]);
      k.ball('petal', [-0.145, Y(0.76 * hy), z(0.76 * hy, -0.145) + 0.06], [0.05, 0.05, 0.016], [0, 0, 0], [6, 5]);
      k.ball('center', [-0.145, Y(0.72 * hy), z(0.72 * hy, -0.145) + 0.07], [0.028, 0.028, 0.014], [0, 0, 0], [6, 5]);
      k.cyl('metal', [0.17, Y(0.22 * hy), z(0.22 * hy, 0.17) + 0.105], [0.01, 0.12, 0.01], [0, 0, -0.2]);
      k.cyl('metal', [0.2, Y(0.22 * hy), z(0.22 * hy, 0.2) + 0.105], [0.01, 0.12, 0.01], [0, 0, 0.2]);
    },
    head(k, look) {
      const x = 0.3;
      const z = headFrontZ(look.faceShape, x, 0.27);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        k.ball('petal', [x + Math.cos(a) * 0.045, 0.3 + Math.sin(a) * 0.045, z - 0.01], [0.04, 0.04, 0.02], [0, 0.6, 0], [6, 5]);
      }
      k.ball('center', [x, 0.3, z], [0.028, 0.028, 0.02], [0, 0.6, 0], [6, 5]);
    },
    palette: { apron: '#4f9a8c', apronDark: '#3a7468', belt: '#6b4a38', petal: '#f4b6c2', center: '#f4c94d', metal: '#cfd5d3' },
  },
  musician: {
    label: 'Музыкант',
    top: '#40304f', topSpec: 'jacket', pants: '#26282e', shoes: { style: 'boot', upper: '#2b2a30', sole: '#14161a' },
    glove: null, hat: false, topDetail: false,
    spine(k, build) {
      const hy = (BUILD_PARAMS[build] ?? BUILD_PARAMS.standard).h;
      const spec = TOP_SPEC.jacket;
      const z = (y, x = 0) => surface(build, spec, y, x).z;
      k.box('shirt', [0, Y(0.62 * hy), z(0.62 * hy) + 0.006], [0.2, 0.52 * hy, 0.014], [0, 0, 0]);
      k.box('gold', [-0.14, Y(0.7 * hy), z(0.7 * hy, -0.14) + 0.012], [0.07, 0.42 * hy, 0.02], [0.05, 0, -0.22]);
      k.box('gold', [0.14, Y(0.7 * hy), z(0.7 * hy, 0.14) + 0.012], [0.07, 0.42 * hy, 0.02], [0.05, 0, 0.22]);
      k.ring('gold', [0, Y(0.9 * hy), 0], [0.285, 0.05, 0.235]);
      k.ring('gold', [0, Y(0.04), 0], [torsoRadiusAt(build, 0.04) * spec.gx + 0.012, 0.045, torsoRadiusAt(build, 0.04) * spec.gx * TORSO_DEPTH + 0.02]);
      // Бабочка.
      k.cone('bow', [-0.07, Y(0.86 * hy), z(0.86 * hy) + 0.02], [0.05, 0.1, 0.04], [0, 0, Math.PI / 2]);
      k.cone('bow', [0.07, Y(0.86 * hy), z(0.86 * hy) + 0.02], [0.05, 0.1, 0.04], [0, 0, -Math.PI / 2]);
      k.ball('bow', [0, Y(0.86 * hy), z(0.86 * hy) + 0.024], [0.03, 0.03, 0.03], [0, 0, 0], [6, 5]);
      // Ремень гитары через грудь.
      k.box('strap', [0, Y(0.5 * hy), z(0.5 * hy, 0) + 0.04], [0.06, 1.15, 0.025], [0, 0, 0.5]);
      k.ball('gold', [-0.3, Y(0.58 * hy), z(0.58 * hy, -0.3) + 0.03], [0.045, 0.06, 0.012], [0, 0, 0], [6, 5]);
    },
    head() {},
    palette: { shirt: '#f5efe2', gold: '#e2b94f', bow: '#d9482f', strap: '#1f2528' },
  },
  radio: {
    label: 'Радиоведущий',
    top: '#2d7c86', topSpec: 'hoodie', pants: '#3a4a5c', shoes: { style: 'sneaker', upper: '#f4f0e8', sole: '#e8725c' },
    glove: null, hat: false, topDetail: true,
    spine(k, build) {
      const hy = (BUILD_PARAMS[build] ?? BUILD_PARAMS.standard).h;
      const spec = TOP_SPEC.hoodie;
      const z = (y, x = 0) => surface(build, spec, y, x).z;
      k.ball('onair', [0.2, Y(0.62 * hy), z(0.62 * hy, 0.2) + 0.012], [0.075, 0.075, 0.014], [0, 0, 0], [10, 7]);
      k.ball('white', [0.2, Y(0.62 * hy), z(0.62 * hy, 0.2) + 0.022], [0.035, 0.035, 0.008], [0, 0, 0], [8, 6]);
    },
    head(k) {
      k.add('dark', bake(unit.band(), [0, 0.02, 0], [0.57, 0.57, 0.9], [0, 0, 0]));
      for (const side of [-1, 1]) {
        k.cyl('dark', [side * 0.55, 0.02, 0.0], [0.17, 0.09, 0.17], [0, 0, Math.PI / 2]);
        k.cyl('cushion', [side * 0.5, 0.02, 0.0], [0.15, 0.04, 0.15], [0, 0, Math.PI / 2]);
      }
      k.cyl('dark', [-0.5, -0.08, 0.2], [0.012, 0.3, 0.012], [0.9, 0.7, 0.0]);
      k.ball('onair', [-0.28, -0.2, 0.43], [0.045, 0.04, 0.04], [0, 0, 0], [8, 6]);
    },
    palette: { onair: '#d9482f', white: '#ffffff', dark: '#2b3335', cushion: '#e8725c' },
  },
};

const costumeGeometry = (id, part, look, detail) => cached(`costume:${id}:${part}:${part === 'spine' ? look.build : look.faceShape}:${detail}`, () => {
  const k = collect();
  COSTUMES[id][part](k, part === 'spine' ? look.build : look, look);
  return k.finish();
});

/** Лениво строит детали костюма профессии на торсе и голове. */
export function ensureCostume(person, id) {
  const u = person.userData;
  u.costumes ??= {};
  if (u.costumes[id]) return u.costumes[id];
  const spec = COSTUMES[id];
  if (!spec) return null;
  const palette = Object.fromEntries(Object.entries(spec.palette).map(([slot, color]) => [slot, stdMat(color, { roughness: 0.65, side: THREE.DoubleSide })]));
  const spineGroup = new THREE.Group();
  const headGroup = new THREE.Group();
  u.spine.add(spineGroup);
  u.head.add(headGroup);
  attach(spineGroup, costumeGeometry(id, 'spine', u.look, u.detail), palette, true);
  attach(headGroup, costumeGeometry(id, 'head', u.look, u.detail), palette, true);
  const hasHead = headGroup.children.length > 0;
  headGroup.visible = hasHead;
  const entry = {
    id, spec, spineGroup, headGroup,
    topMaterial: spec.top ? stdMat(spec.top, { roughness: 0.6 }) : null,
    pantsMaterial: stdMat(spec.pants, { roughness: 0.75 }),
    gloveMaterial: spec.glove ? stdMat(spec.glove, { roughness: 0.7 }) : null,
    shoeUpper: stdMat(spec.shoes.upper, { roughness: 0.55 }),
    shoeSole: stdMat(spec.shoes.sole, { roughness: 0.7 }),
  };
  spineGroup.visible = headGroup.visible = false;
  u.costumes[id] = entry;
  return entry;
}

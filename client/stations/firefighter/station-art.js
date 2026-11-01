// Художественные модели пожарной станции: здание, грузовик, учебная стена, шкаф экипировки, стойка рукава,
// манекен, безопасная зона, ограждения и маркер цели. Все статические детали склеены по материалам (createBatch):
// тысячи полигонов — единицы вызовов отрисовки. Размеры, позиции и координаты игровых точек не менялись.
import * as THREE from 'three';
import { PALETTE } from '../../engine/art/palette.js';
import { createBatch, createContactShadow, roundedBox, softBlobTexture, stdMat, texturedMat, worldUVBox } from '../../engine/art/materials.js';
import { createSignPlate } from '../../engine/art/labels.js';
import { SAFETY_ZONE } from './safety-zone.js';
import { createProgress, createStateMachine, easeInOutSine } from '../../engine/animated.js';

let cached = null;
function mats() {
  if (cached) return cached;
  cached = {
    plaster: texturedMat(PALETTE.plaster, 'plaster', { vertexColors: true }),
    plasterFlat: texturedMat(PALETTE.plaster, 'plaster'),
    brick: texturedMat('#ffffff', 'bricks', { vertexColors: true }),
    brickFlat: texturedMat('#ffffff', 'bricks'),
    roof: texturedMat(PALETTE.roof, 'roofTiles'),
    concrete: texturedMat(PALETTE.concrete, 'concrete'),
    trim: stdMat(PALETTE.trim, { roughness: 0.7 }),
    red: stdMat(PALETTE.red, { roughness: 0.5 }),
    redDark: stdMat(PALETTE.redDark, { roughness: 0.55 }),
    yellow: stdMat(PALETTE.yellow, { roughness: 0.45 }),
    orange: stdMat(PALETTE.orange, { roughness: 0.55 }),
    steel: stdMat(PALETTE.steel, { roughness: 0.4, metalness: 0.2 }),
    steelBlue: stdMat('#5f8fa0', { roughness: 0.5 }),
    steelBlueLight: stdMat('#76a3b2', { roughness: 0.5 }),
    charcoal: stdMat(PALETTE.charcoal, { roughness: 0.6 }),
    ink: stdMat(PALETTE.ink, { roughness: 0.5 }),
    wood: stdMat(PALETTE.wood, { roughness: 0.75 }),
    woodDark: stdMat(PALETTE.woodDark, { roughness: 0.8 }),
    green: stdMat(PALETTE.green, { roughness: 0.6 }),
    greenDark: stdMat(PALETTE.greenDark, { roughness: 0.6 }),
    white: stdMat(PALETTE.white, { roughness: 0.6 }),
    cream: stdMat('#f1e6cb', { roughness: 0.7 }),
    glass: stdMat('#a9d6dc', { roughness: 0.12, emissive: '#6aa3ae', emissiveIntensity: 0.28 }),
    glassWarm: stdMat('#ffe6a6', { roughness: 0.3, emissive: '#ffc45e', emissiveIntensity: 0.55 }),
    glassDark: stdMat('#3b4f55', { roughness: 0.25, emissive: '#1d2b2f', emissiveIntensity: 0.2 }),
    tire: stdMat('#232b2c', { roughness: 0.85 }),
    lampOn: stdMat('#fff0c0', { roughness: 0.3, emissive: '#ffd37a', emissiveIntensity: 1 }),
    lightRed: stdMat('#ff6a55', { roughness: 0.3, emissive: '#ff3b2a', emissiveIntensity: 0.8 }),
    lightBlue: stdMat('#79c3ff', { roughness: 0.3, emissive: '#3d8cff', emissiveIntensity: 0.8 }),
    dummy: stdMat('#f0b25c', { roughness: 0.8 }),
    dummyLight: stdMat('#efe2c6', { roughness: 0.8 }),
    soil: stdMat('#6b4d3a', { roughness: 1 }),
  };
  return cached;
}

const unit = {
  cyl: new THREE.CylinderGeometry(1, 1, 1, 14),
  cylLow: new THREE.CylinderGeometry(1, 1, 1, 8),
  ball: new THREE.SphereGeometry(1, 14, 10),
  cone: new THREE.ConeGeometry(1, 1, 4),
  plane: new THREE.PlaneGeometry(1, 1),
};

/** Скруглённый блок: rb(b, материал, w,h,d, x,y,z). */
const rb = (b, material, w, h, d, x, y, z, rot = [0, 0, 0], r = 0.05) => b.add(roundedBox(w, h, d, r), material, [x, y, z], rot);
const cyl = (b, material, radius, length, x, y, z, rot = [0, 0, 0], low = false) => b.add(low ? unit.cylLow : unit.cyl, material, [x, y, z], rot, [radius, length, radius]);
const ball = (b, material, sx, sy, sz, x, y, z) => b.add(unit.ball, material, [x, y, z], [0, 0, 0], [sx, sy, sz]);

/** Окно: стекло, рама, крестовина, подоконник и наличник. Центр — в середине проёма, лицо вдоль +Z. */
function windowUnit(b, M, x, y, z, w, h, { warm = false } = {}) {
  rb(b, warm ? M.glassWarm : M.glass, w - 0.12, h - 0.12, 0.05, x, y, z, [0, 0, 0], 0.02);
  rb(b, M.trim, w, 0.11, 0.15, x, y + h / 2 - 0.055, z + 0.06, [0, 0, 0], 0.03);
  rb(b, M.trim, w, 0.11, 0.15, x, y - h / 2 + 0.055, z + 0.06, [0, 0, 0], 0.03);
  rb(b, M.trim, 0.11, h, 0.15, x - w / 2 + 0.055, y, z + 0.06, [0, 0, 0], 0.03);
  rb(b, M.trim, 0.11, h, 0.15, x + w / 2 - 0.055, y, z + 0.06, [0, 0, 0], 0.03);
  rb(b, M.trim, 0.06, h - 0.1, 0.1, x, y, z + 0.05, [0, 0, 0], 0.02);
  rb(b, M.trim, w - 0.1, 0.06, 0.1, x, y + 0.08, z + 0.05, [0, 0, 0], 0.02);
  rb(b, M.concrete, w + 0.36, 0.1, 0.34, x, y - h / 2 - 0.08, z + 0.14, [0, 0, 0], 0.04);
  rb(b, M.redDark, w + 0.24, 0.14, 0.24, x, y + h / 2 + 0.1, z + 0.1, [0, 0, 0], 0.04);
}

/** Гаражные ворота с глубоким откосом: рамка выступает, полотно утоплено, секции с окошками. */
function garageBay(b, M, cx, width, height, baseY) {
  const wall = 4.5;
  rb(b, M.trim, 0.32, height + 0.3, 0.42, cx - width / 2 - 0.16, baseY + height / 2 + 0.1, wall + 0.2, [0, 0, 0], 0.05);
  rb(b, M.trim, 0.32, height + 0.3, 0.42, cx + width / 2 + 0.16, baseY + height / 2 + 0.1, wall + 0.2, [0, 0, 0], 0.05);
  rb(b, M.trim, width + 0.8, 0.44, 0.48, cx, baseY + height + 0.2, wall + 0.22, [0, 0, 0], 0.07);
  rb(b, M.redDark, width + 0.95, 0.12, 0.54, cx, baseY + height + 0.48, wall + 0.24, [0, 0, 0], 0.04);
  rb(b, M.ink, width, height, 0.1, cx, baseY + height / 2, wall - 0.02, [0, 0, 0], 0.01); // тёмный проём

}

function gooseneckLamp(b, M, x, y, z) {
  cyl(b, M.charcoal, 0.03, 0.55, x, y, z + 0.27, [Math.PI / 2, 0, 0], true);
  b.add(unit.cone, M.charcoal, [x, y - 0.1, z + 0.56], [Math.PI, Math.PI / 4, 0], [0.19, 0.22, 0.19]);
  ball(b, M.lampOn, 0.07, 0.06, 0.07, x, y - 0.17, z + 0.56);
}

/** Здание пожарной части: плинтус, оштукатуренные стены с предрасчитанным затемнением у земли, двускатная крыша, башня. */
export function buildStation() {
  const M = mats();
  const b = createBatch();
  const wallTop = 6.0;

  rb(b, M.concrete, 13.6, 0.5, 9.6, 0, 0.25, 0, [0, 0, 0], 0.08);
  b.add(worldUVBox(13, 5.6, 9, 2.2, { aoHeight: 2.2, aoStrength: 0.32, heightSegments: 8 }), M.plaster, [0, 0.5 + 2.8, 0]);
  b.add(worldUVBox(13.14, 0.9, 9.14, 1.6), M.brickFlat, [0, 0.95, 0]);
  rb(b, M.redDark, 13.5, 0.14, 9.5, 0, 1.46, 0, [0, 0, 0], 0.04);

  // Ворота, вход, окна.
  garageBay(b, M, -3.7, 3.9, 3.5, 0.5);
  garageBay(b, M, 0.4, 3.9, 3.5, 0.5);
  b.at([4.2, 0, 4.5], 0, () => {
    rb(b, M.trim, 0.2, 2.75, 0.3, -0.75, 1.85, 0.12);
    rb(b, M.trim, 0.2, 2.75, 0.3, 0.75, 1.85, 0.12);
    rb(b, M.trim, 1.7, 0.2, 0.3, 0, 3.3, 0.12);
    rb(b, M.green, 1.3, 2.45, 0.1, 0, 1.72, 0.0);
    rb(b, M.glass, 0.8, 0.9, 0.05, 0, 2.2, 0.07, [0, 0, 0], 0.02);
    rb(b, M.trim, 0.9, 0.1, 0.08, 0, 2.2, 0.08, [0, 0, 0], 0.02);
    cyl(b, M.yellow, 0.05, 0.24, 0.45, 1.6, 0.1, [Math.PI / 2, 0, 0], true);
    rb(b, M.redDark, 2.1, 0.12, 1.1, 0, 3.55, 0.68, [0.1, 0, 0], 0.05);
    rb(b, M.trim, 0.1, 0.6, 0.1, -0.95, 3.2, 1.06);
    rb(b, M.trim, 0.1, 0.6, 0.1, 0.95, 3.2, 1.06);
    gooseneckLamp(b, M, 0, 3.2, 0.05);
    rb(b, M.concrete, 1.7, 0.1, 0.9, 0, 0.55, 0.5, [0, 0, 0], 0.03);
  });
  windowUnit(b, M, 5.75, 3.0, 4.5, 0.9, 1.3, { warm: true });
  for (const sx of [-1, 1]) {
    b.at([sx * 6.5, 0, 0], sx * Math.PI / 2, () => {
      for (const z of [-2.2, 2.0]) windowUnit(b, M, z * sx, 3.0, 0, 1.3, 1.5);
      windowUnit(b, M, 0, 5.1, 0.0, 0.8, 0.8, { warm: true });
    });
  }

  // Угловые камни фасада.
  for (const sx of [-1, 1]) for (let i = 0; i < 7; i++) {
    const wide = i % 2 ? 0.62 : 0.42;
    rb(b, i % 2 ? M.cream : M.trim, wide, 0.62, 0.16, sx * (6.5 - wide / 2 + 0.02), 0.9 + i * 0.78, 4.55, [0, 0, 0], 0.04);
    rb(b, i % 2 ? M.trim : M.cream, 0.16, 0.62, wide, sx * 6.55, 0.9 + i * 0.78, 4.5 - wide / 2 + 0.02, [0, 0, 0], 0.04);
  }
  // Водосток.
  for (const sx of [-1, 1]) cyl(b, M.steel, 0.07, 5.7, sx * 6.62, 3.3, 4.62, [0, 0, 0], true);
  cyl(b, M.steel, 0.09, 13.8, 0, 5.78, 5.12, [0, 0, Math.PI / 2], true);

  // Крыша: два ската со свесом, коньковый валик, фронтоны и трубы.
  const rise = 2.5;
  const angle = Math.atan2(rise, 4.5);
  const slope = 5.2 / Math.cos(angle);
  for (const side of [-1, 1]) {
    b.add(worldUVBox(14, 0.3, slope, 2), M.roof, [0, 7.0, side * 2.62], [side * angle, 0, 0]);
  }
  rb(b, M.redDark, 14.3, 0.26, 0.55, 0, wallTop + rise + 0.08, 0, [0, 0, 0], 0.08);
  for (const sx of [-1, 1]) {
    const gable = new THREE.Shape();
    gable.moveTo(-4.5, 0); gable.lineTo(4.5, 0); gable.lineTo(0, rise); gable.closePath();
    const geometry = new THREE.ExtrudeGeometry(gable, { depth: 0.3, bevelEnabled: false });
    b.add(geometry, M.plasterFlat, [sx * 6.5 + (sx > 0 ? -0.15 : -0.15), wallTop - 0.05, 0], [0, Math.PI / 2, 0]);
  }
  rb(b, M.brickFlat, 1.0, 2.0, 1.0, -4.6, 8.0, -1.6, [0, 0, 0], 0.05);
  rb(b, M.concrete, 1.25, 0.2, 1.25, -4.6, 9.05, -1.6, [0, 0, 0], 0.04);

  // Башня для сушки рукавов: даёт зданию узнаваемый силуэт издали.
  b.add(worldUVBox(2.5, 6.1, 2.5, 1.6), M.brickFlat, [4.9, 8.85, -1.8]);
  rb(b, M.trim, 2.8, 0.22, 2.8, 4.9, 11.95, -1.8, [0, 0, 0], 0.05);
  b.add(unit.cone, M.roof, [4.9, 13.1, -1.8], [0, Math.PI / 4, 0], [2.2, 2.3, 2.2]);
  cyl(b, M.yellow, 0.06, 0.7, 4.9, 14.5, -1.8, [0, 0, 0], true);
  ball(b, M.yellow, 0.14, 0.14, 0.14, 4.9, 14.9, -1.8);
  for (const sx of [0, 1, 2, 3]) {
    const a = (sx * Math.PI) / 2;
    b.at([4.9, 0, -1.8], a, () => {
      rb(b, M.trim, 1.0, 1.2, 0.12, 0, 11.05, 1.28, [0, 0, 0], 0.05);
      rb(b, M.glassDark, 0.7, 0.9, 0.08, 0, 11.05, 1.33, [0, 0, 0], 0.03);
      for (let i = 0; i < 4; i++) rb(b, M.trim, 0.7, 0.05, 0.06, 0, 10.75 + i * 0.2, 1.38, [0, 0, 0], 0.01);
      cyl(b, M.trim, 0.55, 0.12, 0, 9.6, 1.32, [Math.PI / 2, 0, 0], false);
      cyl(b, M.white, 0.44, 0.14, 0, 9.6, 1.33, [Math.PI / 2, 0, 0], false);
      rb(b, M.charcoal, 0.05, 0.36, 0.05, 0, 9.72, 1.42, [0, 0, 0], 0.01);
      rb(b, M.charcoal, 0.28, 0.05, 0.05, 0.1, 9.6, 1.42, [0, 0, 0], 0.01);
    });
  }

  const group = new THREE.Group();
  group.add(b.build());

  // Вывеска над воротами: большая табличка и три лампы над ней.
  const sign = createSignPlate('ПОЖАРНАЯ ЧАСТЬ', 7.6, 1.0, { color: PALETTE.redDark });
  sign.position.set(-1.65, 5.2, 4.78);
  group.add(sign);
  const lampBatch = createBatch();
  for (const x of [-4.8, -1.65, 1.5]) gooseneckLamp(lampBatch, M, x, 5.95, 4.55);
  group.add(lampBatch.build());

  // Эмблема на фронтоне: красный щит с пламенем.
  for (const sx of [-1, 1]) {
    const emblem = new THREE.Group();
    emblem.position.set(sx * 6.66, 7.0, 0);
    emblem.rotation.y = sx * Math.PI / 2;
    const disc = new THREE.Mesh(unit.cyl, M.red);
    disc.rotation.x = Math.PI / 2;
    disc.scale.set(0.62, 0.1, 0.62);
    const flame = new THREE.Mesh(unit.cone, M.yellow);
    flame.scale.set(0.3, 0.55, 0.12);
    flame.rotation.y = Math.PI / 4;
    flame.position.z = 0.1;
    emblem.add(disc, flame);
    group.add(emblem);
  }
  group.add(createContactShadow(7.3, 5.2, 0.28));
  return group;
}

/** Пожарная машина: скруглённая кабина, секции с рольставнями, лестница на крыше, мигалка. */
export function buildFireTruck() {
  const M = mats();
  const b = createBatch();
  rb(b, M.charcoal, 5.1, 0.5, 2.1, 0, 0.62, 0, [0, 0, 0], 0.08);
  rb(b, M.red, 2.7, 1.4, 2.2, 1.2, 1.55, 0, [0, 0, 0], 0.14);
  rb(b, M.red, 2.25, 1.75, 2.15, -1.35, 1.62, 0, [0, 0, 0], 0.3);
  rb(b, M.white, 5.1, 0.2, 2.24, 0, 1.0, 0, [0, 0, 0], 0.05);
  rb(b, M.redDark, 2.6, 0.12, 2.25, 1.2, 2.3, 0, [0, 0, 0], 0.05);
  rb(b, M.glass, 0.08, 0.85, 1.7, -2.42, 2.05, 0, [0, 0, -0.22], 0.03);
  for (const sz of [-1, 1]) {
    rb(b, M.glass, 1.15, 0.72, 0.06, -1.3, 2.05, sz * 1.1, [0, 0, 0], 0.03);
    rb(b, M.steel, 0.5, 0.05, 0.05, -1.05, 1.62, sz * 1.12, [0, 0, 0], 0.01);
    rb(b, M.steelBlueLight, 2.0, 0.95, 0.05, 1.2, 1.55, sz * 1.12, [0, 0, 0], 0.03);
    for (let i = 0; i < 5; i++) rb(b, M.steelBlue, 1.92, 0.04, 0.06, 1.2, 1.2 + i * 0.18, sz * 1.13, [0, 0, 0], 0.01);
    rb(b, M.steel, 0.5, 0.06, 0.07, 1.2, 1.97, sz * 1.15, [0, 0, 0], 0.02);
    for (const x of [-1.5, 1.5]) {
      rb(b, M.redDark, 1.3, 0.12, 0.42, x, 1.12, sz * 1.04, [0, 0, 0], 0.05);
    }
    ball(b, M.lampOn, 0.14, 0.13, 0.08, -2.48, 1.0, sz * 0.72);
    ball(b, M.lightRed, 0.1, 0.12, 0.07, 2.58, 1.2, sz * 0.95);
  }
  rb(b, M.steel, 0.25, 0.32, 2.12, -2.56, 0.62, 0, [0, 0, 0], 0.08);
  rb(b, M.ink, 0.06, 0.5, 1.0, -2.5, 1.3, 0, [0, 0, 0], 0.02);
  rb(b, M.steel, 0.18, 0.2, 2.1, 2.6, 0.5, 0, [0, 0, 0], 0.05);
  rb(b, M.trim, 0.45, 0.16, 1.5, -1.2, 2.58, 0, [0, 0, 0], 0.06);
  // Лестница и рукава на крыше.
  for (const z of [-0.8, 0.8]) cyl(b, M.orange, 0.1, 2.3, 1.2, 2.5, z, [0, 0, Math.PI / 2], true);
  const group = new THREE.Group();
  group.add(b.build());
  group.add(createContactShadow(3.1, 1.6, 0.34));
  const wheels = [];
  for (const z of [-1, 1]) for (const x of [-1.5, 1.5]) {
    const wheel = new THREE.Group();
    const parts = createBatch();
    cyl(parts, M.tire, 0.56, 0.36, 0, 0, 0, [Math.PI / 2, 0, 0]);
    cyl(parts, M.steel, 0.3, 0.4, 0, 0, 0, [Math.PI / 2, 0, 0]);
    cyl(parts, M.yellow, 0.12, 0.43, 0, 0, 0, [Math.PI / 2, 0, 0], true);
    wheel.add(parts.build());
    wheel.position.set(x, 0.56, z);
    group.add(wheel);
    wheels.push(wheel);
  }
  const turntable = new THREE.Group();
  turntable.position.set(0.2, 2.52, 0);
  const ladder = new THREE.Group();
  turntable.add(ladder);
  group.add(turntable);
  const makeLadder = (length, width) => {
    const batch = createBatch();
    for (const z of [-width / 2, width / 2]) rb(batch, M.white, length, 0.07, 0.07, length / 2, 0, z);
    for (let x = 0.15; x < length; x += 0.38) cyl(batch, M.white, 0.025, width, x, 0, 0, [Math.PI / 2, 0, 0], true);
    return batch.build();
  };
  ladder.add(makeLadder(2.8, 0.8));
  const extension = makeLadder(2.4, 0.55);
  extension.position.y = 0.1;
  ladder.add(extension);
  const lights = [-1, 1].map((side) => {
    const color = side < 0 ? 0xff3b2a : 0x3d8cff;
    const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.2 });
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.5), material);
    light.position.set(-1.2, 2.7, side * 0.55);
    group.add(light);
    return light;
  });
  const progress = createProgress({ duration: 4 });
  let previous = null;
  const machine = createStateMachine({ initial: 'idle', transitions: {
    idle: ['deploying'], deploying: ['deployed', 'retracting'],
    deployed: ['retracting'], retracting: ['idle', 'deploying'],
  } });
  const syncState = () => machine.force(progress.moving
    ? (progress.target === 1 ? 'deploying' : 'retracting')
    : (progress.value === 1 ? 'deployed' : 'idle'));
  const mechanism = {
    get state() { return machine.state; },
    setState(next) {
      if (next !== 'deploying' && next !== 'retracting') return false;
      progress.go(next === 'deploying' ? 1 : 0);
      syncState();
      return true;
    },
    get wantsOpen() { return progress.target === 1; },
    get progress() { return progress.value; },
    applyRemote({ deployed, progress: value, elapsedMs = 0 }) {
      if (Number.isFinite(value)) progress.jump(value);
      progress.go(deployed ? 1 : 0, elapsedMs / 1000);
      syncState();
    },
    toggle() { this.setState(progress.target === 1 ? 'retracting' : 'deploying'); },
    update(dt, elapsed) {
      const distance = previous ? (group.position.x - previous.x) * Math.cos(group.rotation.y) - (group.position.z - previous.z) * Math.sin(group.rotation.y) : 0;
      for (const wheel of wheels) wheel.rotation.z -= distance / 0.56;
      if (!previous) previous = group.position.clone();
      else previous.copy(group.position);
      progress.update(dt);
      syncState();
      const p = easeInOutSine(progress.value);
      turntable.rotation.y = p * 0.4;
      ladder.rotation.z = p * 0.65;
      extension.position.x = Math.max(0, (p - 0.4) / 0.6) * 1.3;
      lights.forEach((light, i) => { light.material.emissiveIntensity = 0.15 + 1.5 * Math.max(0, Math.sin(elapsed * 5 + i * Math.PI)); });
    },
    wheels, turntable, ladder, extension, lights,
  };
  group.userData.mechanism = mechanism;
  return group;
}

const flameShape = (() => {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(-0.42, 0.12, -0.3, 0.62, -0.08, 0.9);
  shape.bezierCurveTo(-0.12, 0.54, 0.16, 0.6, 0.2, 1.1);
  shape.bezierCurveTo(0.56, 0.52, 0.44, 0.08, 0, 0);
  return shape;
})();

/**
 * Учебная стена: кирпичная кладка, четыре окна с глубокими откосами и условным пламенем.
 * Позиции панелей окон (pane) совпадают с серверным layout: по ним работает прицел.
 */
export function buildTrainingWall({ center, windows, windowDepth }) {
  const M = mats();
  const b = createBatch();
  rb(b, M.concrete, 7.3, 0.4, 1.1, 0, 0.2, 0, [0, 0, 0], 0.06);
  b.add(worldUVBox(6.8, 6.6, 0.55, 1.6, { aoHeight: 1.6, aoStrength: 0.3, heightSegments: 8 }), M.brick, [0, 3.7, 0]);
  rb(b, M.redDark, 7.3, 0.34, 0.9, 0, 7.15, 0, [0, 0, 0], 0.07);
  rb(b, M.trim, 7.0, 0.1, 0.7, 0, 6.93, 0, [0, 0, 0], 0.03);
  const reveals = [];
  windows.forEach((w) => {
    const x = w.x - center.x;
    const y = w.y;
    const z = windowDepth - 0.1;
    rb(b, M.woodDark, 2.5, 0.2, 0.34, x, y + 1.15, z, [0, 0, 0], 0.05);
    rb(b, M.woodDark, 2.6, 0.14, 0.46, x, y - 1.15, z + 0.05, [0, 0, 0], 0.05);
    rb(b, M.wood, 0.2, 2.1, 0.32, x - 1.07, y, z, [0, 0, 0], 0.05);
    rb(b, M.wood, 0.2, 2.1, 0.32, x + 1.07, y, z, [0, 0, 0], 0.05);
    rb(b, M.charcoal, 0.07, 1.82, 0.09, x, y, windowDepth + 0.06, [0, 0, 0], 0.02);
    rb(b, M.charcoal, 1.9, 0.07, 0.09, x, y, windowDepth + 0.06, [0, 0, 0], 0.02);
    reveals.push({ x, y });
  });
  const group = new THREE.Group();
  group.position.set(center.x, 0, center.z);
  group.add(b.build());
  const plaque = createSignPlate('УЧЕБНАЯ СТЕНА', 3.6, 0.62, { color: PALETTE.redDark });
  plaque.position.set(0, 6.35, 0.34);
  group.add(plaque);

  const paneMaterial = stdMat('#3c4d54', { roughness: 0.4, emissive: '#5a2a14', emissiveIntensity: 0.4 });
  const flameOuter = new THREE.MeshBasicMaterial({ color: '#f26a2c', transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });
  const flameMid = new THREE.MeshBasicMaterial({ color: '#ffa43c', transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });
  const flameInner = new THREE.MeshBasicMaterial({ color: '#ffe27a', transparent: true, opacity: 0.98, side: THREE.DoubleSide, depthWrite: false });
  const flameGeometry = new THREE.ShapeGeometry(flameShape, 12);
  const glowMap = softBlobTexture();
  const glowMaterial = new THREE.MeshBasicMaterial({ color: '#ff8a3a', map: glowMap, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const sootMaterial = new THREE.MeshBasicMaterial({ color: '#1d1a18', map: glowMap, transparent: true, opacity: 0.2, depthWrite: false });
  const flameParts = [];
  const result = windows.map((w, index) => {
    const x = w.x - center.x;
    const y = w.y;
    const pane = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.8, 0.08), paneMaterial);
    pane.position.set(x, y, windowDepth);
    pane.userData.windowIndex = index;
    pane.castShadow = true;
    group.add(pane);
    const soot = new THREE.Mesh(unit.plane, sootMaterial);
    soot.position.set(x, y + 1.55, 0.29);
    soot.scale.set(2.6, 1.2, 1);
    group.add(soot);
    const flames = new THREE.Group();
    flames.position.set(x, y - 0.78, windowDepth + 0.12);
    const glow = new THREE.Mesh(unit.plane, glowMaterial);
    glow.position.set(0, 0.85, -0.02);
    glow.scale.set(2.5, 2.0, 1);
    flames.add(glow);
    for (let i = 0; i < 5; i++) {
      const layer = i % 3;
      const flame = new THREE.Mesh(flameGeometry, [flameOuter, flameMid, flameInner][layer]);
      const size = [1.0, 0.8, 0.55][layer] * (0.85 + (i % 2) * 0.25);
      flame.position.set(-0.7 + i * 0.35, 0.02, 0.01 * i);
      flame.scale.set(size * 1.1, size * 1.05, 1);
      flames.add(flame);
      flameParts.push(flame);
    }
    group.add(flames);
    return { pane, flames };
  });
  return { group, windows: result, flameParts, dispose: () => { flameGeometry.dispose(); } };
}

/** Шкаф экипировки: стальные дверцы с вентиляцией, витрина с курткой и каской, сапоги рядом. */
export function buildLocker() {
  const M = mats();
  const b = createBatch();
  rb(b, M.charcoal, 1.5, 0.14, 0.95, 0, 0.07, 0, [0, 0, 0], 0.03);
  rb(b, M.steelBlue, 1.5, 2.4, 0.95, 0, 1.34, 0, [0, 0, 0], 0.09);
  rb(b, M.steelBlueLight, 1.58, 0.12, 1.03, 0, 2.6, 0, [0, 0, 0], 0.05);
  for (const sx of [-1, 1]) {
    rb(b, M.steelBlueLight, 0.68, 1.5, 0.06, sx * 0.36, 0.95, 0.5, [0, 0, 0], 0.03);
    cyl(b, M.yellow, 0.035, 0.34, sx * 0.08, 0.95, 0.56, [0, 0, 0], true);
    for (let i = 0; i < 4; i++) rb(b, M.steelBlue, 0.5, 0.03, 0.04, sx * 0.36, 0.3 + i * 0.07, 0.54, [0, 0, 0], 0.01);
  }
  rb(b, M.redDark, 1.18, 0.82, 0.06, 0, 2.0, 0.5, [0, 0, 0], 0.04);
  rb(b, M.glassDark, 1.04, 0.68, 0.05, 0, 2.0, 0.54, [0, 0, 0], 0.03);
  // Витрина: красная куртка на вешалке и каска.
  ball(b, M.red, 0.3, 0.32, 0.1, 0, 1.93, 0.46);
  ball(b, M.red, 0.14, 0.26, 0.09, -0.34, 1.88, 0.46);
  ball(b, M.red, 0.14, 0.26, 0.09, 0.34, 1.88, 0.46);
  rb(b, M.yellow, 0.5, 0.05, 0.05, 0, 1.97, 0.5, [0, 0, 0], 0.01);
  rb(b, M.yellow, 0.5, 0.05, 0.05, 0, 1.85, 0.5, [0, 0, 0], 0.01);
  // Сапоги у шкафа.
  for (const x of [-0.5, -0.26]) {
    ball(b, M.ink, 0.1, 0.14, 0.2, x, 0.14, 0.82);
    rb(b, M.yellow, 0.18, 0.04, 0.2, x, 0.3, 0.8, [0, 0, 0], 0.01);
  }
  const group = new THREE.Group();
  group.add(b.build());
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.red);
  helmet.scale.set(0.2, 0.17, 0.2);
  helmet.position.set(0.28, 2.1, 0.46);
  const brim = new THREE.Mesh(unit.cyl, M.redDark);
  brim.scale.set(0.24, 0.025, 0.24);
  brim.position.set(0.28, 2.1, 0.46);
  group.add(helmet, brim);
  const plate = createSignPlate('ЭКИПИРОВКА', 1.55, 0.4, { color: PALETTE.greenDark, border: PALETTE.green });
  plate.position.set(0, 3.0, 0.14);
  group.add(plate);
  group.add(createContactShadow(1.1, 0.9, 0.34));
  return group;
}

/** Стойка с катушкой: красный шкаф, рамка оси, катушка (ось и размеры — как в логике рукава), насадка. */
export function buildHoseStand() {
  const M = mats();
  const b = createBatch();
  rb(b, M.charcoal, 1.35, 0.1, 1.9, 0, 0.05, 0.2, [0, 0, 0], 0.03);
  rb(b, M.red, 1.1, 1.0, 0.8, 0, 0.6, 0, [0, 0, 0], 0.08);
  rb(b, M.trim, 1.0, 0.1, 0.06, 0, 0.78, 0.4, [0, 0, 0], 0.02);
  rb(b, M.steel, 0.1, 1.6, 0.1, 0, 1.0, -0.4, [0, 0, 0], 0.03);
  rb(b, M.steel, 0.1, 1.6, 0.1, 0, 1.0, 0.96, [0, 0, 0], 0.03);
  const group = new THREE.Group();
  group.add(b.build());
  const reel = new THREE.Group();
  reel.position.set(0, 1.2, 0.28);
  group.add(reel);
  const rimGeometry = new THREE.TorusGeometry(0.64, 0.06, 8, 24);
  for (const z of [-0.55, 0.55]) {
    const rim = new THREE.Mesh(rimGeometry, M.red);
    rim.position.z = z;
    rim.castShadow = true;
    reel.add(rim);
    for (const angle of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
      const spoke = new THREE.Mesh(roundedBox(1.2, 0.07, 0.07, 0.02), M.cream);
      spoke.position.z = z;
      spoke.rotation.z = angle;
      reel.add(spoke);
    }
  }
  const hub = new THREE.Mesh(unit.cyl, M.yellow);
  hub.scale.set(0.17, 1.2, 0.17);
  hub.rotation.x = Math.PI / 2;
  reel.add(hub);
  const nozzle = new THREE.Group();
  nozzle.position.set(0.48, 0.86, 0.42);
  nozzle.rotation.y = -0.35;
  const barrel = new THREE.Mesh(unit.cyl, M.yellow);
  barrel.scale.set(0.07, 0.62, 0.07);
  barrel.rotation.z = Math.PI / 2;
  const grip = new THREE.Mesh(roundedBox(0.1, 0.24, 0.1, 0.03), M.charcoal);
  grip.position.set(-0.1, -0.12, 0);
  nozzle.add(barrel, grip);
  group.add(nozzle);
  // Низкая табличка сбоку от стойки: не заслоняет наставника издали.
  const plate = createSignPlate('УЧЕБНЫЙ РУКАВ', 1.6, 0.38, { color: PALETTE.greenDark, border: PALETTE.green });
  plate.position.set(1.4, 0.95, 0.9);
  group.add(plate);
  for (const dx of [-0.55, 0.55]) {
    const leg = new THREE.Mesh(unit.cyl, M.woodDark);
    leg.scale.set(0.035, 0.75, 0.035);
    leg.position.set(1.4 + dx, 0.37, 0.88);
    group.add(leg);
  }
  group.add(createContactShadow(1.0, 1.1, 0.3));
  return { group, reel, nozzle };
}

/** Учебный манекен: лежит вдоль Z, голова на +Z. Оранжевый жилет и светоотражающая лента делают его заметным. */
export function buildMannequin({ withSign = true } = {}) {
  const M = mats();
  const root = new THREE.Group();
  const capsule = (radius, length, material, [x, y, z], rotation) => {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 6, 12), material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(...rotation);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };
  capsule(0.3, 0.55, M.dummy, [0, 0.3, 0.2], [Math.PI / 2, 0, 0]);
  const tape = new THREE.Mesh(new THREE.CylinderGeometry(0.315, 0.315, 0.1, 14, 1, true), M.yellow);
  tape.position.set(0, 0.3, 0.3);
  tape.rotation.x = Math.PI / 2;
  root.add(tape);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 10), M.dummyLight);
  head.position.set(0, 0.34, 0.92);
  head.castShadow = true;
  root.add(head);
  capsule(0.13, 0.7, M.charcoal, [-0.17, 0.2, -0.62], [Math.PI / 2, 0, 0.06]);
  capsule(0.13, 0.7, M.charcoal, [0.17, 0.2, -0.62], [Math.PI / 2, 0, -0.06]);
  capsule(0.1, 0.55, M.dummyLight, [-0.46, 0.22, 0.35], [Math.PI / 2, 0, 0.3]);
  capsule(0.1, 0.55, M.dummyLight, [0.46, 0.22, 0.35], [Math.PI / 2, 0, -0.3]);
  if (withSign) {
    const sign = createSignPlate('УЧЕБНЫЙ МАНЕКЕН', 1.4, 0.32, { color: PALETTE.greenDark, border: PALETTE.green });
    sign.position.set(0, 0.95, -1.5);
    sign.rotation.y = 0.45; // родительская группа повёрнута на -0.45: табличка остаётся лицом к игроку
    root.add(sign);
    root.add(createContactShadow(0.9, 1.3, 0.3));
  }
  return root;
}

/** Безопасная зона: зелёный коврик с белым крестом, кольцо, флагшток с вымпелом. */
export function buildSafeZone() {
  const M = mats();
  const group = new THREE.Group();
  const mat = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.55, 0.06, 36), M.green);
  mat.position.y = 0.0;
  mat.receiveShadow = true;
  group.add(mat);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.07, 8, 40), M.trim);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  group.add(ring);
  for (const [w, d] of [[1.5, 0.42], [0.42, 1.5]]) {
    const bar = new THREE.Mesh(roundedBox(w, 0.05, d, 0.04), M.white);
    bar.position.y = 0.06;
    group.add(bar);
  }
  const glow = new THREE.Mesh(new THREE.CircleGeometry(1.9, 24), new THREE.MeshBasicMaterial({ color: '#b4e08f', map: softBlobTexture(), transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -0.02;
  group.add(glow);
  const pole = new THREE.Mesh(unit.cyl, M.steel);
  pole.scale.set(0.04, 3.2, 0.04);
  pole.position.set(1.7, 1.6, -1.2);
  group.add(pole);
  const flag = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.0, 3), M.green);
  flag.rotation.z = -Math.PI / 2;
  flag.scale.set(1, 1, 0.1);
  flag.position.set(2.1, 2.85, -1.2);
  group.add(flag);
  const plate = createSignPlate('БЕЗОПАСНАЯ ЗОНА', 2.0, 0.44, { color: PALETTE.greenDark, border: PALETTE.green });
  plate.position.set(0, 1.0, -1.7);
  const stand = new THREE.Mesh(unit.cyl, M.steel);
  stand.scale.set(0.035, 1.0, 0.035);
  stand.position.set(0, 0.5, -1.72);
  group.add(plate, stand);
  group.userData.flag = flag;
  return group;
}

/** Ограждение учебной стены: стойки, красно-белая лента, напольная разметка и щит «НЕ ПЕРЕСЕКАТЬ». */
export function buildSafetyBarriers(wallX) {
  const M = mats();
  const b = createBatch();
  const front = SAFETY_ZONE.maxZ;
  const posts = [];
  for (let x = SAFETY_ZONE.minX; x <= SAFETY_ZONE.maxX + 0.01; x += 2) posts.push([x, front]);
  for (const x of [SAFETY_ZONE.minX, SAFETY_ZONE.maxX]) posts.push([x, front - 1.9]);
  for (const [x, z] of posts) {
    cyl(b, M.red, 0.06, 0.95, x, 0.48, z, [0, 0, 0], true);
    ball(b, M.white, 0.1, 0.1, 0.1, x, 0.98, z);
    cyl(b, M.white, 0.065, 0.14, x, 0.62, z, [0, 0, 0], true);
  }
  const rail = (x0, z0, x1, z1) => {
    const length = Math.hypot(x1 - x0, z1 - z0);
    const rotY = Math.atan2(x1 - x0, z1 - z0);
    const segments = Math.max(2, Math.round(length / 0.5));
    for (let i = 0; i < segments; i++) {
      const t = (i + 0.5) / segments;
      b.add(roundedBox(0.05, 0.06, length / segments + 0.005, 0.015), i % 2 ? M.white : M.red, [x0 + (x1 - x0) * t, 0.85, z0 + (z1 - z0) * t], [0, rotY, 0]);
    }
  };
  rail(SAFETY_ZONE.minX, front, SAFETY_ZONE.maxX, front);
  rail(SAFETY_ZONE.minX, front, SAFETY_ZONE.minX, front - 1.9);
  rail(SAFETY_ZONE.maxX, front, SAFETY_ZONE.maxX, front - 1.9);
  // Напольная лента: приподнята, чтобы не мерцала на покрытии.
  const taping = (x, z, w, d, i) => b.add(roundedBox(w, 0.04, d, 0.012), i % 2 ? M.ink : M.yellow, [x, 0.07, z]);
  for (let i = 0; i < 16; i++) taping(SAFETY_ZONE.minX + (i + 0.5) * 0.5, front + 0.45, 0.5, 0.3, i);
  for (let i = 0; i < 6; i++) for (const x of [SAFETY_ZONE.minX, SAFETY_ZONE.maxX]) taping(x, front - 0.2 - (i + 0.5) * 0.5, 0.3, 0.5, i);
  const group = new THREE.Group();
  group.add(b.build());
  const board = createSignPlate('НЕ ПЕРЕСЕКАТЬ', 1.9, 0.5, { color: PALETTE.redDark });
  board.position.set(wallX, 0.62, front + 1.0);
  group.add(board);
  for (const dx of [-0.7, 0.7]) {
    const leg = new THREE.Mesh(unit.cyl, M.woodDark);
    leg.scale.set(0.035, 0.7, 0.035);
    leg.position.set(wallX + dx, 0.35, front + 0.98);
    group.add(leg);
  }
  return group;
}

/** Маркер текущей цели: пульсирующее кольцо на земле и парящий ромб над объектом. */
export function createObjectiveMarker() {
  const group = new THREE.Group();
  const ringMaterial = new THREE.MeshBasicMaterial({ color: '#ffd44f', transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 40), ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.09;
  const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), new THREE.MeshBasicMaterial({ color: '#ffd44f' }));
  diamond.scale.y = 1.4;
  group.add(ring, diamond);
  group.visible = false;
  let height = 3.2;
  let radius = 1.6;
  return {
    group,
    /** target: Vector3 или null; objectHeight — высота ромба над землёй, objectRadius — радиус кольца. */
    setTarget(target, objectHeight = 3.2, objectRadius = 1.6) {
      group.visible = Boolean(target);
      if (!target) return;
      group.position.set(target.x, 0, target.z);
      height = objectHeight;
      radius = objectRadius;
    },
    update(t) {
      if (!group.visible) return;
      const pulse = 1 + Math.sin(t * 3.2) * 0.06;
      ring.scale.setScalar(radius * pulse);
      ringMaterial.opacity = 0.55 + Math.sin(t * 3.2) * 0.2;
      diamond.position.y = height + Math.sin(t * 2.4) * 0.12;
      diamond.rotation.y = t * 1.6;
    },
    dispose() {
      ring.geometry.dispose();
      ringMaterial.dispose();
      diamond.geometry.dispose();
      diamond.material.dispose();
    },
  };
}

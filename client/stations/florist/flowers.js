import * as THREE from 'three';
import { PALETTE } from '../../engine/art/palette.js';
import { stdMat } from '../../engine/art/materials.js';
import { createPrefabKit } from '../../engine/art/prefab-kit.js';
import { FLOWERS } from './state.js';

const palette = Object.freeze({
  pink_tulip: { petal: '#ed9cb5', light: '#f4bfd0', shade: '#ce6e91', center: '#f6ce78', stem: '#4f8b59', leaf: ['#5d9b62', '#76ad69', '#4f8759'] },
  white_daisy: { petal: '#fff8e8', light: '#fffdf5', shade: '#eadfc9', center: '#f0c84f', stem: '#4e8957', leaf: ['#5e9b62', '#80b56f', '#4f8759'] },
  red_rose: { petal: '#d9564d', light: '#ec7562', shade: '#a83f42', center: '#f4bd64', stem: '#477d50', leaf: ['#54874b', '#79a957', '#3f7149'] },
  greenery: { petal: '#8dbd68', light: '#a6cf76', shade: '#4d8c5b', center: '#39764f', stem: '#3f7950', leaf: ['#6ca85d', '#8fc16c', '#477f54'] },
});

const ribbonColors = Object.freeze({ pink: '#e88eab', yellow: '#efc34c', blue: '#69a8c1' });
const leafGeometry = new THREE.Shape([
  new THREE.Vector2(0, 0),
  new THREE.Vector2(-0.09, 0.14),
  new THREE.Vector2(-0.12, 0.36),
  new THREE.Vector2(-0.075, 0.62),
  new THREE.Vector2(0, 0.78),
  new THREE.Vector2(0.075, 0.62),
  new THREE.Vector2(0.12, 0.36),
  new THREE.Vector2(0.09, 0.14),
]);
leafGeometry.closePath();
const LEAF_MESH = new THREE.ShapeGeometry(leafGeometry, 2);
LEAF_MESH.userData.shared = true;

function makePetalMesh(width, length) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(-width * 0.5, length * 0.18, -width * 0.58, length * 0.68, 0, length);
  shape.bezierCurveTo(width * 0.58, length * 0.68, width * 0.5, length * 0.18, 0, 0);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape, 3);
  geometry.userData.shared = true;
  return geometry;
}

const PETALS = Object.freeze({
  tulip: makePetalMesh(0.26, 0.46),
  daisy: makePetalMesh(0.22, 0.34),
  rose: makePetalMesh(0.26, 0.34),
});

function branchGeometry(points, radius = 0.022) {
  const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point)), false, 'centripetal');
  const geometry = new THREE.TubeGeometry(curve, 7, radius, 5, false);
  geometry.userData.shared = true;
  return geometry;
}

function addLeaf(kit, color, { x, y, z = 0, angle = 0, length = 1, lean = 0 } = {}) {
  kit.add(LEAF_MESH, color, { pos: [x, y, z], rot: [0, angle, lean], scl: [0.88, length, 1], tinted: true });
}

function addStem(kit, color, { x = 0, z = 0, height = 0.96, leanX = 0, leanZ = 0, radius = 0.028 } = {}) {
  kit.add(branchGeometry([
    [0, 0, 0], [leanX * 0.32, height * 0.34, leanZ * 0.32],
    [leanX * 0.7, height * 0.68, leanZ * 0.7], [leanX, height, leanZ],
  ], radius), color, { pos: [x, 0, z], tinted: true });
}

function createTulip(kit, colors, variant) {
  const height = 1.24 + variant * 0.025;
  addStem(kit, colors.stem, { height, leanX: variant % 2 ? 0.025 : -0.015, radius: 0.025 });
  addLeaf(kit, colors.leaf[0], { x: -0.01, y: 0.3, angle: -0.58, length: 0.9, lean: -0.28 });
  addLeaf(kit, colors.leaf[1], { x: 0.02, y: 0.48, angle: 0.72, length: 0.77, lean: 0.24 });
  addLeaf(kit, colors.leaf[2], { x: 0, y: 0.22, angle: 1.78, length: 0.52, lean: 0.16 });

  // Вытянутые раздельные лепестки раскрываются чашей, а не сливаются в шар.
  const count = 6;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + variant * 0.12;
    const radius = i % 2 ? 0.055 : 0.035;
    kit.add(PETALS.tulip, i % 2 ? colors.petal : colors.light, {
      pos: [Math.sin(angle) * radius, height - 0.18 + (i % 2) * 0.015, Math.cos(angle) * radius],
      rot: [-0.08, angle, (i % 2 ? 1 : -1) * 0.14],
      scl: [0.8 + (i % 3) * 0.07, 0.88 + (i % 2) * 0.08, 1],
    });
  }
  kit.sphere(0.045, 0, height - 0.065, 0, colors.center, { w: 7, h: 5, tinted: false });
}

function createDaisy(kit, colors, variant) {
  const height = 1.08 + variant * 0.018;
  addStem(kit, colors.stem, { height, leanX: variant % 2 ? -0.03 : 0.02, radius: 0.024 });
  addLeaf(kit, colors.leaf[0], { x: -0.01, y: 0.28, angle: -0.7, length: 0.74, lean: -0.26 });
  addLeaf(kit, colors.leaf[1], { x: 0.02, y: 0.48, angle: 0.66, length: 0.65, lean: 0.2 });

  const headY = height + 0.06;
  const petals = 12;
  for (let i = 0; i < petals; i++) {
    const angle = (i / petals) * Math.PI * 2 + variant * 0.09;
    const radius = 0.10 + (i % 3) * 0.008;
    kit.add(PETALS.daisy, i % 3 ? colors.petal : colors.light, {
      pos: [Math.sin(angle) * radius, headY, Math.cos(angle) * radius],
      rot: [-Math.PI / 2 + (i % 2 ? 0.035 : -0.02), angle, (i % 2 ? 1 : -1) * 0.025],
      scl: [0.8 + (i % 4) * 0.06, 1, 1],
    });
  }
  kit.sphere(0.125, 0, headY + 0.035, 0, colors.center, { w: 9, h: 6, tinted: false });
  kit.sphere(0.07, -0.018, headY + 0.09, 0.012, '#f6d978', { w: 7, h: 5, tinted: false });
}

function createRose(kit, colors, variant) {
  const height = 1.06 + variant * 0.02;
  addStem(kit, colors.stem, { height, leanX: variant % 2 ? 0.025 : -0.025, radius: 0.027 });
  addLeaf(kit, colors.leaf[0], { x: -0.02, y: 0.35, angle: -0.8, length: 0.78, lean: -0.25 });
  addLeaf(kit, colors.leaf[1], { x: 0.02, y: 0.58, angle: 0.74, length: 0.72, lean: 0.2 });
  addLeaf(kit, colors.leaf[2], { x: 0.01, y: 0.22, angle: 1.9, length: 0.5, lean: 0.12 });

  const headY = height + 0.035;
  // Три смещённых витка лепестков формируют объёмный бутон с открытым центром.
  for (let layer = 0; layer < 3; layer++) {
    const count = layer === 0 ? 7 : layer === 1 ? 6 : 5;
    const radius = 0.145 - layer * 0.045;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + layer * 0.48 + variant * 0.1;
      const p = layer === 0 ? PETALS.rose : layer === 1 ? PETALS.tulip : PETALS.daisy;
      const color = (i + layer) % 3 === 0 ? colors.light : (i + layer) % 4 === 0 ? colors.shade : colors.petal;
      kit.add(p, color, {
        pos: [Math.sin(angle) * radius, headY + layer * 0.045, Math.cos(angle) * radius],
        rot: [-0.9 + layer * 0.34, angle, Math.sin(angle * 2) * 0.18],
        scl: [0.8 + (i % 3) * 0.07, 0.72 + layer * 0.1, 1],
      });
    }
  }
  kit.sphere(0.08, 0, headY + 0.12, 0, colors.shade, { w: 8, h: 5, tinted: false });
  // Четыре узких чашелистика под основанием бутона.
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    addLeaf(kit, colors.stem, {
      x: Math.sin(angle) * 0.08, y: height - 0.02, z: Math.cos(angle) * 0.08,
      angle, length: 0.35, lean: (i % 2 ? 1 : -1) * 0.45,
    });
  }
}

function createGreenery(kit, colors, variant) {
  addStem(kit, colors.stem, { height: 1.18, leanX: variant % 2 ? 0.02 : -0.025, radius: 0.026 });
  const branches = [
    { y: 0.24, side: -1, top: 0.55 }, { y: 0.4, side: 1, top: 0.73 },
    { y: 0.56, side: -1, top: 0.8 }, { y: 0.71, side: 1, top: 0.96 },
  ];
  branches.forEach(({ y, side, top }, index) => {
    const dx = side * (0.27 + (index % 2) * 0.035);
    kit.add(branchGeometry([[0, y, 0], [dx * 0.35, y + 0.09, 0], [dx * 0.72, top - 0.04, 0], [dx, top, 0]], 0.015), colors.leaf[index % colors.leaf.length], { tinted: true });
    addLeaf(kit, colors.leaf[index % colors.leaf.length], { x: dx * 0.36, y: y + 0.07, angle: side * 0.58, length: 0.64, lean: side * 0.34 });
    addLeaf(kit, colors.leaf[(index + 1) % colors.leaf.length], { x: dx * 0.72, y: top - 0.1, angle: -side * 0.68, length: 0.58, lean: -side * 0.3 });
  });
  addLeaf(kit, colors.leaf[1], { x: -0.025, y: 0.13, angle: -0.82, length: 0.58, lean: -0.38 });
}

/** Один вид цветка собран в одно low-poly mesh с вершинной окраской. */
export function createFlower(type, { id = null, variant = 0 } = {}) {
  if (!Object.hasOwn(FLOWERS, type)) throw new TypeError(`Неизвестный вид цветка: ${type}`);
  const root = new THREE.Group();
  const colors = palette[type];
  const kit = createPrefabKit({ seed: 19 + variant * 7, tint: 0.035 });
  if (type === 'pink_tulip') createTulip(kit, colors, variant);
  else if (type === 'white_daisy') createDaisy(kit, colors, variant);
  else if (type === 'red_rose') createRose(kit, colors, variant);
  else createGreenery(kit, colors, variant);
  const geometry = kit.build({ groundAO: { height: 0.34, strength: 0.08 }, underside: 0.82 });
  const material = stdMat('#ffffff', { vertexColors: true, side: THREE.DoubleSide, roughness: 0.76 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  root.userData.flower = { id, type, label: FLOWERS[type].label };
  root.userData.ownedGeometries = new Set([geometry]);
  return root;
}

export function disposeFlower(flower) {
  const geometries = flower?.userData?.ownedGeometries;
  if (!geometries) return;
  for (const geometry of geometries) geometry.dispose();
  geometries.clear();
}

export function createWrapping(root, ribbon = 'pink') {
  const group = new THREE.Group();
  const geometrySet = new Set();
  const paper = stdMat('#fff3df', { roughness: 0.9, side: THREE.DoubleSide });
  const band = stdMat(ribbonColors[ribbon] ?? ribbonColors.pink, { roughness: 0.56 });
  const darkColor = `#${new THREE.Color(ribbonColors[ribbon] ?? ribbonColors.pink).multiplyScalar(0.78).getHexString()}`;
  const darkBand = stdMat(darkColor, { roughness: 0.62 });
  const cone = new THREE.ConeGeometry(0.5, 0.96, 7, 1, true);
  cone.rotateY(Math.PI / 7);
  const coneMesh = new THREE.Mesh(cone, paper);
  coneMesh.position.set(0, 0.47, 0);
  coneMesh.castShadow = true;
  geometrySet.add(cone);
  group.add(coneMesh);
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.39, 0.83), paper);
    panel.position.set(Math.sin(angle) * 0.2, 0.47, Math.cos(angle) * 0.2);
    panel.rotation.set(-0.14, angle, (i % 2 ? 1 : -1) * 0.05);
    panel.scale.set(0.85, 1, 1);
    panel.castShadow = true;
    geometrySet.add(panel.geometry);
    group.add(panel);
  }
  const bandMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.4, 0.095, 9), band);
  bandMesh.position.set(0, 0.51, 0);
  bandMesh.scale.z = 0.78;
  bandMesh.castShadow = true;
  geometrySet.add(bandMesh.geometry);
  group.add(bandMesh);
  for (const side of [-1, 1]) {
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.04, 6, 12), band);
    loop.position.set(side * 0.15, 0.75, 0.02);
    loop.rotation.set(0, side * 0.15, side * 0.45);
    loop.scale.set(1.18, 0.76, 0.7);
    loop.castShadow = true;
    geometrySet.add(loop.geometry);
    group.add(loop);
  }
  const knot = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), darkBand);
  knot.position.set(0, 0.72, 0.08);
  knot.scale.set(0.09, 0.095, 0.07);
  geometrySet.add(knot.geometry);
  group.add(knot);
  for (const side of [-1, 1]) {
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.36, 4), band);
    tail.position.set(side * 0.14, 0.43, 0.1);
    tail.rotation.set(side * -0.16, 0, side * 0.22);
    tail.scale.z = 0.48;
    geometrySet.add(tail.geometry);
    group.add(tail);
  }
  root.add(group);
  group.userData.ownedGeometries = geometrySet;
  return group;
}

export function disposeWrapping(wrapping) {
  const geometries = wrapping?.userData?.ownedGeometries;
  if (!geometries) return;
  for (const geometry of geometries) geometry.dispose();
  geometries.clear();
  wrapping.parent?.remove(wrapping);
}

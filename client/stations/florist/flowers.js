import * as THREE from 'three';
import { PALETTE } from '../../engine/art/palette.js';
import { stdMat } from '../../engine/art/materials.js';
import { windMaterial, padWindBounds, applyWindShadows } from '../../engine/art/wind.js';
import { createPrefabKit } from '../../engine/art/prefab-kit.js';
import { FLOWERS } from './state.js';

const palette = Object.freeze({
  pink_tulip: { petal: '#ed9cb5', light: '#f4bfd0', shade: '#ce6e91', center: '#f6ce78', stem: '#4f8b59', leaf: ['#5d9b62', '#76ad69', '#4f8759'] },
  white_daisy: { petal: '#fff8e8', light: '#fffdf5', shade: '#eadfc9', center: '#f0c84f', stem: '#4e8957', leaf: ['#5e9b62', '#80b56f', '#4f8759'] },
  red_rose: { petal: '#d9564d', light: '#ec7562', shade: '#a83f42', center: '#f4bd64', stem: '#477d50', leaf: ['#54874b', '#79a957', '#3f7149'] },
  greenery: { petal: '#8dbd68', light: '#a6cf76', shade: '#4d8c5b', center: '#39764f', stem: '#3f7950', leaf: ['#6ca85d', '#8fc16c', '#477f54'] },
});

const ribbonColors = Object.freeze({ pink: '#f05f91', yellow: '#f0b72d', blue: '#35a6ce' });
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
  const geometry = padWindBounds(kit.build({ groundAO: { height: 0.34, strength: 0.08 }, underside: 0.82 }), 'flower-held');
  const material = windMaterial('flower-held', { roughness: 0.76, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  applyWindShadows(mesh);
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

export function bouquetStemTransform(index, count, packed = false) {
  const angle = index * (Math.PI * 2 / Math.max(1, count)) + 0.3;
  if (!packed) {
    const radius = count === 1 ? 0 : 0.24 + (index % 2) * 0.1;
    return {
      position: [Math.cos(angle) * radius, (index % 3) * 0.035, Math.sin(angle) * radius * 0.78],
      rotation: [0.08 * ((index % 3) - 1), angle * 0.25, 0.10 * (index % 2 ? 1 : -1)],
      scale: 1,
    };
  }

  // Стебли сходятся в небольшой пучок, а верхушки мягко расходятся наружу.
  const radius = 0.075 + (index % 2) * 0.018;
  return {
    position: [Math.cos(angle) * radius, 0, Math.sin(angle) * radius * 0.82],
    rotation: [Math.sin(angle) * 0.17, angle * 0.25, -Math.cos(angle) * 0.17],
    scale: 1,
  };
}

function makePaperFunnelGeometry() {
  const geometry = new THREE.BufferGeometry();
  const positions = [];
  const colors = [];
  const indices = [];
  const rows = 7;
  const columns = 13;
  const sheets = [
    { start: -Math.PI / 2, sweep: 2.48, top: 0.76, color: new THREE.Color('#fff1dc') },
    { start: Math.PI / 6, sweep: 2.48, top: 0.81, color: new THREE.Color('#f8dfd8') },
    { start: 5 * Math.PI / 6, sweep: 2.48, top: 0.78, color: new THREE.Color('#fff7e9') },
  ];
  let vertex = 0;

  for (const [sheetIndex, sheet] of sheets.entries()) {
    const phase = sheetIndex * 1.7;
    for (let row = 0; row < rows; row++) {
      const t = row / (rows - 1);
      for (let column = 0; column < columns; column++) {
        const u = column / (columns - 1);
        const angle = sheet.start + u * sheet.sweep;
        const radius = THREE.MathUtils.lerp(0.145, sheet.top, t)
          + Math.sin(angle * 2.2 + phase) * 0.025 * t;
        const topCurl = Math.pow(t, 4) * Math.sin(angle * 2.5 + phase) * 0.045;
        const sideFold = Math.sin(u * Math.PI) * Math.sin(t * Math.PI) * 0.022;
        positions.push(
          Math.sin(angle) * (radius + sideFold),
          0.035 + t * 0.93 + topCurl + sheetIndex * 0.002,
          Math.cos(angle) * (radius + sideFold),
        );
        const shade = 0.91 + t * 0.11 + Math.sin(u * Math.PI * 2 + phase) * 0.025;
        colors.push(sheet.color.r * shade, sheet.color.g * shade, sheet.color.b * shade);
        if (row < rows - 1 && column < columns - 1) {
          const a = vertex + row * columns + column;
          const b = a + 1;
          const c = a + columns;
          const d = c + 1;
          indices.push(a, b, c, b, d, c);
        }
      }
    }
    vertex += rows * columns;
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeRibbonLoopGeometry(side) {
  const geometry = new THREE.BufferGeometry();
  const centerX = side * 0.2;
  const vertices = [
    side * 0.045, 0, 0,
    side * 0.12, 0.115, 0,
    side * 0.34, 0.155, 0,
    side * 0.29, 0, 0,
    side * 0.34, -0.155, 0,
    side * 0.12, -0.115, 0,
    centerX, 0, 0,
  ];
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex([0, 1, 6, 1, 2, 6, 2, 3, 6, 3, 4, 6, 4, 5, 6, 5, 0, 6]);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeRibbonTailGeometry(side) {
  const geometry = new THREE.BufferGeometry();
  const rows = [
    { y: 0.6, x: side * 0.1, halfWidth: 0.09 },
    { y: 0.43, x: side * 0.14, halfWidth: 0.1 },
  ];
  const vertices = [];
  for (const row of rows) {
    for (const edge of [-1, 1]) {
      const x = row.x + edge * row.halfWidth;
      const radius = 0.145 + ((row.y - 0.035) / 0.93) * 0.78;
      const z = Math.sqrt(Math.max(0, radius * radius - x * x)) + 0.12;
      vertices.push(x, row.y, z);
    }
  }
  const tipX = side * 0.19;
  const tipY = 0.16;
  const tipRadius = 0.145 + ((tipY - 0.035) / 0.93) * 0.78;
  const tipZ = Math.sqrt(Math.max(0, tipRadius * tipRadius - tipX * tipX)) + 0.12;
  vertices.push(tipX, tipY, tipZ);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createWrapping(root, ribbon = 'pink') {
  const group = new THREE.Group();
  const geometrySet = new Set();
  const paper = stdMat('#ffffff', { roughness: 0.9, side: THREE.DoubleSide, vertexColors: true });
  const band = stdMat(ribbonColors[ribbon] ?? ribbonColors.pink, { roughness: 0.56, side: THREE.DoubleSide });
  const darkColor = `#${new THREE.Color(ribbonColors[ribbon] ?? ribbonColors.pink).multiplyScalar(0.68).getHexString()}`;
  const darkBand = stdMat(darkColor, { roughness: 0.62 });
  const paperGeometry = makePaperFunnelGeometry();
  const paperMesh = new THREE.Mesh(paperGeometry, paper);
  paperMesh.name = 'three-overlapping-paper-sheets';
  paperMesh.castShadow = true;
  paperMesh.receiveShadow = true;
  geometrySet.add(paperGeometry);
  group.add(paperMesh);

  const bandMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.51, 0.46, 0.105, 12), band);
  bandMesh.name = 'bouquet-ribbon-band';
  bandMesh.position.set(0, 0.43, 0);
  bandMesh.scale.z = 0.91;
  bandMesh.castShadow = true;
  geometrySet.add(bandMesh.geometry);
  group.add(bandMesh);
  for (const side of [-1, 1]) {
    const loop = new THREE.Mesh(makeRibbonLoopGeometry(side), band);
    loop.name = 'ribbon-bow-loop';
    loop.position.set(0, 0.62, 0.61);
    loop.rotation.set(0, side * 0.1, side * 0.1);
    loop.castShadow = true;
    geometrySet.add(loop.geometry);
    group.add(loop);
  }
  const knot = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), darkBand);
  knot.name = 'ribbon-bow-knot';
  knot.position.set(0, 0.61, 0.64);
  knot.scale.set(0.11, 0.105, 0.08);
  geometrySet.add(knot.geometry);
  group.add(knot);
  for (const side of [-1, 1]) {
    const tail = new THREE.Mesh(makeRibbonTailGeometry(side), band);
    tail.name = 'ribbon-tail';
    tail.castShadow = true;
    tail.receiveShadow = true;
    geometrySet.add(tail.geometry);
    group.add(tail);
  }
  root.add(group);
  group.userData.ownedGeometries = geometrySet;
  group.userData.paperMesh = paperMesh;
  group.userData.paperSheetCount = 3;
  return group;
}

export function disposeWrapping(wrapping) {
  const geometries = wrapping?.userData?.ownedGeometries;
  if (!geometries) return;
  for (const geometry of geometries) geometry.dispose();
  geometries.clear();
  wrapping.parent?.remove(wrapping);
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from '../../engine/art/palette.js';
import { stdMat } from '../../engine/art/materials.js';
import { createLabelSprite, disposeLabel } from '../../engine/art/labels.js';
import { createPrefabKit } from '../../engine/art/prefab-kit.js';
import { FLORA_COLORS, flower as addFlower } from '../../engine/art/flora.js';
import { swayMaterial } from '../../engine/art/wind.js';
import { QUALITY_PRESETS } from '../../engine/art/quality.js';
import { FLOWERS } from './state.js';
import { createFlower, disposeFlower } from './flowers.js';
import { FLORIST_PLAN, ROOM } from './layout-plan.js';

function addBox(parent, geometrySet, material, size, position, rotation = [0, 0, 0]) {
  const geometry = new THREE.BoxGeometry(...size);
  geometrySet.add(geometry);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addCylinder(parent, geometrySet, material, radiusTop, radiusBottom, height, segments, position) {
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments);
  geometrySet.add(geometry);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addLabel(parent, labels, text, position, scale = 1, accent = PALETTE.green) {
  const label = createLabelSprite(text, { kind: 'sign', accent, color: '#365446' });
  label.position.set(...position);
  label.scale.multiplyScalar(scale);
  parent.add(label);
  labels.push(label);
  return label;
}

function mergeStaticMeshes(root, geometrySet) {
  const buckets = new Map();
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((node) => { if (node.isMesh && !node.isInstancedMesh) meshes.push(node); });
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const geometry = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(mesh.matrixWorld);
    const entries = buckets.get(mesh.material) ?? [];
    entries.push({ mesh, geometry });
    buckets.set(mesh.material, entries);
  }

  for (const [material, entries] of buckets) {
    if (entries.length < 2) {
      entries.forEach(({ geometry }) => geometry.dispose());
      continue;
    }
    const merged = mergeGeometries(entries.map(({ geometry }) => geometry), false);
    if (merged) {
      geometrySet.add(merged);
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
      entries.forEach(({ mesh: source }) => source.parent?.remove(source));
    }
    entries.forEach(({ geometry }) => geometry.dispose());
  }
}

function addDesk(furniture, colliders, cameraBlockers, { x, z, width, depth }, { label, accent, work = false } = {}) {
  furniture.box(width, 0.88, depth - 0.12, x, 0.53, z, PALETTE.woodDark, { r: 0.075 });
  furniture.box(width + 0.16, 0.18, depth + 0.08, x, 1.04, z, PALETTE.wood, { r: 0.07 });
  furniture.box(width - 0.28, 0.07, 0.06, x, 0.59, z + depth / 2 - 0.06, PALETTE.trim, { r: 0.025 });
  furniture.box(width - 0.36, 0.07, 0.055, x, 0.29, z + depth / 2 - 0.06, PALETTE.wood, { r: 0.02 });
  for (const dx of [-width * 0.32, 0, width * 0.32]) {
    furniture.box(0.4, 0.44, 0.035, x + dx, 0.57, z + depth / 2 + 0.015, PALETTE.wood, { r: 0.03 });
    furniture.sphere(0.035, x + dx, 0.57, z + depth / 2 + 0.045, FLORA_COLORS.warm, { w: 6, h: 5, tinted: false });
  }
  if (work) {
    furniture.box(width - 0.55, 0.045, 0.12, x, 0.64, z + depth / 2 - 0.02, '#db9376', { r: 0.02 });
  }
  const bounds = {
    minX: x - width / 2, maxX: x + width / 2,
    minY: 0, maxY: 1.18,
    minZ: z - depth / 2, maxZ: z + depth / 2,
  };
  colliders.push(bounds);
  cameraBlockers.push(bounds);
  if (label) addLabel(furniture.root, furniture.labels, label, [x, 1.9, z - depth * 0.55], 0.72, accent);
}

function addBucket(root, geometrySet, labels, displayFlowers, type, x, z) {
  const wood = stdMat(PALETTE.wood, { roughness: 0.84 });
  const darkWood = stdMat(PALETTE.woodDark, { roughness: 0.88 });
  const metal = stdMat('#d1b76f', { roughness: 0.42, metalness: 0.12 });
  const bucket = new THREE.Group();
  bucket.position.set(x, 0, z);
  root.add(bucket);
  addCylinder(bucket, geometrySet, darkWood, 0.42, 0.34, 0.78, 10, [0, 0.41, 0]);
  addCylinder(bucket, geometrySet, wood, 0.44, 0.36, 0.13, 10, [0, 0.80, 0]);
  addCylinder(bucket, geometrySet, metal, 0.45, 0.45, 0.075, 12, [0, 0.84, 0]);
  addCylinder(bucket, geometrySet, metal, 0.34, 0.34, 0.06, 12, [0, 0.08, 0]);

  const offsets = [[-0.18, -0.12], [0.02, -0.17], [0.18, 0.02], [-0.04, 0.16]];
  for (let i = 0; i < offsets.length; i++) {
    const [dx, dz] = offsets[i];
    const flower = createFlower(type, { id: `display-${type}-${i}` });
    flower.position.set(dx, 0.53, dz);
    flower.rotation.set(0, (i - 1.5) * 0.16, (i % 2 ? -1 : 1) * (0.08 + i * 0.015));
    flower.scale.setScalar(0.76 + (i % 2) * 0.08);
    bucket.add(flower);
    displayFlowers.push(flower);
  }
  const accent = type === 'pink_tulip' ? '#e88eab' : type === 'white_daisy' ? '#d5ba66' : type === 'red_rose' ? PALETTE.red : PALETTE.green;
  addLabel(root, labels, FLOWERS[type].label, [x, 2.05, z], 0.68, accent);
  return { type, position: new THREE.Vector3(x, 0, z) };
}

/** Просторная cutaway-лавка: игрок и камеры остаются внутри; фасад открыт к зрителю. */
export function buildFloristLayout() {
  const root = new THREE.Group();
  const geometrySet = new Set();
  const labels = [];
  const displayFlowers = [];
  const colliders = [];
  const cameraBlockers = [];
  const furniture = createPrefabKit({ seed: 71, tint: 0.028 });
  furniture.root = root;
  furniture.labels = labels;

  const plaster = stdMat(PALETTE.plaster, { roughness: 0.9 });
  const sage = stdMat('#b8cdb3', { roughness: 0.88 });
  const wood = stdMat(PALETTE.wood, { roughness: 0.78 });
  const woodDark = stdMat(PALETTE.woodDark, { roughness: 0.86 });
  const trim = stdMat(PALETTE.trim, { roughness: 0.74 });
  const glass = stdMat('#8fc4ce', { roughness: 0.32, metalness: 0.02 });
  const concrete = stdMat(PALETTE.concrete, { roughness: 0.9 });

  // Плиточный пол, три стены, открытый вход и протяжённые окна.
  addBox(root, geometrySet, concrete, [ROOM.width, 0.28, ROOM.depth], [ROOM.width / 2, -0.14, ROOM.depth / 2]);
  addBox(root, geometrySet, plaster, [ROOM.width, ROOM.height, 0.3], [ROOM.width / 2, ROOM.height / 2, ROOM.depth - 0.15]);
  addBox(root, geometrySet, sage, [0.3, ROOM.height, ROOM.depth], [0.15, ROOM.height / 2, ROOM.depth / 2]);
  addBox(root, geometrySet, sage, [0.3, ROOM.height, ROOM.depth], [ROOM.width - 0.15, ROOM.height / 2, ROOM.depth / 2]);
  addBox(root, geometrySet, woodDark, [ROOM.width, 0.24, 0.34], [ROOM.width / 2, 0.25, 0.42]);
  addBox(root, geometrySet, trim, [ROOM.width, 0.15, 0.34], [ROOM.width / 2, ROOM.height - 0.14, 0.42]);
  for (const x of [0.48, ROOM.width - 0.48]) addBox(root, geometrySet, wood, [0.24, ROOM.height, 0.2], [x, ROOM.height / 2, 0.42]);

  for (const x of [4.2, 8.0, 11.8, 15.6]) {
    addBox(root, geometrySet, glass, [2.65, 1.72, 0.08], [x, 4.0, ROOM.depth - 0.32]);
    for (const y of [3.08, 4.92]) addBox(root, geometrySet, trim, [2.82, 0.12, 0.12], [x, y, ROOM.depth - 0.27]);
    for (const dx of [-1.37, 1.37]) addBox(root, geometrySet, trim, [0.12, 1.9, 0.12], [x + dx, 4.0, ROOM.depth - 0.27]);
    addBox(root, geometrySet, trim, [0.06, 1.68, 0.14], [x, 4.0, ROOM.depth - 0.22]);
  }
  for (const x of [3.1, 7.5, 12.5, 17]) addBox(root, geometrySet, wood, [0.14, ROOM.height - 0.55, 0.16], [x, ROOM.height / 2, 0.61]);
  for (const z of [3.8, 7.5, 11.3]) {
    for (const x of [0.55, ROOM.width - 0.55]) addBox(root, geometrySet, wood, [0.16, ROOM.height - 0.55, 0.15], [x, ROOM.height / 2, z]);
  }
  addBox(root, geometrySet, sage, [17.3, 0.16, 0.22], [ROOM.width / 2, 5.38, ROOM.depth - 0.42]);

  // Пять игровых зон: наставница и выдача у входа, сборка в центре, упаковка у дальней стены.
  for (const [key, label, accent] of [
    ['mentor', 'ЛАВКА ЛИЛИИ', '#78a475'], ['handoff', 'ВЫДАЧА ЗАКАЗОВ', PALETTE.orange],
    ['workbench', 'РАБОЧИЙ СТОЛ', '#dca46a'], ['wrapping', 'УПАКОВКА', '#e88eab'],
  ]) addDesk(furniture, colliders, cameraBlockers, FLORIST_PLAN.desks[key], { label, accent, work: key === 'workbench' });

  for (const [y, reelColors] of [
    [1.15, ['#f4e3d5', '#e7bfd0', '#b8d2df']],
    [2.05, ['#f4e3d5', '#e7bfd0', '#b8d2df']],
    [2.95, ['#f4e3d5', '#e7bfd0', '#b8d2df']],
  ]) {
    furniture.box(2.5, 0.14, 0.5, 16.2, y, 14.2, PALETTE.wood, { r: 0.045 });
    furniture.box(2.5, 0.045, 0.055, 16.2, y + 0.11, 14.43, PALETTE.trim, { r: 0.018 });
    for (const [i, color] of reelColors.entries()) {
      furniture.cyl(0.17, 0.17, 0.34, 8, 15.3 + i * 0.86, y + 0.31, 14.18, color, { rot: [0, 0, Math.PI / 2], tinted: false });
      furniture.box(0.42, 0.035, 0.04, 15.3 + i * 0.86, y + 0.5, 14.18, FLORA_COLORS.cream, { r: 0.015, tinted: false });
    }
  }
  const ribbonShelf = { minX: 14.95, maxX: 17.45, minY: 1.05, maxY: 3.5, minZ: 13.92, maxZ: 14.48 };
  colliders.push(ribbonShelf);
  cameraBlockers.push(ribbonShelf);
  addLabel(root, labels, 'БУМАГА · ЛЕНТЫ · ДЕКОР', [16.2, 4.08, 14.0], 0.7, '#75a8bd');

  // Витрины для четырёх видов цветов вдоль боковых стен.
  const buckets = {};
  for (const [type, { x, z }] of Object.entries(FLORIST_PLAN.buckets)) {
    buckets[type] = addBucket(root, geometrySet, labels, displayFlowers, type, x, z);
    colliders.push({ minX: x - 0.45, maxX: x + 0.45, minY: 0, maxY: 0.88, minZ: z - 0.45, maxZ: z + 0.45 });
    furniture.box(1.42, 0.1, 1.42, x, 0.02, z, '#e5d7b5', { r: 0.08 });
    furniture.box(1.0, 0.06, 1.0, x, 0.1, z, '#b7c5a3', { r: 0.06 });
  }

  // Вазоны и декоративная зелень держатся по углам и не сужают основные проходы.
  const flowerPots = [[1.15, 1.15], [18.85, 1.15], [1.15, 13.9], [18.85, 13.9]];
  for (const [x, z] of flowerPots) {
    colliders.push({ minX: x - 0.38, maxX: x + 0.38, minY: 0, maxY: 0.7, minZ: z - 0.38, maxZ: z + 0.38 });
    furniture.cyl(0.34, 0.26, 0.58, 9, x, 0.31, z, '#c98767', { tinted: false });
    furniture.cyl(0.36, 0.36, 0.075, 9, x, 0.61, z, PALETTE.trim, { tinted: false });
    furniture.cyl(0.25, 0.28, 0.05, 9, x, 0.62, z, FLORA_COLORS.soil, { tinted: false });
  }
  for (let i = 0; i < 15; i++) {
    const x = 3.1 + i * 0.97;
    const y = 5.43 + (i % 2) * 0.035;
    const z = 14.38;
    furniture.torus(0.045, 0.014, x, y, z, i % 3 ? '#f2c86b' : '#e88eab', { radial: 5, tubular: 8, rot: [0, 0, 0] });
  }

  const furnitureGeometry = furniture.build({
    groundAO: { height: 1.35, strength: 0.24 },
    bands: [{ y0: ROOM.height - 0.72, y1: ROOM.height - 0.28, strength: 0.1 }],
    underside: 0.78,
  });
  geometrySet.add(furnitureGeometry);
  const furnitureMesh = new THREE.Mesh(furnitureGeometry, stdMat('#ffffff', { vertexColors: true, roughness: 0.84 }));
  furnitureMesh.castShadow = true;
  furnitureMesh.receiveShadow = true;
  root.add(furnitureMesh);

  const flowerKit = createPrefabKit({ seed: 17, tint: 0.02 });
  addFlower(flowerKit, 0, 0, 0, FLORA_COLORS.bloom[0], 1);
  const flowerGeometry = flowerKit.build({ groundAO: { height: 0.25, strength: 0.12 } });
  geometrySet.add(flowerGeometry);
  const flowerInstances = new THREE.InstancedMesh(flowerGeometry, swayMaterial(0.055), 16);
  flowerInstances.name = 'decorative-wind-flowers';
  flowerInstances.castShadow = false;
  flowerInstances.receiveShadow = false;
  const flowerOffsets = [[-0.16, -0.1], [0.12, -0.14], [-0.08, 0.16], [0.19, 0.12]];
  const flowerTones = [0xe88eab, 0xf1c862, 0xfff7e7, 0x9fb9d7];
  let flowerIndex = 0;
  const flowerTransform = new THREE.Object3D();
  const instanceColor = new THREE.Color();
  for (const [x, z] of flowerPots) for (let i = 0; i < flowerOffsets.length; i++) {
    const [dx, dz] = flowerOffsets[i];
    flowerTransform.position.set(x + dx, 0.64, z + dz);
    flowerTransform.rotation.y = (i * 0.8 + x) % (Math.PI * 2);
    flowerTransform.scale.setScalar(0.72 + (i % 2) * 0.12);
    flowerTransform.updateMatrix();
    flowerInstances.setMatrixAt(flowerIndex, flowerTransform.matrix);
    flowerInstances.setColorAt(flowerIndex, instanceColor.setHex(flowerTones[i]));
    flowerIndex++;
  }
  flowerInstances.instanceMatrix.needsUpdate = true;
  if (flowerInstances.instanceColor) flowerInstances.instanceColor.needsUpdate = true;
  root.add(flowerInstances);

  colliders.push(
    { minX: 0, maxX: ROOM.width, minY: 0, maxY: ROOM.height, minZ: 0, maxZ: 0.8 },
    { minX: 0, maxX: 0.8, minY: 0, maxY: ROOM.height, minZ: 0, maxZ: ROOM.depth },
    { minX: ROOM.width - 0.8, maxX: ROOM.width, minY: 0, maxY: ROOM.height, minZ: 0, maxZ: ROOM.depth },
    { minX: 0, maxX: ROOM.width, minY: 0, maxY: ROOM.height, minZ: ROOM.depth - 0.8, maxZ: ROOM.depth },
  );
  // Боковые и задняя стены существуют физически; фасад открыт и остаётся вне camera blockers.
  cameraBlockers.push(
    { minX: 0, maxX: 0.3, minY: 0, maxY: ROOM.height, minZ: 0, maxZ: ROOM.depth },
    { minX: ROOM.width - 0.3, maxX: ROOM.width, minY: 0, maxY: ROOM.height, minZ: 0, maxZ: ROOM.depth },
    { minX: 0, maxX: ROOM.width, minY: 0, maxY: ROOM.height, minZ: ROOM.depth - 0.3, maxZ: ROOM.depth },
  );
  mergeStaticMeshes(root, geometrySet);

  return {
    root,
    room: ROOM,
    plan: FLORIST_PLAN,
    buckets,
    colliders,
    cameraBlockers,
    stations: FLORIST_PLAN.stations,
    bouquetPosition: new THREE.Vector3(FLORIST_PLAN.bouquet.x, FLORIST_PLAN.bouquet.y, FLORIST_PLAN.bouquet.z),
    wrappedBouquetPositions: FLORIST_PLAN.wrappedBouquet,
    setQuality(level) {
      const detail = QUALITY_PRESETS[level]?.detail ?? QUALITY_PRESETS.medium.detail;
      flowerInstances.count = Math.max(4, Math.round(16 * detail));
      return flowerInstances.count;
    },
    getDecorativeFlowerCount: () => flowerInstances.count,
    dispose() {
      for (const flower of displayFlowers) disposeFlower(flower);
      for (const label of labels) disposeLabel(label);
      root.traverse((node) => { if (node.isSprite && !labels.includes(node)) disposeLabel(node); });
      for (const geometry of geometrySet) geometry.dispose();
      geometrySet.clear();
    },
  };
}

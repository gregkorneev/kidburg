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

const ROOM = Object.freeze({ width: 14, depth: 10, height: 5.6 });

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

function createBucket(root, geometrySet, labels, displayFlowers, type, x, z) {
  const wood = stdMat(PALETTE.wood, { roughness: 0.84 });
  const darkWood = stdMat(PALETTE.woodDark, { roughness: 0.88 });
  const metal = stdMat('#d1b76f', { roughness: 0.42, metalness: 0.12 });
  const bucket = new THREE.Group();
  bucket.position.set(x, 0, z);
  root.add(bucket);
  addCylinder(bucket, geometrySet, darkWood, 0.38, 0.3, 0.7, 10, [0, 0.37, 0]);
  addCylinder(bucket, geometrySet, wood, 0.39, 0.32, 0.12, 10, [0, 0.70, 0]);
  addCylinder(bucket, geometrySet, metal, 0.405, 0.405, 0.07, 12, [0, 0.73, 0]);
  addCylinder(bucket, geometrySet, metal, 0.32, 0.32, 0.06, 12, [0, 0.07, 0]);

  const flowerModels = [];
  const offsets = [-0.19, -0.06, 0.08, 0.20];
  for (let i = 0; i < 4; i++) {
    const flower = createFlower(type, { id: `display-${type}-${i}` });
    flower.position.set(offsets[i], 0.48, offsets[(i + 2) % offsets.length] * 0.48);
    flower.rotation.z = (i - 1.5) * 0.09;
    flower.scale.setScalar(0.78 + (i % 2) * 0.07);
    bucket.add(flower);
    flowerModels.push(flower);
  }
  displayFlowers.push(...flowerModels);
  addLabel(root, labels, FLOWERS[type].label, [x, 1.85, z], 0.78, type === 'pink_tulip' ? '#e88eab' : type === 'red_rose' ? PALETTE.red : PALETTE.green);
  return { type, position: new THREE.Vector3(x, 0, z) };
}

/** Cutaway-интерьер без повторного фасада: уличная модель магазина уже существует в городе. */
export function buildFloristLayout() {
  const root = new THREE.Group();
  const geometrySet = new Set();
  const labels = [];
  const displayFlowers = [];
  const colliders = [];

  const plaster = stdMat(PALETTE.plaster, { roughness: 0.9 });
  const sage = stdMat('#b8cdb3', { roughness: 0.88 });
  const wood = stdMat(PALETTE.wood, { roughness: 0.78 });
  const woodDark = stdMat(PALETTE.woodDark, { roughness: 0.86 });
  const trim = stdMat(PALETTE.trim, { roughness: 0.74 });
  const glass = stdMat('#8fc4ce', { roughness: 0.32, metalness: 0.02 });
  const concrete = stdMat(PALETTE.concrete, { roughness: 0.9 });
  const furniture = createPrefabKit({ seed: 71, tint: 0.028 });

  // Плиточный пол и три стены оставляют переднюю сторону открытой для камеры.
  addBox(root, geometrySet, concrete, [ROOM.width, 0.28, ROOM.depth], [7, -0.14, 5]);
  addBox(root, geometrySet, plaster, [ROOM.width, ROOM.height, 0.28], [7, ROOM.height / 2, 0.12]);
  addBox(root, geometrySet, sage, [0.28, ROOM.height, ROOM.depth], [0.12, ROOM.height / 2, 5]);
  addBox(root, geometrySet, sage, [0.28, ROOM.height, ROOM.depth], [13.88, ROOM.height / 2, 5]);
  addBox(root, geometrySet, woodDark, [ROOM.width, 0.24, 0.32], [7, 0.25, 0.37]);
  addBox(root, geometrySet, trim, [ROOM.width, 0.15, 0.32], [7, ROOM.height - 0.14, 0.38]);
  for (const x of [0.45, 13.55]) addBox(root, geometrySet, wood, [0.24, ROOM.height, 0.2], [x, ROOM.height / 2, 0.34]);

  // Окна и витражи — внутренние элементы помещения, а не второй фасад.
  for (const x of [3.2, 6.9, 10.6]) {
    addBox(root, geometrySet, glass, [2.35, 1.52, 0.08], [x, 3.7, 0.29]);
    addBox(root, geometrySet, trim, [2.5, 0.12, 0.12], [x, 4.52, 0.31]);
    addBox(root, geometrySet, trim, [2.5, 0.12, 0.12], [x, 2.88, 0.31]);
    addBox(root, geometrySet, trim, [0.12, 1.76, 0.12], [x - 1.19, 3.7, 0.31]);
    addBox(root, geometrySet, trim, [0.12, 1.76, 0.12], [x + 1.19, 3.7, 0.31]);
    addBox(root, geometrySet, trim, [0.06, 1.56, 0.14], [x, 3.7, 0.34]);
    addBox(root, geometrySet, trim, [2.35, 0.06, 0.14], [x, 3.7, 0.34]);
  }

  // Периметрический карниз и тёплые деревянные стойки.
  for (const x of [2.4, 7, 11.6]) addBox(root, geometrySet, wood, [0.15, ROOM.height - 0.6, 0.16], [x, ROOM.height / 2, 0.53]);
  for (const z of [2.2, 5, 7.8]) {
    addBox(root, geometrySet, wood, [0.16, ROOM.height - 0.6, 0.15], [0.53, ROOM.height / 2, z]);
    addBox(root, geometrySet, wood, [0.16, ROOM.height - 0.6, 0.15], [13.47, ROOM.height / 2, z]);
  }
  addBox(root, geometrySet, sage, [13.1, 0.14, 0.22], [7, 4.95, 9.5]);

  // Стойка наставницы и стойка приёма/выдачи.
  for (const [x, z, width] of [[7, 2.0, 4.3], [3.2, 2.2, 2.6]]) {
    furniture.box(width, 0.9, 0.78, x, 0.56, z, PALETTE.woodDark, { r: 0.075 });
    furniture.box(width + 0.18, 0.18, 0.98, x, 1.08, z + 0.04, PALETTE.wood, { r: 0.07 });
    furniture.box(width - 0.28, 0.1, 0.06, x, 0.62, z + 0.42, PALETTE.trim, { r: 0.025 });
    furniture.box(width - 0.38, 0.08, 0.06, x, 0.29, z + 0.42, PALETTE.wood, { r: 0.025 });
    for (const dx of [-width * 0.32, 0, width * 0.32]) {
      furniture.box(0.42, 0.46, 0.035, x + dx, 0.58, z + 0.405, PALETTE.wood, { r: 0.035 });
      furniture.sphere(0.035, x + dx, 0.58, z + 0.445, FLORA_COLORS.warm, { w: 6, h: 5, tinted: false });
    }
    colliders.push({ minX: x - width / 2, maxX: x + width / 2, minY: 0, maxY: 1.25, minZ: z - 0.39, maxZ: z + 0.39 });
  }
  addBox(root, geometrySet, sage, [2.2, 0.5, 0.12], [7, 2.4, 1.55]);
  addLabel(root, labels, 'ЛАВКА ЛИЛИИ', [7, 2.42, 1.63], 0.88, '#78a475');
  addLabel(root, labels, 'ВЫДАЧА ЗАКАЗОВ', [3.2, 1.72, 2.62], 0.75, PALETTE.orange);

  // Центральный стол: цветы выкладываются на видимую столешницу по мере сборки.
  furniture.box(4.4, 0.82, 1.3, 7, 0.52, 5.35, PALETTE.woodDark, { r: 0.075 });
  furniture.box(4.7, 0.16, 1.52, 7, 1.0, 5.35, PALETTE.wood, { r: 0.07 });
  furniture.box(4.12, 0.055, 0.045, 7, 0.64, 6.015, PALETTE.trim, { r: 0.02 });
  furniture.box(1.5, 0.045, 0.62, 7, 1.105, 5.5, '#f3d9d5', { r: 0.018 });
  for (const x of [5.15, 8.85]) for (const z of [4.9, 5.8]) {
    furniture.box(0.16, 0.95, 0.16, x, 0.46, z, PALETTE.woodDark, { r: 0.035 });
  }
  addLabel(root, labels, 'РАБОЧИЙ СТОЛ', [7, 2.04, 4.35], 0.75, '#dca46a');
  colliders.push({ minX: 4.8, maxX: 9.2, minY: 0, maxY: 1.12, minZ: 4.7, maxZ: 6.0 });

  // Три полки с упаковочной бумагой и тремя цветами лент.
  for (const y of [1.2, 2.0, 2.8]) {
    furniture.box(1.75, 0.13, 0.55, 11.8, y, 1.1, PALETTE.wood, { r: 0.045 });
    furniture.box(1.75, 0.045, 0.055, 11.8, y + 0.11, 1.37, PALETTE.trim, { r: 0.018 });
    for (const [i, color] of ['#f4e3d5', '#e7bfd0', '#b8d2df'].entries()) {
      furniture.cyl(0.17, 0.17, 0.34, 8, 11.2 + i * 0.58, y + 0.31, 1.12, color, { rot: [0, 0, Math.PI / 2], tinted: false });
      furniture.box(0.38, 0.035, 0.04, 11.2 + i * 0.58, y + 0.49, 1.12, FLORA_COLORS.cream, { r: 0.015, tinted: false });
    }
  }
  addLabel(root, labels, 'БУМАГА И ЛЕНТЫ', [11.8, 3.45, 1.12], 0.72, '#75a8bd');

  // Упаковочный стол с хорошо видимым местом для готового букета.
  furniture.box(2.9, 0.76, 1.05, 10.65, 0.49, 8.1, PALETTE.woodDark, { r: 0.07 });
  furniture.box(3.08, 0.16, 1.2, 10.65, 0.95, 8.1, PALETTE.wood, { r: 0.07 });
  furniture.box(2.72, 0.045, 0.05, 10.65, 0.63, 8.63, '#e88eab', { r: 0.018 });
  for (const x of [9.45, 11.85]) for (const z of [7.72, 8.48]) furniture.box(0.14, 0.86, 0.14, x, 0.43, z, PALETTE.woodDark, { r: 0.025 });
  addLabel(root, labels, 'УПАКОВКА', [10.65, 1.95, 8.1], 0.76, '#e88eab');
  colliders.push({ minX: 9.2, maxX: 12.1, minY: 0, maxY: 1.08, minZ: 7.55, maxZ: 8.65 });

  const buckets = {};
  const bucketDefs = [
    ['pink_tulip', 1.65, 3.85], ['white_daisy', 1.65, 6.45],
    ['red_rose', 12.25, 3.85], ['greenery', 12.25, 6.45],
  ];
  for (const [type, x, z] of bucketDefs) buckets[type] = createBucket(root, geometrySet, labels, displayFlowers, type, x, z);

  // Комнатные растения и декоративные мелочи возле окна.
  const flowerPots = [[0.95, 1.3], [13.05, 1.3], [0.95, 8.9], [13.05, 8.9]];
  for (const [x, z] of flowerPots) {
    furniture.cyl(0.3, 0.23, 0.52, 8, x, 0.28, z, '#c98767', { tinted: false });
    furniture.cyl(0.32, 0.32, 0.075, 8, x, 0.54, z, PALETTE.trim, { tinted: false });
    furniture.cyl(0.22, 0.25, 0.05, 8, x, 0.55, z, FLORA_COLORS.soil, { tinted: false });
  }

  const furnitureGeometry = furniture.build({ groundAO: { height: 1.25, strength: 0.24 }, underside: 0.78 });
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
  for (const [x, z] of flowerPots) {
    for (let i = 0; i < flowerOffsets.length; i++) {
      const [dx, dz] = flowerOffsets[i];
      flowerTransform.position.set(x + dx, 0.56, z + dz);
      flowerTransform.rotation.y = (i * 0.8 + x) % (Math.PI * 2);
      flowerTransform.scale.setScalar(0.72 + (i % 2) * 0.12);
      flowerTransform.updateMatrix();
      flowerInstances.setMatrixAt(flowerIndex, flowerTransform.matrix);
      flowerInstances.setColorAt(flowerIndex, instanceColor.setHex(flowerTones[i]));
      flowerIndex++;
    }
  }
  flowerInstances.instanceMatrix.needsUpdate = true;
  if (flowerInstances.instanceColor) flowerInstances.instanceColor.needsUpdate = true;
  root.add(flowerInstances);

  // Фасад помещения открыт для обзора; физические границы не дают игроку выйти из cutaway.
  colliders.push(
    { minX: 0, maxX: ROOM.width, minY: 0, maxY: ROOM.height, minZ: 0, maxZ: 0.3 },
    { minX: 0, maxX: 0.3, minY: 0, maxY: ROOM.height, minZ: 0, maxZ: ROOM.depth },
    { minX: ROOM.width - 0.3, maxX: ROOM.width, minY: 0, maxY: ROOM.height, minZ: 0, maxZ: ROOM.depth },
    { minX: 0, maxX: ROOM.width, minY: 0, maxY: ROOM.height, minZ: ROOM.depth - 0.3, maxZ: ROOM.depth },
  );

  mergeStaticMeshes(root, geometrySet);
  return {
    root,
    buckets,
    colliders,
    stations: {
      lilia: new THREE.Vector3(7, 0, 2.95),
      handoff: new THREE.Vector3(3.2, 0, 3.0),
      workbench: new THREE.Vector3(7, 0, 6.25),
      wrapping: new THREE.Vector3(9.0, 0, 8.1),
    },
    bouquetPosition: new THREE.Vector3(7, 1.12, 5.35),
    wrappedBouquetPositions: {
      wrapping: new THREE.Vector3(10.65, 1.05, 8.1),
      handoff: new THREE.Vector3(3.2, 1.16, 2.24),
    },
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

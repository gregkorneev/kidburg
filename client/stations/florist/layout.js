import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from '../../engine/art/palette.js';
import { stdMat } from '../../engine/art/materials.js';
import { createLabelSprite, disposeLabel } from '../../engine/art/labels.js';
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
  for (const mesh of [...root.children]) {
    if (!mesh.isMesh) continue;
    mesh.updateMatrix();
    const geometry = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(mesh.matrix);
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
      entries.forEach(({ mesh: source }) => root.remove(source));
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
  const planter = stdMat('#b56a4d', { roughness: 0.82 });
  const concrete = stdMat(PALETTE.concrete, { roughness: 0.9 });
  const green = stdMat(PALETTE.green, { roughness: 0.82 });
  const yellow = stdMat(PALETTE.yellow, { roughness: 0.72 });
  const sign = stdMat('#fff7e8', { roughness: 0.75 });

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
    addBox(root, geometrySet, woodDark, [width, 0.9, 0.78], [x, 0.56, z]);
    addBox(root, geometrySet, wood, [width + 0.18, 0.18, 0.98], [x, 1.08, z + 0.04]);
    addBox(root, geometrySet, trim, [width - 0.28, 0.1, 0.06], [x, 0.62, z + 0.42]);
    colliders.push({ minX: x - width / 2, maxX: x + width / 2, minY: 0, maxY: 1.25, minZ: z - 0.39, maxZ: z + 0.39 });
  }
  addBox(root, geometrySet, sage, [2.2, 0.5, 0.12], [7, 2.4, 1.55]);
  addLabel(root, labels, 'ЛАВКА ЛИЛИИ', [7, 2.42, 1.63], 0.88, '#78a475');
  addLabel(root, labels, 'ВЫДАЧА ЗАКАЗОВ', [3.2, 1.72, 2.62], 0.75, PALETTE.orange);

  // Центральный стол: цветы выкладываются на видимую столешницу по мере сборки.
  addBox(root, geometrySet, woodDark, [4.4, 0.82, 1.3], [7, 0.52, 5.35]);
  addBox(root, geometrySet, wood, [4.7, 0.16, 1.52], [7, 1.0, 5.35]);
  for (const x of [5.15, 8.85]) for (const z of [4.9, 5.8]) {
    addBox(root, geometrySet, woodDark, [0.16, 0.95, 0.16], [x, 0.46, z]);
  }
  addLabel(root, labels, 'РАБОЧИЙ СТОЛ', [7, 2.04, 4.35], 0.75, '#dca46a');
  colliders.push({ minX: 4.8, maxX: 9.2, minY: 0, maxY: 1.12, minZ: 4.7, maxZ: 6.0 });

  // Три полки с упаковочной бумагой и тремя цветами лент.
  for (const y of [1.2, 2.0, 2.8]) {
    addBox(root, geometrySet, wood, [1.75, 0.13, 0.55], [11.8, y, 1.1]);
    for (const [i, color] of ['#f4e3d5', '#e7bfd0', '#b8d2df'].entries()) {
      addBox(root, geometrySet, stdMat(color), [0.39, 0.48, 0.28], [11.2 + i * 0.58, y + 0.29, 1.12], [0.04, 0, (i - 1) * 0.10]);
    }
  }
  addLabel(root, labels, 'БУМАГА И ЛЕНТЫ', [11.8, 3.45, 1.12], 0.72, '#75a8bd');

  // Упаковочный стол с хорошо видимым местом для готового букета.
  addBox(root, geometrySet, woodDark, [2.9, 0.76, 1.05], [10.65, 0.49, 8.1]);
  addBox(root, geometrySet, wood, [3.08, 0.16, 1.2], [10.65, 0.95, 8.1]);
  for (const x of [9.45, 11.85]) for (const z of [7.72, 8.48]) addBox(root, geometrySet, woodDark, [0.14, 0.86, 0.14], [x, 0.43, z]);
  addLabel(root, labels, 'УПАКОВКА', [10.65, 1.95, 8.1], 0.76, '#e88eab');
  colliders.push({ minX: 9.2, maxX: 12.1, minY: 0, maxY: 1.08, minZ: 7.55, maxZ: 8.65 });

  const buckets = {};
  const bucketDefs = [
    ['pink_tulip', 1.65, 3.85], ['white_daisy', 1.65, 6.45],
    ['red_rose', 12.25, 3.85], ['greenery', 12.25, 6.45],
  ];
  for (const [type, x, z] of bucketDefs) buckets[type] = createBucket(root, geometrySet, labels, displayFlowers, type, x, z);

  // Комнатные растения и декоративные мелочи возле окна.
  for (const [x, z] of [[0.95, 1.3], [13.05, 1.3], [0.95, 8.9], [13.05, 8.9]]) {
    addBox(root, geometrySet, planter, [0.52, 0.42, 0.52], [x, 0.22, z]);
    addCylinder(root, geometrySet, green, 0.2, 0.26, 0.22, 8, [x, 0.5, z]);
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 7), stdMat(PALETTE.leaf[i % PALETTE.leaf.length]));
      leaf.geometry.scale(0.12, 0.42, 0.09);
      geometrySet.add(leaf.geometry);
      leaf.position.set(x + Math.cos(angle) * 0.22, 0.92 + (i % 2) * 0.12, z + Math.sin(angle) * 0.22);
      leaf.rotation.z = Math.cos(angle) * 0.55;
      leaf.castShadow = true;
      root.add(leaf);
    }
  }

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
    dispose() {
      for (const flower of displayFlowers) disposeFlower(flower);
      for (const label of labels) disposeLabel(label);
      root.traverse((node) => { if (node.isSprite && !labels.includes(node)) disposeLabel(node); });
      for (const geometry of geometrySet) geometry.dispose();
      geometrySet.clear();
    },
  };
}

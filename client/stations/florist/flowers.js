import * as THREE from 'three';
import { PALETTE } from '../../engine/art/palette.js';
import { stdMat } from '../../engine/art/materials.js';
import { FLOWERS } from './state.js';

const palette = {
  pink_tulip: { petal: '#ed9cb5', shade: '#ce6e91', center: '#f6ce78', stem: '#4f8b59' },
  white_daisy: { petal: '#fff8e8', shade: '#eadfc9', center: '#f0c84f', stem: '#4e8957' },
  red_rose: { petal: '#d9564d', shade: '#a83f42', center: '#f4bd64', stem: '#477d50' },
  greenery: { petal: '#8dbd68', shade: '#4d8c5b', center: '#39764f', stem: '#3f7950' },
};

const ribbonColors = Object.freeze({ pink: '#e88eab', yellow: '#efc34c', blue: '#69a8c1' });

function addMesh(parent, geometries, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) {
  geometries.add(geometry);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function makeLeaf(parent, geometries, color, x, y, z, angle, size = 1) {
  return addMesh(parent, geometries, new THREE.SphereGeometry(1, 10, 7), stdMat(color), [x, y, z], [0, 0, angle], [0.105 * size, 0.34 * size, 0.055 * size]);
}

/** Создаёт один различимый процедурный стебель. Геометрии принадлежат модели и освобождаются через disposeFlower. */
export function createFlower(type, { id = null } = {}) {
  if (!Object.hasOwn(FLOWERS, type)) throw new TypeError(`Неизвестный вид цветка: ${type}`);
  const root = new THREE.Group();
  const geometries = new Set();
  const colors = palette[type];
  const stem = stdMat(colors.stem, { roughness: 0.85 });
  const leaf = stdMat(colors.shade, { roughness: 0.85 });
  const petal = stdMat(colors.petal, { roughness: 0.62, side: THREE.DoubleSide });
  const petalShade = stdMat(colors.shade, { roughness: 0.68 });
  const center = stdMat(colors.center, { roughness: 0.55 });

  addMesh(root, geometries, new THREE.CylinderGeometry(0.028, 0.035, 0.92, 7), stem, [0, 0.46, 0]);
  makeLeaf(root, geometries, colors.stem, -0.09, 0.38, 0.015, -0.55, 0.8);
  makeLeaf(root, geometries, colors.shade, 0.10, 0.57, -0.005, 0.58, 0.72);

  if (type === 'pink_tulip') {
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const r = i % 2 ? 0.105 : 0.075;
      addMesh(root, geometries, new THREE.SphereGeometry(1, 12, 9), i % 2 ? petal : petalShade,
        [Math.cos(angle) * r, 0.99 + (i % 2) * 0.025, Math.sin(angle) * r], [0.18 * Math.cos(angle), 0, -0.12 * Math.sin(angle)], [0.105, 0.22, 0.09]);
    }
    addMesh(root, geometries, new THREE.SphereGeometry(1, 12, 8), petal, [0, 1.02, 0], [0, 0, 0], [0.13, 0.17, 0.12]);
  } else if (type === 'white_daisy') {
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2;
      addMesh(root, geometries, new THREE.SphereGeometry(1, 10, 7), i % 2 ? petal : petalShade,
        [Math.cos(angle) * 0.16, 1.02, Math.sin(angle) * 0.16], [0, 0, -angle], [0.075, 0.20, 0.055]);
    }
    addMesh(root, geometries, new THREE.SphereGeometry(1, 12, 9), center, [0, 1.03, 0], [0, 0, 0], [0.115, 0.115, 0.11]);
    addMesh(root, geometries, new THREE.SphereGeometry(1, 10, 7), stdMat(PALETTE.yellow), [0, 1.09, 0.045], [0, 0, 0], [0.035, 0.025, 0.025]);
  } else if (type === 'red_rose') {
    for (let layer = 0; layer < 3; layer++) {
      const count = layer === 0 ? 5 : 4;
      const radius = 0.12 - layer * 0.038;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + layer * 0.55;
        addMesh(root, geometries, new THREE.SphereGeometry(1, 12, 8), (i + layer) % 3 === 0 ? petalShade : petal,
          [Math.cos(angle) * radius, 0.98 + layer * 0.065, Math.sin(angle) * radius], [0.12, 0, -angle], [0.105 - layer * 0.018, 0.14 - layer * 0.018, 0.09]);
      }
    }
    addMesh(root, geometries, new THREE.SphereGeometry(1, 12, 8), center, [0, 1.12, 0], [0, 0, 0], [0.06, 0.065, 0.06]);
  } else {
    for (let i = 0; i < 7; i++) {
      const side = i % 2 ? 1 : -1;
      const y = 0.28 + i * 0.105;
      makeLeaf(root, geometries, i % 3 ? colors.stem : colors.shade, side * 0.075, y, 0, side * 0.78, 0.85);
    }
    addMesh(root, geometries, new THREE.SphereGeometry(1, 10, 7), center, [0, 1.08, 0], [0, 0, 0], [0.075, 0.12, 0.075]);
  }

  root.userData.flower = { id, type, label: FLOWERS[type].label };
  root.userData.ownedGeometries = geometries;
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
  addMesh(group, geometrySet, new THREE.ConeGeometry(0.48, 0.9, 7, 1, true), paper, [0, 0.45, 0], [0, 0, 0], [1, 1, 0.74]);
  addMesh(group, geometrySet, new THREE.CylinderGeometry(0.34, 0.37, 0.095, 8), band, [0, 0.49, 0], [0, 0, 0], [1, 1, 0.76]);
  for (const side of [-1, 1]) {
    const loop = addMesh(group, geometrySet, new THREE.TorusGeometry(0.19, 0.045, 7, 16), band,
      [side * 0.16, 0.72, 0.02], [0, side * 0.15, side * 0.45], [1.25, 0.75, 0.72]);
    loop.castShadow = true;
  }
  addMesh(group, geometrySet, new THREE.SphereGeometry(1, 10, 7), darkBand, [0, 0.70, 0.07], [0, 0, 0], [0.095, 0.10, 0.075]);
  for (const side of [-1, 1]) {
    addMesh(group, geometrySet, new THREE.ConeGeometry(0.07, 0.34, 4), band,
      [side * 0.14, 0.40, 0.10], [side * -0.18, 0, side * 0.22], [1, 1, 0.45]);
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

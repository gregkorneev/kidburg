import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NOTES } from './melody.js';

const MAT = Object.freeze({ casing: '#282b35', edge: '#414553', keyWhite: '#fffdf5', keyBlack: '#22252c', gold: '#c9a35a', wood: '#664632', stool: '#9b6543' });

export function createPiano({ position = { x: 0, z: 0 }, rotationY = 0, name = 'practice-piano' } = {}) {
  const root = new THREE.Group();
  root.name = name;
  root.position.set(position.x, position.y ?? 0, position.z);
  root.rotation.y = rotationY;
  const owned = new Set();
  const materials = new Map();
  const makeMat = (color) => {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: color === MAT.casing ? 0.3 : 0.78, metalness: color === MAT.gold ? 0.5 : 0.02 }));
    return materials.get(color);
  };
  const part = (parent, size, at, color, cast = true) => {
    const geometry = new THREE.BoxGeometry(...size); owned.add(geometry);
    const item = new THREE.Mesh(geometry, makeMat(color));
    item.position.set(...at); item.castShadow = cast; item.receiveShadow = true; parent.add(item); return item;
  };
  part(root, [2.62, 0.52, 0.62], [0, 0.76, -0.36], MAT.casing);
  part(root, [2.68, 0.09, 0.65], [0, 1.16, -0.36], MAT.edge);
  part(root, [2.54, 0.11, 0.5], [0, 1.5, -0.43], MAT.casing);
  part(root, [2.6, 0.07, 0.5], [0, 1.3, -0.39], MAT.edge);
  part(root, [2.3, 0.08, 0.82], [0, 0.845, 0.37], '#343743');
  for (const x of [-1.25, 1.25]) part(root, [0.16, 0.45, 0.72], [x, 0.78, 0.32], MAT.casing);
  part(root, [2.62, 0.15, 0.14], [0, 0.65, 0.62], MAT.edge);
  for (const x of [-1.12, 1.12]) for (const z of [-0.42, 0.42]) part(root, [0.12, 0.91, 0.13], [x, 0.48, z], MAT.wood);
  // Hinged lid rests open above the soundboard.
  part(root, [2.6, 0.08, 0.62], [0, 1.56, -0.36], MAT.edge).rotation.x = -0.16;
  part(root, [2.14, 0.07, 0.44], [0, 1.47, -0.15], '#5c606e');
  // Music rest and a small two-page score.
  part(root, [1.72, 0.07, 0.1], [0, 1.75, -0.43], MAT.gold).rotation.x = -0.15;
  const score = part(root, [0.86, 0.03, 0.58], [0, 1.79, -0.35], '#fff5d8');
  score.rotation.x = -0.28;
  for (let i = 0; i < 5; i++) part(root, [0.68, 0.009, 0.008], [0, 1.83 + i * 0.015, -0.48], '#8d8171', false);
  for (const x of [-0.25, 0, 0.26]) part(root, [0.28, 0.075, 0.045], [x, 0.22, 0.78], MAT.gold);
  // A friendly padded bench and four tapered-looking supports.
  part(root, [1.36, 0.18, 0.52], [0, 0.74, 1.05], MAT.stool);
  for (const x of [-0.52, 0.52]) for (const z of [0.86, 1.24]) part(root, [0.1, 0.64, 0.1], [x, 0.34, z], MAT.wood);
  const keys = new Map();
  const whiteNotes = NOTES.filter((note) => !note.black);
  const whiteWidth = 2.16 / 8;
  whiteNotes.forEach((note, i) => {
    const key = part(root, [whiteWidth - 0.018, 0.075, 0.78], [(i - 3.5) * whiteWidth, 0.925, 0.39], MAT.keyWhite, false);
    key.userData.note = note.id; key.userData.baseY = key.position.y; key.userData.black = false;
    key.userData.originalMaterial = key.material;
    keys.set(note.id, key);
  });
  const blackAfterWhite = [0, 1, 3, 4, 5];
  const blackNotes = NOTES.filter((note) => note.black);
  blackNotes.forEach((note, i) => {
    const boundary = blackAfterWhite[i];
    const x = (boundary - 3) * whiteWidth;
    const key = part(root, [0.145, 0.12, 0.48], [x, 1.015, 0.2], MAT.keyBlack, true);
    key.userData.note = note.id; key.userData.baseY = key.position.y; key.userData.black = true;
    key.userData.originalMaterial = key.material;
    keys.set(note.id, key);
  });
  const goldMat = makeMat(MAT.gold);
  for (let i = 0; i < 3; i++) {
    const pedal = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, 0.045, 8), goldMat);
    pedal.rotation.x = Math.PI / 2; pedal.position.set((i - 1) * 0.24, 0.045, 0.66); pedal.castShadow = true; root.add(pedal);
  }
  const staticGroups = new Map();
  for (const child of [...root.children]) {
    if (!child.isMesh || child.userData.note) continue;
    if (!staticGroups.has(child.material)) staticGroups.set(child.material, []);
    staticGroups.get(child.material).push(child);
  }
  for (const [material, meshes] of staticGroups) {
    const geometries = meshes.map((item) => {
      item.updateMatrix();
      const geometry = item.geometry.toNonIndexed().clone().applyMatrix4(item.matrix);
      item.geometry.dispose(); owned.delete(item.geometry);
      return geometry;
    });
    const geometry = mergeGeometries(geometries, false);
    geometries.forEach((item) => item.dispose());
    if (!geometry) continue;
    owned.add(geometry);
    const merged = new THREE.Mesh(geometry, material);
    merged.castShadow = meshes.some((item) => item.castShadow); merged.receiveShadow = true;
    root.remove(...meshes); root.add(merged);
  }
  return {
    root, keys, position: root.position, rotationY, name,
    press(noteId, active = true) {
      const key = keys.get(noteId); if (!key) return false;
      key.position.y = key.userData.baseY - (active ? (key.userData.black ? 0.045 : 0.035) : 0);
      key.material = active ? makeMat(key.userData.black ? '#654d43' : '#e7d6ac') : key.userData.originalMaterial;
      return true;
    },
    dispose() {
      root.removeFromParent();
      for (const geometry of owned) geometry.dispose();
      for (const material of materials.values()) material.dispose();
      owned.clear(); materials.clear(); keys.clear(); root.clear();
    },
  };
}

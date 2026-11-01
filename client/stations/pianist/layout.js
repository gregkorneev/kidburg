import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PIANIST_PLAN, ROOM, ROOM_COLLIDERS } from './layout-plan.js';

const COLORS = Object.freeze({ floor: '#a9764c', plank: '#bf8b5d', trim: '#f4e6c9', cream: '#f7edd8', blue: '#b9dce7', blueDark: '#80b5c7', wood: '#9c633f', gold: '#e6ba63', red: '#c96d72', curtain: '#b65f70', glass: '#aadce9' });
const boxGeo = new THREE.BoxGeometry(1, 1, 1);

export function buildPianistLayout() {
  const root = new THREE.Group();
  root.name = 'pianist-music-school';
  const materials = new Map();
  const ownedGeometries = new Set();
  const mesh = (parent, size, position, color, options = {}) => {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: options.roughness ?? 0.82, metalness: options.metalness ?? 0 }));
    const geometry = boxGeo.clone().scale(...size);
    ownedGeometries.add(geometry);
    const item = new THREE.Mesh(geometry, materials.get(color));
    item.position.set(...position);
    item.castShadow = options.cast ?? true;
    item.receiveShadow = options.receive ?? true;
    parent.add(item);
    return item;
  };
  const colliders = [...ROOM_COLLIDERS];
  const cameraBlockers = [];
  const concertLights = [];

  mesh(root, [ROOM.width, 0.22, ROOM.depth], [10, -0.12, 7.5], COLORS.floor, { cast: false });
  for (let i = 1; i < 32; i++) mesh(root, [0.018, 0.006, ROOM.depth], [i * 0.64, 0.001, 7.5], i % 4 ? '#996744' : '#87583a', { cast: false, receive: false });
  // Spacious cream walls with pale blue wainscoting. The entrance wall stays open for preview entry.
  mesh(root, [ROOM.width, 5.8, 0.24], [10, 3, 15.12], COLORS.cream);
  mesh(root, [0.24, 5.8, ROOM.depth], [-0.12, 3, 7.5], COLORS.cream);
  mesh(root, [0.24, 5.8, ROOM.depth], [20.12, 3, 7.5], COLORS.cream);
  for (const [x, w] of [[2.5, 4.3], [8.0, 3.7], [13.1, 4.8]]) {
    mesh(root, [w, 1.15, 0.08], [x, 0.64, 14.96], COLORS.blue);
    mesh(root, [w, 0.11, 0.13], [x, 1.22, 14.9], COLORS.trim);
  }
  for (const x of [2.8, 6.6, 10.4, 14.2, 17.6]) {
    mesh(root, [2.15, 1.82, 0.12], [x, 3.6, 14.91], COLORS.glass, { roughness: 0.22 });
    mesh(root, [2.3, 0.16, 0.26], [x, 2.66, 14.78], COLORS.trim);
    mesh(root, [0.12, 1.94, 0.2], [x - 1.12, 3.6, 14.8], COLORS.trim);
    mesh(root, [0.12, 1.94, 0.2], [x + 1.12, 3.6, 14.8], COLORS.trim);
    mesh(root, [0.09, 1.82, 0.21], [x, 3.6, 14.78], COLORS.trim);
    mesh(root, [2.12, 0.1, 0.2], [x, 3.6, 14.77], COLORS.trim);
  }
  // Tall side windows bring daylight into the room.
  for (const z of [3.2, 7.5, 11.7]) {
    for (const x of [0.08, 19.92]) {
      mesh(root, [0.06, 1.8, 2.55], [x, 3.5, z], COLORS.glass, { roughness: 0.2 });
      mesh(root, [0.12, 0.11, 2.7], [x, 2.57, z], COLORS.trim);
      mesh(root, [0.12, 0.11, 2.7], [x, 4.43, z], COLORS.trim);
      mesh(root, [0.12, 1.9, 0.12], [x, 3.5, z - 1.32], COLORS.trim);
      mesh(root, [0.12, 1.9, 0.12], [x, 3.5, z + 1.32], COLORS.trim);
    }
  }
  // Music recital stage with soft curtains, valance, lights and front steps.
  mesh(root, [9.2, 0.12, 3.4], [10.8, 0.06, 12.95], '#d3ab78');
  mesh(root, [9.05, 0.035, 3.25], [10.8, 0.1375, 12.95], '#e2c08c');
  mesh(root, [9.2, 3.2, 0.3], [10.8, 2.14, 14.73], COLORS.curtain);
  for (let i = 0; i < 11; i++) mesh(root, [0.23, 3.0, 0.38], [6.5 + i * 0.86, 2.1, 14.5], i % 2 ? '#c56d79' : '#a95769');
  mesh(root, [9.5, 0.44, 0.55], [10.8, 3.85, 14.43], '#a95769');
  for (const x of [7.0, 10.8, 14.6]) {
    mesh(root, [0.46, 0.18, 0.38], [x, 5.52, 13.5], COLORS.gold, { metalness: 0.25 });
    const light = new THREE.SpotLight('#ffe1a3', 8, 9, Math.PI / 5, 0.55, 1.2);
    light.position.set(x, 5.45, 13.35);
    light.target.position.set(x, 0.7, 11.4);
    root.add(light, light.target);
    concertLights.push(light);
  }
  // Tiny local DataTextures show a music staff and notes without DOM or external assets.
  for (const [index, [x, z]] of [[0, [3.0, 2.0]], [1, [16.7, 2.0]], [2, [3.0, 9.1]], [3, [17, 8.7]]]) {
    const width = 64; const height = 48; const data = new Uint8Array(width * height * 4);
    const paper = new THREE.Color(index % 2 ? '#f7dfac' : '#d8edf0');
    for (let p = 0; p < width * height; p++) data.set([Math.round(paper.r * 255), Math.round(paper.g * 255), Math.round(paper.b * 255), 255], p * 4);
    const ink = [76, 75, 73, 255]; const red = [184, 78, 94, 255];
    const put = (px, py, color) => { if (px >= 0 && px < width && py >= 0 && py < height) data.set(color, (py * width + px) * 4); };
    for (let py = 13; py <= 30; py += 4) for (let px = 5; px < width - 5; px++) put(px, py, ink);
    for (const [nx, ny] of [[17, 15], [31, 23], [45, 27]]) {
      for (let py = -2; py <= 2; py++) for (let px = -3; px <= 3; px++) if (px * px + py * py < 10) put(nx + px, ny + py, red);
      for (let py = ny - 13; py < ny; py++) put(nx + 4, py, red);
    }
    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace; texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearFilter; texture.needsUpdate = true;
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, side: THREE.DoubleSide });
    materials.set(`poster-${index}`, material);
    const poster = new THREE.Mesh(boxGeo.clone().scale(1.45, 1.08, 0.055), material);
    ownedGeometries.add(poster.geometry);
    poster.position.set(x, 3.6, z); poster.castShadow = true; root.add(poster);
    mesh(root, [1.56, 0.1, 0.1], [x, 4.16, z], COLORS.gold);
  }
  // Shelves with sheet music and a few music books.
  for (const [x, z] of [[1.8, 6.0], [18.2, 5.5]]) {
    mesh(root, [2.25, 0.12, 0.42], [x, 1.3, z], COLORS.wood);
    mesh(root, [2.25, 0.12, 0.42], [x, 2.25, z], COLORS.wood);
    for (const y of [1.75, 2.7]) for (let i = 0; i < 6; i++) mesh(root, [0.22, 0.34, 0.28], [x - 0.8 + i * 0.29, y, z], ['#d47970', '#e1bd74', '#82aab1', '#798e78'][i % 4]);
  }
  // Small music stands beside the practice space.
  for (const x of [4.0, 17.0]) {
    mesh(root, [0.7, 0.46, 0.08], [x, 1.55, 6.2], '#76523e');
    mesh(root, [0.08, 1.35, 0.08], [x, 0.82, 6.25], '#7d624a');
    mesh(root, [0.52, 0.35, 0.025], [x, 1.57, 6.145], '#fff4d4', { cast: false });
  }
  cameraBlockers.push(...ROOM_COLLIDERS.slice(0, 3));
  function mergeStaticMeshes(parent) {
    const groups = new Map();
    for (const child of [...parent.children]) {
      if (!child.isMesh) continue;
      if (!groups.has(child.material)) groups.set(child.material, []);
      groups.get(child.material).push(child);
    }
    for (const [material, meshes] of groups) {
      const geometries = meshes.map((item) => {
        item.updateMatrix();
        const geometry = item.geometry.toNonIndexed().clone().applyMatrix4(item.matrix);
        item.geometry.dispose(); ownedGeometries.delete(item.geometry);
        return geometry;
      });
      const geometry = mergeGeometries(geometries, false);
      geometries.forEach((item) => item.dispose());
      if (!geometry) continue;
      ownedGeometries.add(geometry);
      const merged = new THREE.Mesh(geometry, material);
      merged.castShadow = meshes.some((item) => item.castShadow); merged.receiveShadow = true;
      parent.remove(...meshes); parent.add(merged);
    }
  }
  mergeStaticMeshes(root);
  return {
    root, colliders, cameraBlockers, room: ROOM, plan: PIANIST_PLAN,
    setConcertMode(active) { for (const light of concertLights) light.intensity = active ? 40 : 8; },
    dispose() {
      root.removeFromParent();
      for (const geometry of ownedGeometries) geometry.dispose();
      for (const material of materials.values()) { material.map?.dispose(); material.dispose(); }
      materials.clear(); ownedGeometries.clear(); root.clear();
    },
  };
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AUDIENCE_CHAIRS, AUDIENCE_COLLIDERS, BETWEEN_PIANOS_CHAIRS, PIANIST_PLAN, POSTER_MOUNTS, ROOM, ROOM_COLLIDERS, STAGE_COLLIDERS } from './layout-plan.js';

const COLORS = Object.freeze({ floor: '#a9764c', plank: '#bf8b5d', trim: '#f4e6c9', cream: '#f7edd8', blue: '#b9dce7', blueDark: '#80b5c7', wood: '#9c633f', gold: '#e6ba63', red: '#c96d72', curtain: '#b65f70', glass: '#aadce9' });
const boxGeo = new THREE.BoxGeometry(1, 1, 1);

function roundedPanelGeometry(width, height, depth, radius) {
  const x = width / 2; const y = height / 2; const r = Math.min(radius, x, y);
  const shape = new THREE.Shape();
  shape.moveTo(-x + r, -y); shape.lineTo(x - r, -y); shape.quadraticCurveTo(x, -y, x, -y + r);
  shape.lineTo(x, y - r); shape.quadraticCurveTo(x, y, x - r, y); shape.lineTo(-x + r, y);
  shape.quadraticCurveTo(-x, y, -x, y - r); shape.lineTo(-x, -y + r); shape.quadraticCurveTo(-x, -y, -x + r, -y);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelThickness: 0.018, bevelSize: Math.min(0.025, r / 2), curveSegments: 2 });
  geometry.computeVertexNormals();
  return geometry;
}

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
  // Raised recital stage with a broad, walkable three-step entrance.
  const { stage, stairs } = PIANIST_PLAN;
  const stageWidth = stage.maxX - stage.minX; const stageDepth = stage.maxZ - stage.minZ;
  const stageX = (stage.minX + stage.maxX) / 2; const stageZ = (stage.minZ + stage.maxZ) / 2;
  mesh(root, [stageWidth, stage.height - 0.06, stageDepth], [stageX, (stage.height - 0.06) / 2, stageZ], '#c69a6e');
  mesh(root, [stageWidth, 0.06, stageDepth], [stageX, stage.height - 0.03, stageZ], '#e2c08c');
  for (let i = 0; i < stairs.count; i++) {
    const height = (i + 1) * stairs.stepHeight;
    mesh(root, [stairs.width, height, stairs.stepDepth], [stairs.centerX, height / 2, stairs.startZ + (i + 0.5) * stairs.stepDepth], i % 2 ? '#d5ad7a' : '#c99a69');
    mesh(root, [stairs.width - 0.12, 0.025, stairs.stepDepth - 0.06], [stairs.centerX, height + 0.013, stairs.startZ + (i + 0.5) * stairs.stepDepth], '#e6c692');
  }
  colliders.push(...STAGE_COLLIDERS);
  cameraBlockers.push(...STAGE_COLLIDERS, { minX: stage.minX, maxX: stage.maxX, minY: 0, maxY: stage.height, minZ: stage.minZ, maxZ: stage.maxZ });
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
  // Each complete poster is grouped and mounted on an open section of a side wall.
  for (const [index, mount] of POSTER_MOUNTS.entries()) {
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
    const poster = new THREE.Group(); poster.name = `music-poster-${index}`;
    poster.position.set(mount.x, mount.y, mount.z); poster.rotation.y = mount.rotationY;
    root.add(poster);
    mesh(poster, [1.62, 1.2, 0.08], [0, 0, -0.025], COLORS.wood);
    mesh(poster, [1.5, 1.08, 0.035], [0, 0, 0.025], index % 2 ? '#f7dfac' : '#d8edf0');
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, side: THREE.DoubleSide });
    materials.set(`poster-${index}`, material);
    const image = new THREE.Mesh(boxGeo.clone().scale(1.42, 1.0, 0.018), material);
    ownedGeometries.add(image.geometry); image.position.set(0, -0.015, 0.052); image.castShadow = false; poster.add(image);
    mesh(poster, [1.66, 0.12, 0.12], [0, 0.66, 0.025], COLORS.gold);
    mesh(poster, [0.1, 0.1, 0.11], [-0.78, 0.66, 0.035], COLORS.red);
    mesh(poster, [0.1, 0.1, 0.11], [0.78, 0.66, 0.035], COLORS.red);
    mergeStaticMeshes(poster);
  }
  // Empty low-poly audience chairs. Their locations are defined by the room plan;
  // the center aisle between the left and right blocks stays open.
  const audience = new THREE.Group(); audience.name = 'audience-chairs'; root.add(audience);
  const allChairs = [
    ...BETWEEN_PIANOS_CHAIRS.map((seat, index) => ({ ...seat, name: `between-pianos-chair-${index + 1}` })),
    ...AUDIENCE_CHAIRS.map((seat, index) => ({ ...seat, name: `audience-chair-${index + 1}` })),
  ];
  for (const seat of allChairs) {
    const chair = new THREE.Group(); chair.name = seat.name;
    chair.position.set(seat.x, 0, seat.z); chair.rotation.y = seat.rotationY; audience.add(chair);
    for (const x of [-0.27, 0.27]) for (const z of [-0.23, 0.23]) mesh(chair, [0.07, 0.52, 0.07], [x, 0.26, z], COLORS.wood);
    for (const x of [-0.27, 0.27]) mesh(chair, [0.065, 0.62, 0.07], [x, 0.79, -0.235], COLORS.wood);
    const cushionGeometry = roundedPanelGeometry(0.66, 0.58, 0.13, 0.09); cushionGeometry.rotateX(-Math.PI / 2); ownedGeometries.add(cushionGeometry);
    const cushion = new THREE.Mesh(cushionGeometry, materials.get('#b9dce7') ?? new THREE.MeshStandardMaterial({ color: '#b9dce7', roughness: 0.92 }));
    if (!materials.has('#b9dce7')) materials.set('#b9dce7', cushion.material);
    cushion.position.set(0, 0.49, 0.0); cushion.castShadow = true; cushion.receiveShadow = true; chair.add(cushion);
    const backGeometry = roundedPanelGeometry(0.66, 0.42, 0.13, 0.09); ownedGeometries.add(backGeometry);
    const back = new THREE.Mesh(backGeometry, cushion.material); back.position.set(0, 1.0, -0.29); back.castShadow = true; back.receiveShadow = true; chair.add(back);
    mergeStaticMeshes(chair);
  }
  colliders.push(...AUDIENCE_COLLIDERS);
  cameraBlockers.push(...AUDIENCE_COLLIDERS);
  // Music books sit below the windows on the opposite wall, away from the practice piano.
  for (const { x, z } of PIANIST_PLAN.wallShelves) {
    mesh(root, [0.42, 0.12, 2.25], [x, 1.15, z], COLORS.wood);
    mesh(root, [0.42, 0.12, 2.25], [x, 1.95, z], COLORS.wood);
    for (const y of [1.6, 2.25]) for (let i = 0; i < 6; i++) mesh(root, [0.28, 0.34, 0.22], [x + 0.16, y, z - 0.8 + i * 0.29], ['#d47970', '#e1bd74', '#82aab1', '#798e78'][i % 4]);
    const shelfCollider = { minX: x - 0.21, maxX: x + 0.21, minY: 0, maxY: 2.5, minZ: z - 1.125, maxZ: z + 1.125 };
    colliders.push(shelfCollider); cameraBlockers.push(shelfCollider);
  }
  // A compact corner rack displays instruments instead of empty music boards.
  const display = new THREE.Group(); display.name = 'instrument-display';
  display.position.set(PIANIST_PLAN.instrumentDisplay.x, 0, PIANIST_PLAN.instrumentDisplay.z);
  display.rotation.y = PIANIST_PLAN.instrumentDisplay.rotationY; root.add(display);
  mesh(display, [1.2, 0.12, 0.48], [0, 0.08, 0], COLORS.wood);
  for (const x of [-0.52, 0.52]) mesh(display, [0.08, 1.55, 0.08], [x, 0.83, -0.08], COLORS.wood);
  mesh(display, [1.15, 0.1, 0.1], [0, 1.52, -0.08], COLORS.gold);
  const instrumentSphere = (at, scale, color) => {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.78 }));
    const geometry = new THREE.SphereGeometry(0.22, 8, 6); geometry.scale(...scale); ownedGeometries.add(geometry);
    const item = new THREE.Mesh(geometry, materials.get(color)); item.position.set(...at); item.castShadow = true; item.receiveShadow = true; display.add(item);
  };
  instrumentSphere([-0.28, 0.48, 0.12], [0.92, 1.2, 0.42], '#a9673e');
  mesh(display, [0.075, 0.76, 0.08], [-0.28, 1.12, 0.12], '#714b35');
  mesh(display, [0.14, 0.16, 0.1], [-0.28, 1.55, 0.12], COLORS.gold);
  mesh(display, [0.012, 1.0, 0.015], [-0.31, 0.94, 0.205], '#e8d5ad');
  mesh(display, [0.012, 1.0, 0.015], [-0.25, 0.94, 0.205], '#e8d5ad');
  instrumentSphere([0.24, 0.55, 0.12], [0.72, 1.05, 0.36], '#9d4d49');
  mesh(display, [0.06, 0.64, 0.065], [0.24, 1.15, 0.12], '#523a32');
  mesh(display, [0.12, 0.13, 0.08], [0.24, 1.53, 0.12], COLORS.gold);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 8), materials.get(COLORS.blue));
  drum.rotation.x = Math.PI / 2; drum.position.set(0.46, 0.52, 0.22); drum.castShadow = true; display.add(drum); ownedGeometries.add(drum.geometry);
  mergeStaticMeshes(display);
  const displayCollider = { minX: display.position.x - 0.64, maxX: display.position.x + 0.64, minY: 0, maxY: 1.7, minZ: display.position.z - 0.28, maxZ: display.position.z + 0.28 };
  colliders.push(displayCollider); cameraBlockers.push(displayCollider);
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
        const geometry = (item.geometry.index ? item.geometry.toNonIndexed() : item.geometry.clone()).applyMatrix4(item.matrix);
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

import * as THREE from 'three';
import { WINDOW_HIT_LIMIT } from './state.js';
import { LOCAL_POINTS, LOCAL_WINDOWS, START, WALL, WINDOW_DEPTH } from './layout.js';
import { SAFETY_ZONE, blockedBySafetyZone } from './safety-zone.js';
import { canMoveWithHose } from './hose-length.js';
import { advanceReel, REEL_RADIUS, woundTurns } from './reel-motion.js';

// Дальность клавиши E у стойки рукава. С рукавом в руках игрок удаляется от стойки не дальше HOSE_REACH (hose-length.js).
const HOSE_USE_DISTANCE = 2.8;

const mat = (color, roughness = 0.86) => new THREE.MeshStandardMaterial({ color, roughness, flatShading: true });
const shared = {
  grass: mat('#9bbb78'), paleGrass: mat('#b4cf8c'), path: mat('#e8d4a3'), cream: mat('#f5e9cd'),
  red: mat('#d65a42'), darkRed: mat('#a94436'), green: mat('#438266'), darkGreen: mat('#285f4c'),
  wood: mat('#b57d4f'), blue: mat('#6ca4ac'), navy: mat('#345568'), charcoal: mat('#374344'),
  white: mat('#fff4d9'), black: mat('#273232'), yellow: mat('#f0c85f'), orange: mat('#f3913e'),
};

function box(parent, x, y, z, sx, sy, sz, material, castShadow = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function cylinder(parent, x, y, z, radiusTop, radiusBottom, height, material, sides = 8, rotation = null) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, sides), material);
  mesh.position.set(x, y, z);
  if (rotation) mesh.rotation.set(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function sphere(parent, x, y, z, sx, sy, sz, material, segments = 8) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, segments, Math.max(5, segments - 2)), material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addLabel(parent, text, color = '#315548') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff9e8';
  ctx.beginPath();
  ctx.roundRect(12, 10, 488, 108, 28);
  ctx.fill();
  ctx.strokeStyle = '#d9e2cc';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = '700 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 66, 450);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(3.4, 0.85, 1);
  parent.add(sprite);
  return sprite;
}

function addTree(parent, x, z, scale = 1) {
  const tree = new THREE.Group();
  tree.position.set(x, 0, z);
  tree.scale.setScalar(scale);
  cylinder(tree, 0, 0.7, 0, 0.18, 0.24, 1.4, shared.wood, 6);
  const greens = [mat('#6f9b68'), mat('#83aa70'), mat('#9fba76')];
  sphere(tree, 0, 1.8, 0, 0.82, 0.75, 0.78, greens[(Math.abs(Math.round(x * 7 + z)) % greens.length)], 7);
  sphere(tree, -0.35, 1.55, 0.12, 0.52, 0.48, 0.5, greens[1], 6);
  parent.add(tree);
}

function addStation(parent) {
  const building = new THREE.Group();
  building.position.set(-9, 0, -4);
  box(building, 0, 3, 0, 13, 6, 9, shared.cream);
  box(building, 0, 0.16, 4.56, 13.4, 0.32, 0.22, shared.darkRed);
  cylinder(building, 0, 6.45, 0, 0, 8.8, 4, shared.red, 4);
  // Gable trim and broad garage opening make the silhouette readable at a distance.
  box(building, -3.3, 2.4, 4.62, 5.1, 4.65, 0.2, shared.darkRed);
  box(building, -3.3, 2.4, 4.76, 4.55, 4.1, 0.18, shared.navy);
  box(building, -3.3, 2.4, 4.88, 4.15, 3.7, 0.08, mat('#526d70'));
  for (let i = 0; i < 4; i++) box(building, -5.05 + i * 1.16, 2.4, 4.96, 0.07, 3.45, 0.05, mat('#a9b8a2'));
  box(building, 2.25, 2.65, 4.63, 3.15, 4.15, 0.22, shared.green);
  box(building, 2.25, 2.65, 4.78, 2.62, 3.7, 0.12, shared.blue);
  box(building, 2.25, 2.65, 4.87, 0.12, 3.65, 0.06, shared.white);
  box(building, 2.25, 2.65, 4.87, 2.58, 0.12, 0.06, shared.white);
  box(building, 0, 6.18, 4.72, 4.4, 0.75, 0.28, shared.white);
  const sign = addLabel(building, 'ПОЖАРНАЯ ЧАСТЬ', '#a94436');
  sign.position.set(0, 6.2, 4.92);
  // Flat roof details and small warm windows.
  for (const x of [-5.1, 5.1]) {
    box(building, x, 4.05, 4.63, 1.2, 1.15, 0.22, shared.yellow);
    box(building, x, 4.05, 4.76, 0.12, 1.1, 0.05, shared.cream);
    box(building, x, 4.05, 4.76, 1.1, 0.12, 0.05, shared.cream);
  }
  parent.add(building);
}

function addFireTruck(parent) {
  const truck = new THREE.Group();
  truck.position.set(5.7, 0, -4.4);
  box(truck, 0, 1.0, 0, 5.1, 1.25, 2.25, shared.red);
  box(truck, -1.25, 2.05, 0, 2.45, 1.55, 2.18, shared.darkRed);
  box(truck, -1.22, 2.12, 1.13, 1.72, 0.86, 0.08, shared.blue);
  box(truck, -1.22, 2.12, -1.13, 1.72, 0.86, 0.08, shared.blue);
  box(truck, 1.12, 1.1, 0, 1.25, 0.9, 2.18, mat('#e77550'));
  box(truck, 0.1, 1.75, 0, 2.25, 0.2, 0.62, shared.cream);
  box(truck, 0.1, 1.94, 0, 2.1, 0.12, 0.36, shared.yellow);
  for (const x of [-1.55, 1.4]) for (const z of [-1.16, 1.16]) {
    const wheel = cylinder(truck, x, 0.62, z, 0.55, 0.55, 0.32, shared.black, 10, { z: Math.PI / 2 });
    wheel.castShadow = true;
    cylinder(truck, x, 0.62, z + (z > 0 ? 0.18 : -0.18), 0.23, 0.23, 0.035, shared.yellow, 8, { z: Math.PI / 2 });
  }
  for (const x of [-2.1, -0.35]) sphere(truck, x, 1.05, 1.18, 0.2, 0.16, 0.08, shared.yellow, 7);
  // A simple roof ladder, built from local geometry.
  box(truck, 0.9, 2.05, 0, 2.6, 0.13, 0.16, shared.white);
  box(truck, 0.9, 2.22, -0.47, 2.6, 0.07, 0.09, shared.white);
  box(truck, 0.9, 2.22, 0.47, 2.6, 0.07, 0.09, shared.white);
  for (let i = 0; i < 7; i++) box(truck, -0.25 + i * 0.38, 2.22, 0, 0.07, 0.07, 0.92, shared.white);
  parent.add(truck);
}

function createPerson({ name, outfit, helmet = false, player = false }) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const torso = sphere(body, 0, 1.05, 0, 0.43, 0.59, 0.3, outfit, 8);
  // Руки вынесены в отдельные группы: с рукавом в руках они тянутся к хвату (см. updateHoseAim).
  const arms = [-1, 1].map((side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.52, 1.4, 0);
    body.add(shoulder);
    const sleeve = cylinder(shoulder, 0, -0.45, 0, 0.15, 0.14, 0.9, outfit, 7);
    const stripe = cylinder(shoulder, 0, -0.62, 0, 0.155, 0.155, 0.13, shared.yellow, 7);
    const hand = sphere(shoulder, 0, -0.92, 0, 0.16, 0.17, 0.16, shared.charcoal, 7);
    stripe.visible = hand.visible = false;
    return { shoulder, sleeve, stripe, hand };
  });
  root.userData.arms = arms;
  cylinder(body, -0.2, 0.35, 0, 0.16, 0.18, 0.78, shared.navy, 7, { z: 0.04 });
  cylinder(body, 0.2, 0.35, 0, 0.16, 0.18, 0.78, shared.navy, 7, { z: -0.04 });
  sphere(body, 0, 1.95, 0.03, 0.48, 0.48, 0.43, mat('#efc89e'), 9);
  sphere(body, -0.16, 2.02, 0.405, 0.045, 0.05, 0.035, shared.black, 6);
  sphere(body, 0.16, 2.02, 0.405, 0.045, 0.05, 0.035, shared.black, 6);
  sphere(body, 0, 1.88, 0.445, 0.07, 0.04, 0.025, mat('#ba705c'), 6);
  if (helmet) {
    sphere(body, 0, 2.35, 0, 0.56, 0.18, 0.5, shared.red, 8);
    box(body, 0, 2.25, 0.17, 0.73, 0.08, 0.46, shared.red);
    box(body, 0, 2.22, 0.4, 0.24, 0.11, 0.07, shared.yellow);
  }
  if (player) {
    // Экипировка: пояс и защитные брюки появляются вместе с каской.
    const uniform = new THREE.Group();
    box(uniform, 0, 0.94, 0.02, 0.77, 0.12, 0.58, shared.yellow);
    for (const x of [-0.2, 0.2]) {
      cylinder(uniform, x, 0.18, 0.05, 0.19, 0.2, 0.36, shared.black, 7);
      box(uniform, x, 0.1, 0.13, 0.38, 0.2, 0.48, shared.black);
    }
    body.add(uniform);
    root.userData.uniform = uniform;
    root.userData.torso = torso;
    uniform.visible = false;
    const helmetGroup = new THREE.Group();
    sphere(helmetGroup, 0, 2.35, 0, 0.56, 0.18, 0.5, shared.red, 8);
    box(helmetGroup, 0, 2.25, 0.17, 0.73, 0.08, 0.46, shared.darkRed);
    box(helmetGroup, 0, 2.25, 0.42, 0.22, 0.12, 0.07, shared.yellow);
    body.add(helmetGroup);
    root.userData.helmet = helmetGroup;
    helmetGroup.visible = false;
  }
  if (name) {
    const nameTag = addLabel(root, name, '#315548');
    nameTag.position.set(0, 3.18, 0);
    nameTag.scale.set(2.5, 0.62, 1);
  }
  root.userData.body = body;
  return root;
}

function createMannequin() {
  const root = new THREE.Group();
  sphere(root, 0, 0.32, 0, 0.45, 0.22, 0.9, mat('#d2aa78'), 7);
  sphere(root, 0, 0.48, 0.78, 0.28, 0.26, 0.28, mat('#e0bd91'), 7);
  cylinder(root, -0.27, 0.23, -0.68, 0.12, 0.14, 0.9, shared.navy, 6, { x: Math.PI / 2, z: -0.2 });
  cylinder(root, 0.27, 0.23, -0.68, 0.12, 0.14, 0.9, shared.navy, 6, { x: Math.PI / 2, z: 0.2 });
  cylinder(root, -0.57, 0.2, 0.3, 0.1, 0.12, 0.9, mat('#d2aa78'), 6, { x: Math.PI / 2, z: 0.3 });
  cylinder(root, 0.57, 0.2, 0.3, 0.1, 0.12, 0.9, mat('#d2aa78'), 6, { x: Math.PI / 2, z: -0.3 });
  return root;
}

// Игровая площадка (земля 90×90) ограничена этим расстоянием от начала локальных координат.
export const WALK_LIMIT = 43;

function disposeModel(root) {
  root.traverse((node) => {
    node.geometry?.dispose();
    const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    for (const material of materials) {
      if (Object.values(shared).includes(material)) continue;
      material.map?.dispose();
      material.dispose();
    }
  });
}

export function createFirefighterScene({ container, onPrompt, onAction, onNotice, onHoseMode, onTarget = () => {}, onPosition = () => {} }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#cfe5df');
  scene.fog = new THREE.Fog('#cfe5df', 38, 95);

  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 120);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', 'Игровая сцена пожарной части. Кликните, чтобы управлять камерой.');
  container.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight('#f4fff0', '#789276', 2.15));
  const sun = new THREE.DirectionalLight('#fff4d7', 2.8);
  sun.position.set(-12, 24, 13);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), shared.grass);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.12;
  ground.receiveShadow = true;
  scene.add(ground);
  // Decorative field patches soften the open training yard.
  for (const [x, z, w, d] of [[-16, 6, 4, 7], [14, -1, 5, 8], [-13, 14, 5, 4], [13, 14, 6, 5]]) {
    const patch = new THREE.Mesh(new THREE.CircleGeometry(1, 10), shared.paleGrass);
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(x, -0.08, z);
    patch.scale.set(w, d, 1);
    patch.receiveShadow = true;
    scene.add(patch);
  }

  // Paths are local to this preview and do not define world/chunk coordinates.
  box(scene, -4.3, -0.015, 2.2, 3.5, 0.08, 8.6, shared.path, false);
  box(scene, 0.25, -0.012, 7.0, 6.4, 0.08, 3.0, shared.path, false);
  box(scene, 8.0, -0.01, 7.6, 3.4, 0.08, 7.0, shared.path, false);
  addStation(scene);
  addFireTruck(scene);

  // A few compact bushes frame the yard without narrowing the route.
  for (const [x, z] of [[-15, -12], [12, -12], [-15, 19], [15, 19], [-13, 10], [14, 2]]) {
    sphere(scene, x, 0.45, z, 1.15, 0.62, 0.85, shared.green, 7);
    sphere(scene, x + 0.45, 0.65, z + 0.18, 0.62, 0.55, 0.58, shared.paleGrass, 7);
  }
  for (const [x, z, scale] of [[-19, -15, 1.3], [19, -13, 1.15], [-19, 19, 1], [18, 22, 1.2], [0, -21, 1.3]]) addTree(scene, x, z, scale);

  const player = createPerson({ outfit: shared.green, player: true });
  player.position.set(START.x, 0, START.z);
  scene.add(player);
  const remotePlayers = new Map();
  const npc = createPerson({ name: 'Маруся Громова', outfit: shared.darkRed, helmet: true });
  npc.position.set(LOCAL_POINTS.npc.x, 0, LOCAL_POINTS.npc.z);
  scene.add(npc);
  const locker = new THREE.Group();
  locker.position.set(LOCAL_POINTS.locker.x, 0, LOCAL_POINTS.locker.z);
  box(locker, 0, 1.25, 0, 1.45, 2.5, 0.95, shared.blue);
  box(locker, 0, 1.25, 0.52, 1.32, 2.36, 0.09, mat('#77aab0'));
  box(locker, 0, 1.85, 0.59, 0.26, 0.38, 0.08, shared.yellow);
  box(locker, -0.38, 0.9, 0.59, 0.45, 0.08, 0.08, shared.white);
  box(locker, 0.15, 0.9, 0.59, 0.45, 0.08, 0.08, shared.white);
  addLabel(locker, 'ЭКИПИРОВКА', '#315548').position.set(0, 2.95, 0.2);
  scene.add(locker);

  // Учебная стена: четыре окна с безобидным условным огнём, каждое тушится независимо.
  // Центры окон берутся из layout.js — их же проверяет сервер.
  const targetBase = new THREE.Group();
  targetBase.position.set(WALL.x, 0, WALL.z);
  box(targetBase, 0, 3.5, 0, 6.8, 7, 0.55, shared.cream);
  box(targetBase, 0, 7.05, 0, 7.2, 0.3, 0.8, shared.red);
  const flameOrange = new THREE.MeshStandardMaterial({ color: '#f48638', emissive: '#bd4b1e', emissiveIntensity: 0.32, roughness: 0.7, flatShading: true });
  const flameYellow = new THREE.MeshStandardMaterial({ color: '#ffd16a', emissive: '#bf671c', emissiveIntensity: 0.22, roughness: 0.7, flatShading: true });
  const flameParts = [];
  const windows = LOCAL_WINDOWS.map((center, index) => {
    const x = center.x - WALL.x;
    const y = center.y;
    box(targetBase, x, y, WINDOW_DEPTH - 0.08, 2.2, 2.1, 0.12, shared.wood);
    const pane = box(targetBase, x, y, WINDOW_DEPTH, 1.9, 1.8, 0.08, shared.charcoal);
    pane.userData.windowIndex = index;
    const flames = new THREE.Group();
    flames.position.set(x, y - 0.78, WINDOW_DEPTH + 0.12);
    for (let i = 0; i < 4; i++) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.25, 1 + (i % 2) * 0.35, 5), i % 2 ? flameOrange : flameYellow);
      flame.position.set(-0.65 + i * 0.43, 0.56, 0);
      flames.add(flame);
      flameParts.push(flame);
    }
    targetBase.add(flames);
    return { pane, flames };
  });
  addLabel(targetBase, 'УЧЕБНАЯ СТЕНА', '#a04d36').position.set(0, 7.8, 0.35);
  scene.add(targetBase);

  // Ограничительная линия перед стеной. Приподнятая геометрия не мерцает на дорожках и земле.
  for (let i = 0; i < 16; i++) {
    box(scene, SAFETY_ZONE.minX + (i + 0.5) * 0.5, 0.045, SAFETY_ZONE.maxZ, 0.5, 0.05, 0.46, i % 2 ? shared.black : shared.yellow, false);
  }
  for (let i = 0; i < 10; i++) {
    for (const x of [SAFETY_ZONE.minX, SAFETY_ZONE.maxX]) {
      box(scene, x, 0.045, SAFETY_ZONE.maxZ - (i + 0.5) * 0.51, 0.32, 0.05, 0.51, i % 2 ? shared.black : shared.yellow, false);
    }
  }
  for (let i = 0; i < 16; i++) box(scene, SAFETY_ZONE.minX + (i + 0.5) * 0.5, 0.045, SAFETY_ZONE.minZ, 0.5, 0.05, 0.32, i % 2 ? shared.black : shared.yellow, false);
  const warning = addLabel(scene, 'НЕ ПЕРЕСЕКАТЬ', '#a94436');
  warning.position.set(WALL.x, 0.65, SAFETY_ZONE.maxZ + 0.05);

  const hoseStand = new THREE.Group();
  hoseStand.position.set(LOCAL_POINTS.hose.x, 0, LOCAL_POINTS.hose.z);
  box(hoseStand, 0, 0.55, 0, 0.85, 1.1, 0.78, shared.darkGreen);
  // Катушка: рукав в руках разматывает витки, возвращение к стойке наматывает обратно (reel-motion.js).
  const reel = new THREE.Group();
  reel.position.set(0, 1.2, 0.28);
  hoseStand.add(reel);
  cylinder(reel, 0, 0, 0, 0.3, 0.3, 1.04, shared.darkGreen, 10, { x: Math.PI / 2 });
  for (const z of [-0.55, 0.55]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.055, 7, 20), shared.charcoal);
    rim.position.z = z;
    reel.add(rim);
    for (const angle of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
      const spoke = box(reel, 0, 0, z, 1.2, 0.07, 0.07, shared.cream);
      spoke.rotation.z = angle;
    }
  }
  cylinder(reel, 0, 0, 0, 0.17, 0.17, 1.2, shared.cream, 8, { x: Math.PI / 2 });
  const nozzle = box(hoseStand, 0.48, 0.86, 0.42, 0.7, 0.18, 0.2, shared.charcoal);
  nozzle.rotation.y = -0.35;
  addLabel(hoseStand, 'УЧЕБНЫЙ РУКАВ', '#315548').position.set(0, 2.0, 0);
  scene.add(hoseStand);
  const heldHose = new THREE.Group();
  heldHose.position.set(0.25, 1.18, 0.48);
  cylinder(heldHose, 0, 0, 0.35, 0.19, 0.19, 1.2, shared.charcoal, 8, { x: Math.PI / 2 });
  cylinder(heldHose, 0, 0, 1.03, 0.24, 0.16, 0.3, shared.blue, 8, { x: Math.PI / 2 });
  cylinder(heldHose, 0, 0, -0.45, 0.16, 0.19, 0.5, shared.orange, 8, { x: Math.PI / 2 });
  player.userData.body.add(heldHose);
  heldHose.visible = false;

  // Фиксированный набор экземпляров: геометрия при движении не пересоздаётся.
  const hoseSegments = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.13, 1, 7), shared.orange, 24);
  hoseSegments.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  hoseSegments.frustumCulled = false;
  hoseSegments.visible = false;
  scene.add(hoseSegments);
  const coilSegments = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.13, 1, 7), shared.orange, 96);
  coilSegments.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  coilSegments.frustumCulled = false;
  reel.add(coilSegments);
  const hoseCurve = new THREE.CatmullRomCurve3(Array.from({ length: 7 }, () => new THREE.Vector3()));
  const hoseStart = new THREE.Vector3();
  const hoseEnd = new THREE.Vector3();
  const hosePrevious = new THREE.Vector3();
  const hoseNext = new THREE.Vector3();
  const hoseDirection = new THREE.Vector3();
  const hoseDummy = new THREE.Object3D();
  const hoseAxis = new THREE.Vector3(0, 1, 0);
  const reelCenter = new THREE.Vector3();
  let reelAngle = 0;
  let previousHoseLength = null;

  function setSegment(instances, index, start, end) {
    hoseDirection.subVectors(end, start);
    const length = hoseDirection.length();
    hoseDummy.position.copy(start).add(end).multiplyScalar(0.5);
    if (length > 0) hoseDummy.quaternion.setFromUnitVectors(hoseAxis, hoseDirection.multiplyScalar(1 / length));
    hoseDummy.scale.set(1, length + 0.03, 1);
    hoseDummy.updateMatrix();
    instances.setMatrixAt(index, hoseDummy.matrix);
  }

  function updateCoil() {
    reel.rotation.z = reelAngle;
    const turns = woundTurns(reelAngle);
    const exitAngle = Math.PI / 2 - reelAngle;
    const point = (t, result) => {
      const angle = exitAngle + (1 - t) * turns * Math.PI * 2;
      return result.set(REEL_RADIUS * Math.cos(angle), REEL_RADIUS * Math.sin(angle), -0.45 + t * 0.9);
    };
    point(0, hosePrevious);
    for (let i = 0; i < coilSegments.count; i++) {
      point((i + 1) / coilSegments.count, hoseNext);
      setSegment(coilSegments, i, hosePrevious, hoseNext);
      hosePrevious.copy(hoseNext);
    }
    coilSegments.instanceMatrix.needsUpdate = true;
  }
  updateCoil();

  function updateHose() {
    heldHose.localToWorld(hoseEnd.set(0, 0, -0.7));
    hoseStand.localToWorld(reelCenter.set(0, 1.2, 0.28));
    const hoseLength = reelCenter.distanceTo(hoseEnd);
    // Видимый моток ограничен правдоподобным числом витков даже после многих подъёмов рукава.
    reelAngle = THREE.MathUtils.clamp(advanceReel(reelAngle, previousHoseLength, hoseLength), -Math.PI * 7, Math.PI * 5);
    previousHoseLength = hoseLength;
    updateCoil();
    // Спираль выходит с верхнего края катушки; первая касательная направлена вправо.
    hoseStart.copy(reelCenter).add(new THREE.Vector3(0, REEL_RADIUS, 0.45));
    hoseCurve.points[0].copy(hoseStart);
    const pitch = 0.9 / (Math.PI * 2 * woundTurns(reelAngle) * REEL_RADIUS);
    hoseCurve.points[1].copy(hoseStart).add(new THREE.Vector3(0.45, 0, 0.45 * pitch));
    hoseCurve.points[2].copy(hoseStart).add(new THREE.Vector3(0.8, -0.15, 0.45));
    hoseCurve.points[6].copy(hoseEnd);
    for (let i = 3; i < 6; i++) {
      const point = hoseCurve.points[i].lerpVectors(hoseCurve.points[2], hoseEnd, (i - 2) / 4);
      point.y = 0.16;
    }
    hoseCurve.getPoint(0, hosePrevious);
    for (let i = 0; i < hoseSegments.count; i++) {
      hoseCurve.getPoint((i + 1) / hoseSegments.count, hoseNext);
      hoseNext.y = Math.max(0.14, hoseNext.y);
      setSegment(hoseSegments, i, hosePrevious, hoseNext);
      hosePrevious.copy(hoseNext);
    }
    hoseSegments.instanceMatrix.needsUpdate = true;
  }

  const mannequin = createMannequin();
  mannequin.position.set(LOCAL_POINTS.mannequin.x, 0, LOCAL_POINTS.mannequin.z);
  mannequin.rotation.y = -0.45;
  scene.add(mannequin);
  const carried = createMannequin();
  carried.scale.setScalar(0.55);
  carried.position.set(0, 1.2, 0.66);
  carried.rotation.set(0, 0, -Math.PI / 2.2);
  player.add(carried);
  carried.visible = false;
  addLabel(mannequin, 'УЧЕБНЫЙ МАНЕКЕН', '#315548').position.set(0, 1.7, 0);

  const safeZone = new THREE.Group();
  safeZone.position.set(LOCAL_POINTS.safe_zone.x, 0.01, LOCAL_POINTS.safe_zone.z);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.12, 7, 24), shared.darkGreen);
  ring.rotation.x = -Math.PI / 2;
  safeZone.add(ring);
  const marker = new THREE.Mesh(new THREE.CircleGeometry(1.3, 16), new THREE.MeshBasicMaterial({ color: '#a6cf83', transparent: true, opacity: 0.48, side: THREE.DoubleSide }));
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = -0.01;
  safeZone.add(marker);
  addLabel(safeZone, 'БЕЗОПАСНАЯ ЗОНА', '#315548').position.set(0, 2.1, 0);
  scene.add(safeZone);

  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 1, 8), new THREE.MeshBasicMaterial({ color: '#a2f6ff', transparent: true, opacity: 0.9 }));
  beam.visible = false;
  scene.add(beam);

  const blockers = [
    { minX: WALL.x - 3.5, maxX: WALL.x + 3.5, minZ: WALL.z - 0.4, maxZ: WALL.z + 0.4 },
    { minX: -15.8, maxX: -2.2, minZ: -8.8, maxZ: 1.1 },
    { minX: 3.1, maxX: 8.3, minZ: -6.8, maxZ: -2.0 },
    { minX: -8.7, maxX: -6.5, minZ: 1.3, maxZ: 3.2 },
    { minX: -1.0, maxX: 1.0, minZ: 6.4, maxZ: 8.4 },
  ];
  const keys = new Set();
  const clock = new THREE.Clock();
  const raycaster = new THREE.Raycaster();
  const centerScreen = new THREE.Vector2(0, 0);
  let state = null;
  let cameraYaw = 0;
  let cameraPitch = 0.1;
  let pointerLocked = false;
  let uiBlocked = false;
  let waterHeld = false;
  let hoseActive = false;
  let hitAccumulator = 0;
  let aim = null; // {end, index}: куда смотрит прицел, пока рукав в руках
  let targetWindow = null;
  let lastSafetyNotice = -Infinity;
  let prompt = '';
  let previousStage = '';
  let bobTime = 0;
  let frameId = 0;

  const pointOf = (object) => object.getWorldPosition(new THREE.Vector3());
  const distanceTo = (object) => {
    const p = pointOf(object);
    return Math.hypot(player.position.x - p.x, player.position.z - p.z);
  };
  const setPrompt = (text) => {
    if (prompt !== text) {
      prompt = text;
      onPrompt(text);
    }
  };
  const stopHose = () => {
    if (!hoseActive) return;
    hoseActive = false;
    waterHeld = false;
    beam.visible = false;
    heldHose.visible = false;
    hoseSegments.visible = false;
    previousHoseLength = null;
    nozzle.visible = true;
    aim = null;
    resetArms();
    setTarget(null);
    onHoseMode(false);
    if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
  };

  function resetArms() {
    player.userData.arms.forEach(({ shoulder, sleeve, stripe, hand }) => {
      shoulder.rotation.set(0, 0, 0);
      sleeve.scale.y = 1;
      sleeve.position.y = -0.45;
      stripe.position.y = -0.62;
      hand.position.y = -0.92;
    });
  }

  function setTarget(index) {
    if (targetWindow === index) return;
    targetWindow = index;
    onTarget(index);
  }

  function setTaskState(next) {
    state = next;
    const stage = state?.stage ?? 'not_started';
    if (stage !== previousStage && stage !== 'fire_drill') stopHose();
    previousStage = stage;
    npc.userData.body.rotation.z = 0;
    const helmet = player.userData.helmet;
    if (helmet) helmet.visible = Boolean(state?.equipped);
    const equipped = Boolean(state?.equipped);
    player.userData.uniform.visible = equipped;
    player.userData.torso.material = equipped ? shared.red : shared.green;
    player.userData.arms.forEach(({ sleeve, stripe, hand }) => {
      sleeve.material = equipped ? shared.red : shared.green;
      stripe.visible = hand.visible = equipped;
    });
    // Состояние окон приходит с сервера (task_state): огонь гаснет и уменьшается по числу подтверждённых попаданий.
    windows.forEach(({ flames }, index) => {
      const hits = state?.windows?.[index] ?? 0;
      flames.visible = stage === 'fire_drill' && hits < WINDOW_HIT_LIMIT;
      flames.scale.setScalar(1 - (0.7 * hits) / WINDOW_HIT_LIMIT);
    });
    mannequin.visible = stage === 'rescue' && !state?.carryingMannequin && !state?.mannequinDelivered;
    carried.visible = Boolean(state?.carryingMannequin);
    if (stage === 'completed') stopHose();
  }

  function updatePrompt() {
    if (!state || uiBlocked) return setPrompt('');
    let text = '';
    if (distanceTo(npc) < LOCAL_POINTS.npc.radius) {
      text = state.stage === 'debrief' ? 'Обсудить итог тренировки' : 'Поговорить с Марусей';
    }
    if (state.stage === 'equipping' && distanceTo(locker) < LOCAL_POINTS.locker.radius) text = 'Надеть экипировку';
    if (state.stage === 'fire_drill' && distanceTo(hoseStand) < HOSE_USE_DISTANCE) text = hoseActive ? 'Завершить упражнение с рукавом' : 'Взять учебный рукав';
    if (state.stage === 'rescue') {
      if (!state.carryingMannequin && distanceTo(mannequin) < LOCAL_POINTS.mannequin.radius) text = 'Поднять манекен';
      else if (state.carryingMannequin && distanceTo(safeZone) < LOCAL_POINTS.safe_zone.radius) text = 'Доставить манекен';
    }
    setPrompt(text ? `E · ${text}` : '');
  }

  function interact() {
    if (!state || uiBlocked) return;
    if (distanceTo(npc) < LOCAL_POINTS.npc.radius) {
      onAction('open_chat'); // разговор с Марусей: действия этапа — кнопки в панели, подтверждает их сервер
      return;
    }
    if (distanceTo(locker) < LOCAL_POINTS.locker.radius) {
      if (state.stage === 'equipping') onAction('equip');
      else onNotice(state.equipped ? 'Экипировка уже надета.' : 'Сначала поговорите с Марусей.');
      return;
    }
    if (distanceTo(hoseStand) < HOSE_USE_DISTANCE) {
      if (state.stage !== 'fire_drill') return onNotice('Сначала выполните предыдущий этап.');
      hoseActive = !hoseActive;
      waterHeld = false;
      heldHose.visible = hoseActive;
      hoseSegments.visible = hoseActive;
      previousHoseLength = null;
      nozzle.visible = !hoseActive;
      if (!hoseActive) {
        aim = null;
        resetArms();
        setTarget(null);
      }
      onHoseMode(hoseActive);
      if (hoseActive) {
        onNotice('Учебный рукав готов. Наведите прицел на окно и удерживайте левую кнопку мыши.');
        renderer.domElement.requestPointerLock?.();
      } else {
        beam.visible = false;
        onNotice('Упражнение приостановлено. Нажмите E у рукава, чтобы продолжить.');
        if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      }
      return;
    }
    if (state.stage === 'rescue') {
      if (!state.carryingMannequin && distanceTo(mannequin) < LOCAL_POINTS.mannequin.radius) return onAction('pickup_mannequin');
      if (state.carryingMannequin && distanceTo(safeZone) < LOCAL_POINTS.safe_zone.radius) return onAction('deliver_mannequin');
    }
  }

  const isTyping = (event) => Boolean(event.target?.closest?.('input, textarea, select, [contenteditable="true"]'));

  function onKeyDown(event) {
    if (isTyping(event)) return;
    if (event.code === 'Escape') {
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      return;
    }
    if (event.code === 'KeyE') {
      if (!event.repeat) interact();
      return;
    }
    if (uiBlocked) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
      keys.add(event.code);
      if (event.code !== 'ShiftLeft' && event.code !== 'ShiftRight') event.preventDefault();
    }
  }
  function onKeyUp(event) { keys.delete(event.code); }
  function onMouseMove(event) {
    if (!pointerLocked || uiBlocked) return;
    cameraYaw -= event.movementX * 0.0024;
    cameraPitch = THREE.MathUtils.clamp(cameraPitch + event.movementY * 0.0018, -0.8, 0.55);
  }
  function onPointerLockChange() {
    pointerLocked = document.pointerLockElement === renderer.domElement;
    if (!pointerLocked) waterHeld = false;
  }
  function onPointerDown(event) { if (event.button === 0 && hoseActive && !uiBlocked) waterHeld = true; }
  function onPointerUp(event) { if (event.button === 0) waterHeld = false; }
  function onBlur() { keys.clear(); waterHeld = false; }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onPointerDown);
  window.addEventListener('mouseup', onPointerUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  renderer.domElement.addEventListener('click', () => {
    if (!uiBlocked && !document.pointerLockElement) renderer.domElement.requestPointerLock?.();
  });

  const resizeObserver = new ResizeObserver(() => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  });
  resizeObserver.observe(container);

  function isBlocked(x, z) {
    const radius = 0.4;
    if (Math.abs(x) > WALK_LIMIT || Math.abs(z) > WALK_LIMIT) return true;
    return blockers.some((b) => x + radius > b.minX && x - radius < b.maxX && z + radius > b.minZ && z - radius < b.maxZ);
  }

  function movePlayer(delta) {
    if (uiBlocked) return;
    const forwardInput = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
    const sideInput = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
    const input = new THREE.Vector2(sideInput, forwardInput);
    if (input.lengthSq() < 0.01) {
      player.userData.body.position.y = 0;
      return;
    }
    input.normalize();
    const forwardX = -Math.sin(cameraYaw);
    const forwardZ = -Math.cos(cameraYaw);
    const rightX = Math.cos(cameraYaw);
    const rightZ = -Math.sin(cameraYaw);
    const dx = (rightX * input.x + forwardX * input.y);
    const dz = (rightZ * input.x + forwardZ * input.y);
    const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? 7.2 : 4.5;
    const nextX = player.position.x + dx * speed * delta;
    const nextZ = player.position.z + dz * speed * delta;
    // Линия безопасности закрывает зону перед стеной на время тушения; уже оказавшийся в ней игрок может выйти.
    const insideNow = blockedBySafetyZone(state?.stage, player.position.x, player.position.z);
    const blockedSafety = (x, z) => {
      if (insideNow || !blockedBySafetyZone(state?.stage, x, z)) return false;
      if (clock.elapsedTime - lastSafetyNotice > 2.8) {
        lastSafetyNotice = clock.elapsedTime;
        onNotice('Не пересекайте ограничительную линию!');
      }
      return true;
    };
    const canMove = (x, z) => canMoveWithHose(hoseActive, player.position, { x, z }, hoseStand.position);
    if (!isBlocked(nextX, player.position.z) && !blockedSafety(nextX, player.position.z) && canMove(nextX, player.position.z)) player.position.x = nextX;
    if (!isBlocked(player.position.x, nextZ) && !blockedSafety(player.position.x, nextZ) && canMove(player.position.x, nextZ)) player.position.z = nextZ;
    if (!hoseActive) player.rotation.y = Math.atan2(dx, dz);
    bobTime += delta * (speed > 5 ? 15 : 10);
    player.userData.body.position.y = Math.abs(Math.sin(bobTime)) * 0.055;
  }

  function updateCamera() {
    const target = new THREE.Vector3(
      player.position.x - Math.sin(cameraYaw) * 2.4,
      1.45 - cameraPitch * 8,
      player.position.z - Math.cos(cameraYaw) * 2.4,
    );
    const distance = 8.6;
    const height = 3.8;
    camera.position.set(
      player.position.x + Math.sin(cameraYaw) * distance + Math.cos(cameraYaw) * 1.8,
      height,
      player.position.z + Math.cos(cameraYaw) * distance - Math.sin(cameraYaw) * 1.8,
    );
    camera.lookAt(target);
  }

  function addRemotePlayer(id, name) {
    const known = remotePlayers.get(id);
    if (known) return known;
    const model = createPerson({ name: name || `Игрок ${id}`, outfit: shared.blue });
    model.visible = false;
    scene.add(model);
    const remote = { model, x: 0, z: 0, heading: 0, moving: false, ready: false };
    remotePlayers.set(id, remote);
    return remote;
  }

  function removeRemotePlayer(id) {
    const remote = remotePlayers.get(id);
    if (!remote) return;
    scene.remove(remote.model);
    disposeModel(remote.model);
    remotePlayers.delete(id);
  }

  function clearRemotePlayers() {
    for (const id of [...remotePlayers.keys()]) removeRemotePlayer(id);
  }

  /** @param {Array<{id: number, x: number, z: number, heading: number, moving: boolean}>} list локальные координаты */
  function updateRemotePlayers(list) {
    for (const { id, x, z, heading, moving } of list) {
      const remote = addRemotePlayer(id);
      remote.x = x;
      remote.z = z;
      remote.heading = heading;
      remote.moving = moving;
      if (!remote.ready) {
        remote.model.position.set(x, 0, z);
        remote.model.rotation.y = heading;
        remote.model.visible = true;
        remote.ready = true;
      }
    }
  }

  /** Можно ли стоять в точке (локальные координаты). */
  function isWalkable(x, z) { return !isBlocked(x, z); }

  function setLocalPosition({ x, z, heading = 0 }) {
    player.position.set(x, 0, z);
    player.rotation.y = heading;
    cameraYaw = heading - Math.PI; // камера сзади игрока: модель смотрит вдоль направления движения
    keys.clear();
  }

  function localPosition() {
    const moving = keys.has('KeyW') || keys.has('KeyA') || keys.has('KeyS') || keys.has('KeyD');
    const fast = moving && (keys.has('ShiftLeft') || keys.has('ShiftRight'));
    return {
      x: player.position.x,
      z: player.position.z,
      heading: player.rotation.y,
      anim: fast ? 2 : moving ? 1 : 0,
    };
  }

  /**
   * Прицел из центра экрана по окнам. Пока рукав в руках, персонаж смотрит туда же, куда прицел:
   * сервер проверяет направление по ry из pos, поэтому поворот применяется до отправки позиции в кадре.
   */
  function updateHoseAim() {
    if (!hoseActive || state?.stage !== 'fire_drill') {
      aim = null;
      hitAccumulator = 0;
      setTarget(null);
      return;
    }
    updateCamera();
    raycaster.setFromCamera(centerScreen, camera);
    const hits = raycaster.intersectObjects(windows.map((window) => window.pane));
    const end = hits.length ? hits[0].point : raycaster.ray.at(18, new THREE.Vector3());
    player.rotation.y = Math.atan2(raycaster.ray.direction.x, raycaster.ray.direction.z);
    player.updateMatrixWorld(true);
    heldHose.lookAt(end);
    player.updateMatrixWorld(true);
    player.userData.arms.forEach(({ shoulder, sleeve, stripe, hand }, i) => {
      const grip = heldHose.localToWorld(new THREE.Vector3(i ? 0.14 : -0.14, 0, i ? 0.05 : 0.55));
      const localGrip = shoulder.parent.worldToLocal(grip).sub(shoulder.position);
      const length = localGrip.length();
      shoulder.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), localGrip.normalize());
      sleeve.scale.y = length / 0.9;
      sleeve.position.y = -length / 2;
      stripe.position.y = -length * 0.7;
      hand.position.y = -length;
    });
    player.updateMatrixWorld(true);
    updateHose();
    const index = hits.length ? hits[0].object.userData.windowIndex : null;
    if (index !== targetWindow) hitAccumulator = 0;
    setTarget(index);
    aim = { end, index };
  }

  /** Струя и серия попаданий: каждое отправляется на сервер, засчитывает его только task_state. */
  function updateWater(delta) {
    if (!aim || !waterHeld || uiBlocked) {
      beam.visible = false;
      hitAccumulator = 0;
      return;
    }
    const start = heldHose.localToWorld(new THREE.Vector3(0, 0, 1.18));
    const direction = aim.end.clone().sub(start);
    beam.position.copy(start).addScaledVector(direction, 0.5);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    beam.scale.set(1, direction.length(), 1);
    beam.visible = true;
    const { index } = aim;
    if (index === null || (state?.windows?.[index] ?? 0) >= WINDOW_HIT_LIMIT) {
      hitAccumulator = 0;
      return;
    }
    hitAccumulator += delta;
    if (hitAccumulator >= 0.16) {
      hitAccumulator = 0;
      onAction('window_hit', index);
    }
  }

  function animate() {
    frameId = requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.05);
    movePlayer(delta);
    updateHoseAim();
    const position = localPosition();
    onPosition(position);
    for (const remote of remotePlayers.values()) {
      if (!remote.ready) continue;
      const amount = Math.min(1, delta * 12);
      remote.model.position.x += (remote.x - remote.model.position.x) * amount;
      remote.model.position.z += (remote.z - remote.model.position.z) * amount;
      const angle = ((((remote.heading - remote.model.rotation.y) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      remote.model.rotation.y += angle * amount;
      remote.model.userData.body.position.y = remote.moving ? Math.abs(Math.sin(clock.elapsedTime * 11)) * 0.055 : 0;
    }
    const idle = Math.sin(clock.elapsedTime * 1.5) * 0.035;
    npc.userData.body.position.y = idle;
    flameParts.forEach((flame, index) => {
      const pulse = 1 + Math.sin(clock.elapsedTime * 5 + index * 1.3) * 0.08;
      flame.scale.set(1, pulse, 1);
    });
    if (!aim) updateCamera();
    updatePrompt();
    updateWater(delta);
    renderer.render(scene, camera);
  }
  animate();

  return {
    setTaskState,
    addRemotePlayer,
    removeRemotePlayer,
    clearRemotePlayers,
    updateRemotePlayers,
    isWalkable,
    setLocalPosition,
    localPosition,
    setUiBlocked(value) {
      uiBlocked = Boolean(value);
      if (!uiBlocked) return;
      keys.clear();
      waterHeld = false;
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
    },
    dispose() {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('mouseup', onPointerUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      clearRemotePlayers();
      hoseSegments.geometry.dispose();
      coilSegments.geometry.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}

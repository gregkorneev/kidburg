// Окружение пожарной части: земля, холмы, покрытия, деревья, кусты, трава, цветы, фонари, ограды.
// Всё повторяющееся собрано в InstancedMesh с общей геометрией: вся сцена декора — несколько десятков вызовов отрисовки.
// Размещение задано планом двора (yard-plan.js); случайные мелочи (трава, камни, цветы) — детерминированная выборка.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from '../../engine/art/palette.js';
import { applyWindShadows, windMaterial, treeProfile, padWindBounds, updateWind } from '../../engine/art/wind.js';
import { roundedBox, softBlobTexture, stdMat, texturedMat, worldUVBox } from '../../engine/art/materials.js';
import { BENCHES, BUSHES, CONES, FENCES, LAMPS, PAVED, PLANTERS, TREES, insideRect, isYardClear, KEEP_CLEAR } from './yard-plan.js';

function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const compose = (pos, rot = [0, 0, 0], scale = [1, 1, 1]) => _m.compose(_v.set(...pos), _q.setFromEuler(_e.set(...rot)), _s.set(...scale)).clone();

/** Цветная деталь для слияния: геометрия + позиция, цвет и затемнение к основанию («нарисованный» AO). */
function bake(geometry, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], color, bottom = 0.72 }) {
  const g = (geometry.index ? geometry.toNonIndexed() : geometry.clone()).applyMatrix4(compose(pos, rot, scale));
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
  g.computeBoundingBox();
  const { min, max } = g.boundingBox;
  const position = g.attributes.position;
  const base = new THREE.Color(color);
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const t = (position.getY(i) - min.y) / Math.max(1e-6, max.y - min.y);
    const k = bottom + (1.06 - bottom) * t;
    colors.set([base.r * k, base.g * k, base.b * k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

const mergeBaked = (items) => mergeGeometries(items.map(([geometry, options]) => bake(geometry, options)), false);

const unit = {
  sphere: new THREE.SphereGeometry(1, 10, 7),
  sphereLow: new THREE.SphereGeometry(1, 8, 6),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 8),
  cone: new THREE.ConeGeometry(1, 1, 8),
  box: new THREE.BoxGeometry(1, 1, 1),
};

function treeGeometry(type) {
  const leaf = PALETTE.leaf;
  if (type === 'pine') {
    const items = [[unit.cyl, { pos: [0, 0.6, 0], scale: [0.17, 1.2, 0.17], color: PALETTE.bark, bottom: 0.8 }]];
    [[1.55, 1.5, 1.2], [1.3, 1.35, 2.0], [1.02, 1.2, 2.7], [0.72, 1.1, 3.35]].forEach(([r, h, y], i) =>
      items.push([unit.cone, { pos: [0, y + h / 2, 0], scale: [r, h, r], color: PALETTE.leafPine[i % 2], bottom: 0.62 }]));
    return mergeBaked(items);
  }
  if (type === 'birch') {
    return mergeBaked([
      [unit.cyl, { pos: [0.05, 1.3, 0], rot: [0, 0, 0.04], scale: [0.12, 2.6, 0.12], color: '#f1eadb', bottom: 0.85 }],
      [unit.sphere, { pos: [0, 3.0, 0], scale: [0.78, 0.9, 0.74], color: '#9bcb78', bottom: 0.72 }],
      [unit.sphere, { pos: [-0.45, 2.45, 0.1], scale: [0.55, 0.6, 0.52], color: '#86bd6f', bottom: 0.72 }],
      [unit.sphere, { pos: [0.42, 2.6, -0.12], scale: [0.52, 0.58, 0.5], color: '#a8d27f', bottom: 0.72 }],
    ]);
  }
  return mergeBaked([
    [unit.cyl, { pos: [0, 0.85, 0], scale: [0.22, 1.7, 0.22], color: PALETTE.bark, bottom: 0.8 }],
    [unit.sphere, { pos: [0, 2.55, 0], scale: [1.25, 1.05, 1.2], color: leaf[0], bottom: 0.66 }],
    [unit.sphere, { pos: [-0.78, 2.15, 0.28], scale: [0.85, 0.75, 0.8], color: leaf[1], bottom: 0.7 }],
    [unit.sphere, { pos: [0.8, 2.25, -0.2], scale: [0.9, 0.78, 0.82], color: leaf[2], bottom: 0.7 }],
    [unit.sphere, { pos: [0.1, 3.3, 0.1], scale: [0.78, 0.62, 0.74], color: leaf[3], bottom: 0.75 }],
  ]);
}

const bushGeometry = () => mergeBaked([
  [unit.sphereLow, { pos: [0, 0.4, 0], scale: [0.8, 0.52, 0.66], color: PALETTE.leaf[0], bottom: 0.62 }],
  [unit.sphereLow, { pos: [0.5, 0.34, 0.12], scale: [0.5, 0.4, 0.46], color: PALETTE.leaf[2], bottom: 0.66 }],
  [unit.sphereLow, { pos: [-0.46, 0.32, -0.1], scale: [0.5, 0.36, 0.46], color: PALETTE.leaf[1], bottom: 0.66 }],
]);

export function grassGeometry() {
  const positions = [];
  const colors = [];
  const indices = [];
  const segments = 4;
  for (let blade = 0; blade < 6; blade++) {
    const angle = (blade / 6) * Math.PI * 2 + (blade % 2) * 0.4;
    const length = 0.5 + (blade % 3) * 0.12;
    const lean = 0.18 + (blade % 3) * 0.1;
    const halfWidth = 0.035;
    const axisX = -Math.sin(angle);
    const axisZ = Math.cos(angle);
    const color = new THREE.Color(blade % 2 ? PALETTE.grassLight : PALETTE.grass);
    const base = positions.length / 3;
    for (let row = 0; row <= segments; row++) {
      const t = row / segments;
      const width = halfWidth * (1 - t * 0.86);
      const centerX = Math.cos(angle) * (0.07 + lean * t);
      const centerZ = Math.sin(angle) * (0.07 + lean * t);
      positions.push(centerX - axisX * width, length * t, centerZ - axisZ * width);
      positions.push(centerX + axisX * width, length * t, centerZ + axisZ * width);
      const shade = 0.58 + 0.42 * t;
      colors.push(color.r * shade, color.g * shade, color.b * shade, color.r * shade, color.g * shade, color.b * shade);
      if (row < segments) {
        const a = base + row * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        indices.push(a, c, b, b, c, d);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.userData.windSegments = segments;
  return geometry;
}

const lampGeometry = () => mergeBaked([
  [unit.cyl, { pos: [0, 0.08, 0], scale: [0.2, 0.16, 0.2], color: PALETTE.charcoal, bottom: 0.9 }],
  [unit.cyl, { pos: [0, 1.7, 0], scale: [0.065, 3.4, 0.065], color: PALETTE.greenDark, bottom: 0.85 }],
  [unit.cyl, { pos: [0.28, 3.42, 0], rot: [0, 0, Math.PI / 2], scale: [0.045, 0.62, 0.045], color: PALETTE.greenDark, bottom: 1 }],
  [unit.cone, { pos: [0.55, 3.48, 0], scale: [0.26, 0.2, 0.26], color: PALETTE.greenDark, bottom: 0.9 }],
]);

const benchGeometry = () => mergeBaked([
  [roundedBox(1.7, 0.1, 0.55, 0.04), { pos: [0, 0.5, 0], color: PALETTE.wood, bottom: 0.85 }],
  [roundedBox(1.7, 0.5, 0.09, 0.04), { pos: [0, 0.82, -0.25], rot: [-0.12, 0, 0], color: PALETTE.wood, bottom: 0.85 }],
  [roundedBox(0.1, 0.5, 0.5, 0.03), { pos: [-0.72, 0.25, 0], color: PALETTE.charcoal, bottom: 0.9 }],
  [roundedBox(0.1, 0.5, 0.5, 0.03), { pos: [0.72, 0.25, 0], color: PALETTE.charcoal, bottom: 0.9 }],
]);

const coneGeometry = () => mergeBaked([
  [roundedBox(0.5, 0.05, 0.5, 0.02), { pos: [0, 0.025, 0], color: PALETTE.charcoal, bottom: 1 }],
  [unit.cone, { pos: [0, 0.34, 0], scale: [0.2, 0.62, 0.2], color: PALETTE.orange, bottom: 0.85 }],
  [unit.cyl, { pos: [0, 0.3, 0], scale: [0.138, 0.1, 0.138], color: '#fffaf0', bottom: 1 }],
]);

const hydrantGeometry = () => mergeBaked([
  [unit.cyl, { pos: [0, 0.34, 0], scale: [0.2, 0.68, 0.2], color: PALETTE.red, bottom: 0.8 }],
  [unit.sphere, { pos: [0, 0.72, 0], scale: [0.23, 0.17, 0.23], color: PALETTE.red, bottom: 0.9 }],
  [unit.cyl, { pos: [0, 0.07, 0], scale: [0.26, 0.14, 0.26], color: PALETTE.redDark, bottom: 1 }],
  [unit.cyl, { pos: [0.22, 0.45, 0], rot: [0, 0, Math.PI / 2], scale: [0.09, 0.14, 0.09], color: PALETTE.yellow, bottom: 1 }],
  [unit.cyl, { pos: [-0.22, 0.45, 0], rot: [0, 0, Math.PI / 2], scale: [0.09, 0.14, 0.09], color: PALETTE.yellow, bottom: 1 }],
  [unit.cyl, { pos: [0, 0.88, 0], scale: [0.07, 0.08, 0.07], color: PALETTE.yellow, bottom: 1 }],
]);

function instanced(geometry, material, placements, { cast = false, receive = false, colors = null } = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, placements.length));
  placements.forEach((p, i) => {
    _m.compose(_v.set(p.x, p.y ?? 0, p.z), _q.setFromEuler(_e.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0)), _s.set(p.sx ?? p.s ?? 1, p.sy ?? p.s ?? 1, p.sz ?? p.s ?? 1));
    mesh.setMatrixAt(i, _m);
    if (colors) mesh.setColorAt(i, colors(p, i));
  });
  mesh.count = placements.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  applyWindShadows(mesh);
  mesh.computeBoundingSphere();
  return mesh;
}

const tint = (p, i) => new THREE.Color().setHSL(0.27 + ((i * 37) % 11) / 300, 0.06, 0.9 + ((i * 17) % 7) / 50);

function scatter(count, rand, area, accept) {
  const out = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 40) {
    const x = area.x0 + rand() * (area.x1 - area.x0);
    const z = area.z0 + rand() * (area.z1 - area.z0);
    if (accept(x, z)) out.push({ x, z });
  }
  return out;
}

function hills() {
  const rand = random(404);
  const items = [];
  for (let i = 0; i < 26; i++) {
    const angle = (i / 26) * Math.PI * 2 + rand() * 0.2;
    const far = i % 2;
    const radius = 62 + far * 26 + rand() * 12;
    const width = 20 + rand() * 18;
    const height = 6 + rand() * 7 + far * 5;
    items.push([unit.sphere, { pos: [Math.cos(angle) * radius, -height * 0.32, Math.sin(angle) * radius + 6], scale: [width, height, width * 0.8], color: far ? PALETTE.hillFar : PALETTE.hill, bottom: 0.85 }]);
  }
  return mergeBaked(items);
}

/**
 * @param {{detail?: number}} options detail 0..1 — доля мелких деталей (трава, цветы, дальний лес)
 * @returns {{group: THREE.Group, update(elapsed: number): void, setDetail(detail: number): void, dispose(): void}}
 */
export function createScenery({ detail = 0.7 } = {}) {
  const group = new THREE.Group();
  const own = []; // освобождаем только то, что создано здесь
  const track = (resource) => { own.push(resource); return resource; };
  const rand = random(1847);

  // Земля: текстура считается в метрах, поэтому не растягивается на огромной плоскости.
  const groundGeometry = track(new THREE.PlaneGeometry(420, 420).rotateX(-Math.PI / 2));
  const uv = groundGeometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 140, uv.getY(i) * 140);
  const ground = new THREE.Mesh(groundGeometry, texturedMat(PALETTE.grass, 'grass'));
  ground.receiveShadow = true;
  group.add(ground);

  const blobMap = softBlobTexture();
  if (blobMap) {
    const blobGeometry = track(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
    const makeBlob = (color, opacity) => track(new THREE.MeshBasicMaterial({ color, map: blobMap, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    const light = makeBlob(PALETTE.grassLight, 0.55);
    const dark = makeBlob(PALETTE.grassDark, 0.4);
    scatter(26, rand, { x0: -40, x1: 40, z0: -30, z1: 40 }, (x, z) => isYardClear(x, z, -1)).forEach(({ x, z }, i) => {
      const patch = new THREE.Mesh(blobGeometry, i % 3 ? light : dark);
      const size = 6 + rand() * 11;
      patch.position.set(x, 0.006 + i * 0.0003, z);
      patch.scale.set(size, 1, size * (0.6 + rand() * 0.5));
      patch.rotation.y = rand() * Math.PI;
      group.add(patch);
    });
  }

  group.add(new THREE.Mesh(track(hills()), track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }))));

  // Покрытия с бордюрами.
  const curbMaterial = stdMat(PALETTE.curb, { roughness: 0.8 });
  const paveMesh = (rect) => {
    const w = rect.x1 - rect.x0;
    const d = rect.z1 - rect.z0;
    const mesh = new THREE.Mesh(worldUVBox(w, 0.12, d, rect.kind === 'pavers' ? 2 : 3), texturedMat(rect.kind === 'pavers' ? PALETTE.paver : PALETTE.concrete, rect.kind === 'pavers' ? 'pavers' : 'concrete'));
    mesh.position.set((rect.x0 + rect.x1) / 2, rect.y - 0.06, (rect.z0 + rect.z1) / 2);
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  Object.values(PAVED).forEach(paveMesh);
  const curb = (x0, z0, x1, z1, y) => {
    const length = Math.hypot(x1 - x0, z1 - z0);
    const mesh = new THREE.Mesh(roundedBox(Math.abs(x1 - x0) > 0.01 ? length : 0.2, 0.2, Math.abs(z1 - z0) > 0.01 ? length : 0.2, 0.05), curbMaterial);
    mesh.position.set((x0 + x1) / 2, y + 0.04, (z0 + z1) / 2);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  };
  const { walkway, pad, apron, eastPath, truckPad } = PAVED;
  curb(walkway.x0 - 0.1, 7.5, walkway.x0 - 0.1, walkway.z1, walkway.y);
  curb(walkway.x1 + 0.1, 7.5, walkway.x1 + 0.1, walkway.z1, walkway.y);
  curb(apron.x0, apron.z1 + 0.1, walkway.x0 - 0.2, apron.z1 + 0.1, apron.y);
  curb(pad.x0, pad.z1 + 0.1, pad.x1, pad.z1 + 0.1, pad.y);
  curb(pad.x1 + 0.1, pad.z0, pad.x1 + 0.1, pad.z1, pad.y);
  curb(eastPath.x0 - 0.1, eastPath.z0, eastPath.x0 - 0.1, eastPath.z1, eastPath.y);
  curb(eastPath.x1 + 0.1, eastPath.z0, eastPath.x1 + 0.1, eastPath.z1, eastPath.y);
  curb(truckPad.x0, truckPad.z1 + 0.1, truckPad.x1, truckPad.z1 + 0.1, truckPad.y);
  // Разметка стоянки грузовика.
  const lineMaterial = stdMat(PALETTE.white, { roughness: 0.7 });
  for (const x of [truckPad.x0 + 0.2, truckPad.x1 - 0.2]) {
    const line = new THREE.Mesh(worldUVBox(0.12, 0.012, 5.4, 4), lineMaterial);
    line.position.set(x, truckPad.y + 0.004, -4.4);
    group.add(line);
  }

  // Деревья, кусты.
  const dynamic = []; // мелочи, количество которых зависит от качества: [{mesh, max}]
  for (const type of ['round', 'pine', 'birch']) {
    const items = TREES.filter((t) => t.type === type).map((t, i) => ({ x: t.x, z: t.z, s: t.s, ry: i * 1.7 }));
    if (items.length) group.add(instanced(padWindBounds(track(treeGeometry(type)), treeProfile(type)), windMaterial(treeProfile(type)), items, { cast: true, receive: true, colors: tint }));
  }
  const bushes = BUSHES.map((b, i) => ({ x: b.x, z: b.z, s: b.s, ry: i * 2.1 }));
  group.add(instanced(padWindBounds(track(bushGeometry()), 'bush'), windMaterial('bush'), bushes, { cast: true, receive: true, colors: tint }));

  // Дальний лес по кругу: объём и глубина вместо пустого горизонта.
  const forest = [];
  const forestRand = random(77);
  for (let i = 0; i < 46; i++) {
    const angle = (i / 46) * Math.PI * 2 + forestRand() * 0.12;
    const radius = 38 + forestRand() * 12;
    forest.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius + 8, s: 1.5 + forestRand() * 1.1, ry: forestRand() * 6, type: forestRand() > 0.45 ? 'pine' : 'round' });
  }
  for (const type of ['pine', 'round']) {
    const items = forest.filter((t) => t.type === type);
    const mesh = instanced(padWindBounds(track(treeGeometry(type)), treeProfile(type)), windMaterial(treeProfile(type)), items, { colors: tint });
    group.add(mesh);
    dynamic.push({ mesh, max: items.length, minDetail: 0.0, fraction: 1 });
  }

  // Трава, цветы, камни.
  const lawn = { x0: -36, x1: 36, z0: -22, z1: 36 };
  const grassAccept = (x, z) => isYardClear(x, z, 0.35) && !TREES.some((t) => Math.hypot(t.x - x, t.z - z) < 0.9);
  const tufts = scatter(1500, rand, lawn, grassAccept).map((p) => ({ ...p, ry: rand() * 6.28, s: 0.45 + rand() * 0.6 }));
  const grassMesh = instanced(padWindBounds(track(grassGeometry()), 'grass'), windMaterial('grass', { side: THREE.DoubleSide }), tufts, { colors: tint });
  group.add(grassMesh);
  dynamic.push({ mesh: grassMesh, max: tufts.length, fraction: 1 });

  const flowerGeometry = track(mergeBaked([
    [unit.cyl, { pos: [0, 0.16, 0], scale: [0.012, 0.32, 0.012], color: PALETTE.grassDark, bottom: 1 }],
    [unit.sphereLow, { pos: [0, 0.34, 0], scale: [0.085, 0.07, 0.085], color: '#ffffff', bottom: 0.95 }],
    [unit.sphereLow, { pos: [0, 0.37, 0], scale: [0.035, 0.03, 0.035], color: PALETTE.yellow, bottom: 1 }],
  ]));
  const flowers = [];
  const clusters = scatter(16, rand, { x0: -22, x1: 22, z0: -9, z1: 22 }, (x, z) => isYardClear(x, z, 0.8));
  clusters.forEach((c) => { for (let i = 0; i < 12; i++) flowers.push({ x: c.x + (rand() - 0.5) * 2, z: c.z + (rand() - 0.5) * 2, ry: rand() * 6, s: 0.8 + rand() * 0.6, c: Math.floor(rand() * PALETTE.flower.length) }); });
  const flowerMesh = instanced(padWindBounds(flowerGeometry, 'flower'), windMaterial('flower'), flowers, { colors: (p) => new THREE.Color(PALETTE.flower[p.c]) });
  group.add(flowerMesh);
  dynamic.push({ mesh: flowerMesh, max: flowers.length, fraction: 1 });

  const rocks = scatter(34, rand, lawn, (x, z) => isYardClear(x, z, 0.7)).map((p) => ({ ...p, y: 0.08, ry: rand() * 6, sx: 0.35 + rand() * 0.5, sy: 0.25 + rand() * 0.3, sz: 0.3 + rand() * 0.5 }));
  group.add(instanced(track(new THREE.DodecahedronGeometry(1, 0)), track(stdMat(PALETTE.rock[0], { roughness: 0.95, flatShading: true })), rocks, { cast: true, receive: true, colors: (p, i) => new THREE.Color(PALETTE.rock[i % 3]) }));

  // Фонари: тёплая лампа горит и днём, как маркер маршрута.
  const lamps = LAMPS.map((l) => ({ x: l.x, z: l.z, ry: l.x > 0 ? Math.PI : 0, s: 0.85 }));
  group.add(instanced(track(lampGeometry()), track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })), lamps, { cast: true }));
  const bulbs = lamps.map((l) => ({ x: l.x + (l.x > 0 ? -0.47 : 0.47), y: 2.88, z: l.z, sx: 0.15, sy: 0.1, sz: 0.15 }));
  group.add(instanced(track(new THREE.SphereGeometry(1, 10, 7)), track(new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#ffd77a', emissiveIntensity: 0.9 })), bulbs));

  group.add(instanced(track(benchGeometry()), track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })), BENCHES.map((b) => ({ x: b.x, z: b.z, ry: b.rotY })), { cast: true, receive: true }));
  group.add(instanced(track(coneGeometry()), track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 })), CONES, { cast: true }));
  group.add(instanced(track(hydrantGeometry()), track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 })), [{ x: -1.9, z: 5.2 }, { x: 11.6, z: 9.6 }], { cast: true }));

  // Клумбы-ящики с цветами у фасада и входа во двор.
  const planterGeometry = track(mergeBaked([
    [roundedBox(1.7, 0.5, 0.65, 0.07), { pos: [0, 0.25, 0], color: PALETTE.woodDark, bottom: 0.8 }],
    [unit.box, { pos: [0, 0.5, 0], scale: [1.5, 0.05, 0.46], color: '#6b4d3a', bottom: 1 }],
    [unit.sphereLow, { pos: [-0.5, 0.66, 0], scale: [0.3, 0.2, 0.26], color: PALETTE.leaf[1], bottom: 0.7 }],
    [unit.sphereLow, { pos: [0, 0.7, 0.02], scale: [0.34, 0.24, 0.28], color: PALETTE.leaf[0], bottom: 0.7 }],
    [unit.sphereLow, { pos: [0.5, 0.65, 0], scale: [0.3, 0.2, 0.26], color: PALETTE.leaf[2], bottom: 0.7 }],
    [unit.sphereLow, { pos: [-0.4, 0.82, 0.05], scale: [0.11, 0.1, 0.11], color: PALETTE.flower[0], bottom: 1 }],
    [unit.sphereLow, { pos: [0.1, 0.9, 0.08], scale: [0.12, 0.1, 0.12], color: PALETTE.flower[1], bottom: 1 }],
    [unit.sphereLow, { pos: [0.55, 0.8, 0.04], scale: [0.11, 0.1, 0.11], color: PALETTE.flower[3], bottom: 1 }],
  ]));
  group.add(instanced(planterGeometry, track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })), PLANTERS, { cast: true, receive: true }));

  // Забор: штакетник и перекладины, по одному InstancedMesh.
  const pickets = [];
  const rails = [];
  for (const f of FENCES) {
    const length = Math.hypot(f.x1 - f.x0, f.z1 - f.z0);
    const angle = Math.atan2(f.x1 - f.x0, f.z1 - f.z0);
    const n = Math.floor(length / 0.42);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pickets.push({ x: f.x0 + (f.x1 - f.x0) * t, y: 0.45, z: f.z0 + (f.z1 - f.z0) * t, ry: angle, sx: 0.14, sy: 0.9 + ((i * 7) % 3) * 0.04, sz: 0.04 });
    }
    for (const y of [0.3, 0.7]) rails.push({ x: (f.x0 + f.x1) / 2, y, z: (f.z0 + f.z1) / 2, ry: angle, sx: 0.05, sy: 0.07, sz: length });
  }
  const fenceMaterial = track(stdMat(PALETTE.trim, { roughness: 0.8 }));
  group.add(instanced(track(new THREE.BoxGeometry(1, 1, 1)), fenceMaterial, pickets, { cast: true, receive: true }));
  group.add(instanced(track(new THREE.BoxGeometry(1, 1, 1)), fenceMaterial, rails, { cast: true, receive: true }));

  const applyDetail = (value) => {
    for (const item of dynamic) item.mesh.count = Math.max(0, Math.round(item.max * Math.min(1, value * item.fraction)));
  };
  applyDetail(detail);

  return {
    group,
    update(elapsed) { updateWind(elapsed); },
    setDetail: applyDetail,
    dispose() {
      group.removeFromParent();
      for (const resource of own) resource.dispose?.();
      group.traverse((node) => { if (node.isInstancedMesh) node.dispose(); });
    },
  };
}

// Для теста плана двора.
export { insideRect, KEEP_CLEAR };

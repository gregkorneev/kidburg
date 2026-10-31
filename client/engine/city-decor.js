// Живой слой центра города: то, что нельзя «запечь» в общую геометрию префаба.
//  • вывески зданий (рамка + табличка с текстом, нарисованным на canvas);
//  • площадь: вода и струи фонтана (шейдеры), качающиеся цветы, кусты и деревья (InstancedMesh с ветром),
//    мощёные подъезды от площади к фасадам зданий.
// Декор создаётся вместе с чанком и целиком освобождается при выгрузке (dispose); общие геометрии и материалы
// помечены userData.shared и живут в кеше art/*. Сетевое состояние не затрагивается.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createSignPlate } from './art/labels.js';
import { sharedGeometry } from './art/materials.js';
import { createPrefabKit } from './art/prefab-kit.js';
import { QUALITY_PRESETS } from './art/quality.js';
import { TREE_BUILDERS, bush, flower } from './art/flora.js';
import { swayMaterial } from './art/wind.js';
import { createTileBuffer } from './city-plaza.js';
import { BUSHES, FOUNTAIN, PLANTS, PLAZA_RADIUS, PYLONS, ROUTES, SPOUTS, TREES } from './plaza-plan.js';

const BLOOM_COLORS = [0xf4b6c2, 0xfff0b8, 0xffffff, 0xffc27a, 0xc7b5f4];

/** Освобождает объект и всё, что у него не общее (геометрии, материалы, текстуры). */
export function disposeDecor(root) {
  root.traverse((o) => {
    if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose();
    const materials = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of materials) {
      if (m.userData?.shared) continue;
      m.map?.dispose();
      m.dispose();
    }
    if (o.isInstancedMesh) o.dispose();
  });
  root.removeFromParent();
}

/** Локальная точка префаба -> координаты группы чанка (учитывает поворот и масштаб инстанса). */
function placer(instance) {
  const c = Math.cos(instance.ry);
  const s = Math.sin(instance.ry);
  return (x, y, z) => [instance.x + (x * c + z * s) * instance.scale, instance.y + y * instance.scale, instance.z + (-x * s + z * c) * instance.scale];
}

const hash = (i) => {
  let h = Math.imul(i + 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// ── Вывески ────────────────────────────────────────────────────────────────

/** Фабрика декора для здания: каждая запись signs — {text, x, y, z, w, h, color, border, background}. */
export function createSignDecor(signs) {
  return ({ group, instance }) => {
    const place = placer(instance);
    const root = new THREE.Group();
    for (const sign of signs) {
      const plate = createSignPlate(sign.text, sign.w, sign.h, { color: sign.color, border: sign.border, background: sign.background });
      const [x, y, z] = place(sign.x, sign.y, sign.z);
      plate.position.set(x, y, z);
      plate.rotation.y = instance.ry;
      plate.scale.setScalar(instance.scale);
      root.add(plate);
    }
    group.add(root);
    return { dispose: () => disposeDecor(root) };
  };
}

// ── Площадь: вода и струи ──────────────────────────────────────────────────

const WATER_VERTEX = `
varying vec2 vXZ;
void main() {
  vXZ = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const WATER_FRAGMENT = `
uniform float uTime;
varying vec2 vXZ;
void main() {
  float r = length(vXZ);
  float w = sin(vXZ.x * 2.6 + uTime * 1.3) + sin(vXZ.y * 2.9 - uTime * 1.1) + sin((vXZ.x + vXZ.y) * 1.7 + uTime * 0.9) + sin(r * 5.0 - uTime * 1.6);
  float shore = smoothstep(0.0, 0.32, min(r - ${(FOUNTAIN.channel[0] - 0.02).toFixed(2)}, ${(FOUNTAIN.channel[1] + 0.02).toFixed(2)} - r));
  vec3 deep = vec3(0.06, 0.38, 0.52);
  vec3 shallow = vec3(0.24, 0.68, 0.78);
  vec3 col = mix(deep, shallow, 0.5 + 0.12 * w);
  col += smoothstep(2.0, 3.2, w) * 0.28;
  col = mix(vec3(0.85, 0.97, 1.0), col, 0.25 + 0.75 * shore);
  gl_FragColor = vec4(col, 0.86);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const JET_VERTEX = `
uniform float uTime;
uniform float uScale;
attribute vec3 aStart;
attribute vec3 aLand;
attribute vec3 aParams;
varying float vAlpha;
void main() {
  float u = fract(uTime * 0.55 + aParams.y);
  vec3 p = mix(aStart, aLand, u);
  p.y += 4.0 * aParams.x * u * (1.0 - u);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aParams.z * uScale / -mv.z, 2.0, 26.0);
  vAlpha = smoothstep(0.0, 0.08, u) * (1.0 - smoothstep(0.86, 1.0, u));
}`;

const JET_FRAGMENT = `
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(vec3(0.82, 0.96, 1.0), smoothstep(0.5, 0.15, d) * vAlpha * 0.9);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function createWater(center) {
  const geometry = new THREE.RingGeometry(FOUNTAIN.channel[0] - 0.05, FOUNTAIN.channel[1] + 0.06, 72, 3);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    vertexShader: WATER_VERTEX, fragmentShader: WATER_FRAGMENT, uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(center.x, center.y + FOUNTAIN.waterY, center.z);
  mesh.renderOrder = 2;
  return mesh;
}

/** Струи: частицы летят по параболе от форсунки или чаши пилона к воде канала. Порядок частиц позволяет резать по качеству. */
function createJets(center, place) {
  const jets = [];
  for (const p of PYLONS) {
    const land = Math.hypot(p.x, p.z) - 1.2;
    jets.push({ from: [p.x, 2.3, p.z], to: [(p.x / Math.hypot(p.x, p.z)) * land, FOUNTAIN.waterY, (p.z / Math.hypot(p.x, p.z)) * land], apex: 0.5, count: 16, size: 0.1 });
  }
  for (const s of SPOUTS) {
    const r = Math.hypot(s.x, s.z);
    jets.push({ from: [s.x, 0.26, s.z], to: [(s.x / r) * 3.55, FOUNTAIN.waterY, (s.z / r) * 3.55], apex: 0.62, count: 10, size: 0.075 });
  }
  const perJet = Math.max(...jets.map((j) => j.count));
  const total = jets.length * perJet;
  const start = new Float32Array(total * 3);
  const land = new Float32Array(total * 3);
  const params = new Float32Array(total * 3);
  let n = 0;
  // Порядок: сначала по одной частице каждой струи, потом по второй... — обрезка по drawRange равномерна.
  for (let k = 0; k < perJet; k++) {
    jets.forEach((jet, ji) => {
      if (k >= jet.count) return;
      const jitter = (hash(ji * 97 + k) - 0.5) * 0.14;
      const [fx, fy, fz] = place(jet.from[0] + jitter, jet.from[1], jet.from[2] + jitter);
      const [lx, ly, lz] = place(jet.to[0] + jitter * 2, jet.to[1], jet.to[2] - jitter * 2);
      start.set([fx, fy, fz], n * 3);
      land.set([lx, ly, lz], n * 3);
      params.set([jet.apex * (0.9 + hash(k * 13 + ji) * 0.3), k / jet.count + hash(ji) * 0.1, jet.size], n * 3);
      n++;
    });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); // фиктивный: число вершин
  geometry.setAttribute('aStart', new THREE.BufferAttribute(start.slice(0, n * 3), 3));
  geometry.setAttribute('aLand', new THREE.BufferAttribute(land.slice(0, n * 3), 3));
  geometry.setAttribute('aParams', new THREE.BufferAttribute(params.slice(0, n * 3), 3));
  const material = new THREE.ShaderMaterial({
    vertexShader: JET_VERTEX, fragmentShader: JET_FRAGMENT, uniforms: { uTime: { value: 0 }, uScale: { value: 600 } }, transparent: true, depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 3;
  points.userData.total = n;
  return points;
}

// ── Площадь: растения ──────────────────────────────────────────────────────

const plantGeometry = (key, fn) => sharedGeometry(`plaza-plant:${key}`, () => {
  const kit = createPrefabKit({ seed: 31 });
  fn(kit);
  return kit.build({ groundAO: null, underside: 1 });
});

function plantMeshes(place, instanceRy = 0) {
  const rotation = new THREE.Quaternion();
  const matrix = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const makers = [];
  const tally = (key, geometry, material, items, { cull = false } = {}) => {
    if (!items.length) return;
    const ordered = [...items].sort((a, b) => hash(a.x * 31 + a.z * 17) - hash(b.x * 31 + b.z * 17));
    const mesh = new THREE.InstancedMesh(geometry, material, ordered.length);
    ordered.forEach((item, i) => {
      const [x, y, z] = place(item.x, item.y ?? 0, item.z);
      rotation.setFromAxisAngle(up, item.ry ?? hash(i * 7 + ordered.length) * Math.PI * 2 + instanceRy);
      matrix.compose(pos.set(x, y, z), rotation, one.setScalar(item.s ?? 1));
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.full = ordered.length;
    mesh.userData.cull = cull;
    mesh.name = key;
    makers.push(mesh);
  };

  const flowerMat = swayMaterial(0.16);
  const bushMat = swayMaterial(0.05);
  BLOOM_COLORS.forEach((color, ci) => {
    tally(`flowers-${ci}`, plantGeometry(`flower:${ci}`, (k) => flower(k, 0, 0, 0, color, 1)), flowerMat, PLANTS.filter((p) => p.kind === 'flower' && p.color === ci), { cull: true });
  });
  tally('bushes-beds', plantGeometry('bush', (k) => bush(k, 0, 0, 1, 0)), bushMat, [
    ...PLANTS.filter((p) => p.kind === 'bush'),
    ...BUSHES,
  ], { cull: true });
  const treeMat = swayMaterial(0.014);
  for (const type of Object.keys(TREE_BUILDERS)) {
    tally(`trees-${type}`, sharedGeometry(`plaza-tree:${type}`, TREE_BUILDERS[type]), treeMat, TREES.filter((t) => t.type === type));
  }
  return makers;
}

// ── Подъезды: мощёные дорожки от площади к фасадам зданий ──────────────────

const APRON = { lane: [0xf6e4b7, 0xf0dcaa, 0xfbeccb], edge: 0xd6b985, grout: 0xc6b794, curb: 0xf3ead4 };

function buildAprons() {
  const kit = createPrefabKit({ seed: 44, tint: 0.02 });
  const tiles = createTileBuffer();
  const mix = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
  for (const route of ROUTES) {
    const ux = Math.cos(route.angle);
    const uz = Math.sin(route.angle);
    const u0 = PLAZA_RADIUS - 0.5;
    const u1 = route.length + 0.5;
    const cx = ux * (u0 + u1) / 2;
    const cz = uz * (u0 + u1) / 2;
    kit.box(u1 - u0, 0.088, 4.5, cx, 0.044, cz, APRON.grout, { ry: -route.angle, tinted: false });
    for (const side of [-1, 1]) {
      kit.box(u1 - u0, 0.2, 0.24, cx - uz * side * 2.2, 0.1, cz + ux * side * 2.2, APRON.curb, { ry: -route.angle });
    }
    const rows = Math.floor((u1 - u0) / 0.95);
    const step = (u1 - u0) / rows;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < 4; col++) {
        const ua = u0 + row * step + 0.025;
        const ub = u0 + (row + 1) * step - 0.025;
        const va = -2 + col + 0.025;
        const vb = -2 + col + 0.975;
        const at = (u, v) => [ux * u - uz * v, uz * u + ux * v];
        const nearDoor = route.length - (u0 + row * step) < 2.8;
        let color = col === 0 || col === 3 ? APRON.edge : APRON.lane[(row * 2 + col) % 3];
        if (nearDoor && col > 0 && col < 3) color = mix(route.color, 0xfff3d6, 0.55);
        tiles.quad(at(ua, va), at(ub, va), at(ub, vb), at(ua, vb), 0.1 + (hash(row * 5 + col) - 0.5) * 0.006, color, 0.97 + hash(row + col * 11) * 0.06);
      }
    }
  }
  const solid = kit.build({ groundAO: null, underside: 1 });
  const paving = tiles.build();
  const geometry = mergeGeometries([solid, paving], false);
  solid.dispose();
  paving.dispose();
  return geometry;
}

// ── Площадь целиком ────────────────────────────────────────────────────────

export function decoratePlaza({ group, instance, quality = 'medium' }) {
  const place = placer(instance);
  const root = new THREE.Group();
  const [px, py, pz] = place(0, 0, 0);

  const water = createWater({ x: px, y: py, z: pz });
  const jets = createJets({ x: px, y: py, z: pz }, place);
  const plants = plantMeshes(place, instance.ry);

  const aprons = new THREE.Mesh(buildAprons(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }));
  aprons.position.set(px, py, pz);
  aprons.rotation.y = instance.ry;
  aprons.receiveShadow = true;

  root.add(water, jets, aprons, ...plants);
  group.add(root);

  const total = jets.userData.total;
  const apply = (level) => {
    const preset = QUALITY_PRESETS[level] ?? QUALITY_PRESETS.medium;
    jets.geometry.setDrawRange(0, Math.max(12, Math.round(total * (0.25 + 0.75 * preset.detail))));
    jets.material.uniforms.uScale.value = 600 * Math.min(globalThis.devicePixelRatio || 1, preset.pixelRatio);
    for (const mesh of plants) {
      if (mesh.userData.cull) mesh.count = Math.max(1, Math.round(mesh.userData.full * (0.4 + 0.6 * preset.detail)));
    }
  };
  apply(quality);

  return {
    update(dt, elapsed) {
      water.material.uniforms.uTime.value = elapsed;
      jets.material.uniforms.uTime.value = elapsed;
    },
    setQuality: apply,
    dispose: () => disposeDecor(root),
  };
}

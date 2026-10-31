// Круглая центральная площадь: фонтан по центру, мелкая плитка,
// больше зелени, клумб, цветов и лавочек.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function buildCityPlazaGeometry() {
  const parts = [];

  const C = {
    base: 0xdcc9a3,
    tile1: 0xf3e5c8,
    tile2: 0xe9d5ae,
    tile3: 0xe2c89c,
    border: 0xc9b187,
    stone: 0xf4ecdd,
    stoneDark: 0xb7b1a5,
    water: 0x77c9de,
    waterLight: 0xb9eff8,
    greenery: 0x4e8d62,
    greenDark: 0x3f724f,
    greenLight: 0x7fb07b,
    soil: 0x8f6948,
    wood: 0xa86c47,
    woodDark: 0x78492f,
    metal: 0x2f5a60,
    gold: 0xf1d46a,
    pink: 0xf3a2c3,
    red: 0xe57a88,
    purple: 0xb99ae0,
    white: 0xfff7ea,
    yellow: 0xf5d86e,
  };

  function compose(x = 0, y = 0, z = 0, rotY = 0, rotX = 0, rotZ = 0, scale = [1, 1, 1]) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ));
    return new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      q,
      new THREE.Vector3(scale[0], scale[1], scale[2]),
    );
  }

  function place(parent, x = 0, y = 0, z = 0, rotY = 0, rotX = 0, rotZ = 0, scale = [1, 1, 1]) {
    return new THREE.Matrix4().multiplyMatrices(parent, compose(x, y, z, rotY, rotX, rotZ, scale));
  }

  function addColored(geometry, color, matrix = null) {
    let g = geometry;
    if (g.index) {
      const nonIndexed = g.toNonIndexed();
      g.dispose();
      g = nonIndexed;
    }
    if (matrix) g.applyMatrix4(matrix);

    const col = new THREE.Color(color);
    const data = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < data.length; i += 3) {
      data[i] = col.r;
      data[i + 1] = col.g;
      data[i + 2] = col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(data, 3));
    parts.push(g);
  }

  function addBox(w, h, d, color, matrix) {
    addColored(new THREE.BoxGeometry(w, h, d), color, matrix);
  }

  function addCylinder(rt, rb, h, segments, color, matrix) {
    addColored(new THREE.CylinderGeometry(rt, rb, h, segments), color, matrix);
  }

  function addSphere(r, ws, hs, color, matrix) {
    addColored(new THREE.SphereGeometry(r, ws, hs), color, matrix);
  }

  function addTorus(radius, tube, radialSegments, tubularSegments, color, matrix) {
    const g = new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments);
    g.rotateX(Math.PI / 2);
    addColored(g, color, matrix);
  }

  function insideCircle(x, z, radius) {
    return x * x + z * z <= radius * radius;
  }

  // ---------------------------------------------------------------------------
  // 1. Основание круглой площади
  // ---------------------------------------------------------------------------
  const plazaRadius = 21.2;
  const tileRadius = 20.4;

  addCylinder(plazaRadius + 0.55, plazaRadius + 0.55, 0.08, 72, C.border, compose(0, 0.04, 0));
  addCylinder(plazaRadius, plazaRadius, 0.03, 72, C.base, compose(0, 0.075, 0));
  addTorus(plazaRadius + 0.12, 0.18, 8, 72, C.border, compose(0, 0.16, 0));

  // Мелкая плитка внутри круглой площади
  const tileStep = 0.91;
  const tileSize = 0.82;
  for (let x = -20.0; x <= 20.0; x += tileStep) {
    for (let z = -20.0; z <= 20.0; z += tileStep) {
      if (!insideCircle(x, z, tileRadius)) continue;
      const gx = Math.round((x + 20) / tileStep);
      const gz = Math.round((z + 20) / tileStep);
      const mod = (gx + gz) % 6;
      const color = mod === 0 ? C.tile3 : (mod % 2 === 0 ? C.tile1 : C.tile2);
      addBox(tileSize, 0.02, tileSize, color, compose(x, 0.105, z));
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Фонтан строго по центру
  // ---------------------------------------------------------------------------
  addCylinder(3.35, 3.45, 0.46, 40, C.stoneDark, compose(0, 0.28, 0));
  addCylinder(3.00, 3.00, 0.12, 40, C.water, compose(0, 0.54, 0));
  addTorus(3.20, 0.18, 8, 48, C.stone, compose(0, 0.60, 0));

  addCylinder(1.28, 1.50, 0.62, 24, C.stone, compose(0, 0.90, 0));
  addCylinder(1.55, 1.62, 0.18, 24, C.stone, compose(0, 1.22, 0));
  addCylinder(0.30, 0.40, 1.35, 18, C.stone, compose(0, 1.95, 0));
  addCylinder(0.84, 0.92, 0.16, 24, C.waterLight, compose(0, 2.66, 0));
  addTorus(0.82, 0.10, 8, 32, C.stone, compose(0, 2.72, 0));
  addSphere(0.24, 8, 6, C.waterLight, compose(0, 3.01, 0, 0, 0, 0, [0.8, 1.4, 0.8]));

  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const x = Math.cos(a) * 1.65;
    const z = Math.sin(a) * 1.65;
    addSphere(0.12, 7, 5, C.waterLight, compose(x, 1.34, z, 0, 0, 0, [0.8, 1.8, 0.8]));
    addSphere(0.10, 7, 5, C.waterLight, compose(x * 0.72, 1.86, z * 0.72));
  }

  // ---------------------------------------------------------------------------
  // 3. Внутренние круглые клумбы вокруг фонтана
  // ---------------------------------------------------------------------------
  function flower(parent, x, y, z, petalColor, scale = 1) {
    addCylinder(0.04 * scale, 0.05 * scale, 0.42 * scale, 5, C.greenery, place(parent, x, y + 0.2 * scale, z));
    addSphere(0.12 * scale, 7, 5, C.greenLight, place(parent, x - 0.10 * scale, y + 0.18 * scale, z, 0, 0, 0, [1.2, 0.55, 0.8]));
    addSphere(0.12 * scale, 7, 5, C.greenLight, place(parent, x + 0.10 * scale, y + 0.30 * scale, z, 0, 0, 0, [1.2, 0.55, 0.8]));
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      addSphere(
        0.13 * scale, 7, 5, petalColor,
        place(parent, x + Math.cos(a) * 0.16 * scale, y + 0.53 * scale + Math.sin(a) * 0.08 * scale, z, 0, 0, 0, [0.95, 0.95, 0.65])
      );
    }
    addSphere(0.08 * scale, 7, 5, C.yellow, place(parent, x, y + 0.53 * scale, z));
  }

  function shrub(parent, x, y, z, scale = 1) {
    addCylinder(0.06 * scale, 0.08 * scale, 0.30 * scale, 6, C.woodDark, place(parent, x, y + 0.12 * scale, z));
    addSphere(0.24 * scale, 8, 6, C.greenery, place(parent, x - 0.10 * scale, y + 0.38 * scale, z));
    addSphere(0.22 * scale, 8, 6, C.greenLight, place(parent, x + 0.10 * scale, y + 0.42 * scale, z + 0.05 * scale));
    addSphere(0.20 * scale, 8, 6, C.greenDark, place(parent, x, y + 0.52 * scale, z - 0.08 * scale));
  }

  function roundBed(angle) {
    const r = 8.4;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const g = compose(x, 0, z);
    addCylinder(1.10, 1.10, 0.28, 20, C.stone, place(g, 0, 0.18, 0));
    addCylinder(0.86, 0.86, 0.10, 20, C.soil, place(g, 0, 0.38, 0));
    shrub(g, -0.25, 0.38, -0.10, 0.9);
    shrub(g, 0.25, 0.38, 0.10, 0.85);
    flower(g, -0.05, 0.40, 0.32, C.pink, 0.75);
    flower(g, 0.22, 0.40, -0.28, C.purple, 0.7);
    flower(g, -0.30, 0.40, 0.02, C.white, 0.7);
  }

  for (const angle of [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]) {
    roundBed(angle);
  }

  // ---------------------------------------------------------------------------
  // 4. Внешние клумбы по кругу
  // ---------------------------------------------------------------------------
  function outerFlowerBed(angle) {
    const r = 17.0;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const g = compose(x, 0, z, angle);

    addBox(4.20, 0.30, 2.00, C.stone, place(g, 0, 0.18, 0));
    addBox(3.80, 0.12, 1.60, C.soil, place(g, 0, 0.38, 0));

    const palette = [C.pink, C.white, C.purple, C.red];
    for (let i = 0; i < 7; i++) {
      const px = -1.35 + i * 0.45;
      const pz = i % 2 === 0 ? -0.28 : 0.28;
      flower(g, px, 0.42, pz, palette[i % palette.length], 0.70);
    }

    shrub(g, -1.55, 0.40, 0, 0.72);
    shrub(g, 1.55, 0.40, 0, 0.72);
  }

  for (let i = 0; i < 8; i++) {
    outerFlowerBed((i / 8) * Math.PI * 2);
  }

  // ---------------------------------------------------------------------------
  // 5. Лавочки по кругу
  // ---------------------------------------------------------------------------
  function bench(angle) {
    const r = 14.4;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const g = compose(x, 0, z, angle);

    addBox(3.00, 0.16, 0.86, C.wood, place(g, 0, 0.74, 0));
    addBox(3.00, 0.68, 0.16, C.wood, place(g, 0, 1.18, -0.34));

    for (const dx of [-1.15, 1.15]) {
      addBox(0.16, 0.72, 0.66, C.metal, place(g, dx, 0.37, 0));
      addBox(0.18, 0.76, 0.18, C.metal, place(g, dx, 1.04, -0.36));
    }
  }

  for (let i = 0; i < 8; i++) {
    bench((i / 8) * Math.PI * 2 + Math.PI / 8);
  }

  // ---------------------------------------------------------------------------
  // 6. Фонари по внешнему кольцу
  // ---------------------------------------------------------------------------
  function lamp(angle) {
    const r = 19.2;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const g = compose(x, 0, z);

    addCylinder(0.34, 0.43, 0.27, 8, C.metal, place(g, 0, 0.20, 0));
    addCylinder(0.11, 0.16, 3.35, 8, C.metal, place(g, 0, 1.94, 0));
    addCylinder(0.30, 0.20, 0.16, 8, C.metal, place(g, 0, 3.70, 0));
    addSphere(0.34, 8, 6, C.gold, place(g, 0, 4.08, 0, 0, 0, 0, [0.85, 1.05, 0.85]));
    addCylinder(0.23, 0.30, 0.14, 8, C.metal, place(g, 0, 4.46, 0));
  }

  for (let i = 0; i < 8; i++) {
    lamp((i / 8) * Math.PI * 2);
  }

  // ---------------------------------------------------------------------------
  // Сборка
  // ---------------------------------------------------------------------------
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();

  if (!geometry) throw new Error('Не удалось объединить геометрию круглой площади');

  geometry.computeVertexNormals();
  return geometry;
}

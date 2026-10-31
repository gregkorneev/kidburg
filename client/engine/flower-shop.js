import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function buildFlowerShopGeometry() {
  const parts = [];

  const C = {
    wall: 0xdfe7d7,
    trim: 0xf5f2e8,
    roof: 0x8b4a46,
    roofDark: 0x5f2d2a,
    glass: 0x9ec3cf,
    frame: 0x7b9a82,
    door: 0x6d8f76,
    doorDark: 0x496251,
    base: 0xbdb6a7,
    sign: 0xf4efe4,
    signBorder: 0x7fa084,
    awning: 0xe8c7d1,
    awningStripe: 0xf7f3ea,
    planter: 0x7a5a3a,
    leaf: 0x4f8b59,
    petalPink: 0xe99ab5,
    petalYellow: 0xf0cd67,
    potDark: 0x64482f,
    shadow: 0xc9c3b4,
  };

  const colorize = (geometry, color) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const c = new THREE.Color(color);
    const count = g.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  };

  const add = (geometry, color, {
    tx = 0, ty = 0, tz = 0,
    rx = 0, ry = 0, rz = 0,
  } = {}) => {
    if (rx) geometry.rotateX(rx);
    if (ry) geometry.rotateY(ry);
    if (rz) geometry.rotateZ(rz);
    geometry.translate(tx, ty, tz);
    parts.push(colorize(geometry, color));
  };

  const box = (w, h, d, x, y, z, color) => {
    add(new THREE.BoxGeometry(w, h, d), color, { tx: x, ty: y, tz: z });
  };

  const cylinder = (rt, rb, h, seg, x, y, z, color, rot = {}) => {
    add(new THREE.CylinderGeometry(rt, rb, h, seg), color, { ...rot, tx: x, ty: y, tz: z });
  };

  const sphere = (r, x, y, z, color, scale = [1, 1, 1]) => {
    const g = new THREE.SphereGeometry(r, 16, 12);
    g.scale(scale[0], scale[1], scale[2]);
    add(g, color, { tx: x, ty: y, tz: z });
  };

  const addWindow = (x, y, z, w = 2.1, h = 2.0, d = 0.12) => {
    box(w, h, d, x, y, z, C.glass);
    box(w + 0.18, 0.12, d + 0.02, x, y + h / 2 - 0.06, z + 0.01, C.trim);
    box(w + 0.18, 0.12, d + 0.02, x, y - h / 2 + 0.06, z + 0.01, C.trim);
    box(0.12, h + 0.06, d + 0.02, x - w / 2 + 0.06, y, z + 0.01, C.trim);
    box(0.12, h + 0.06, d + 0.02, x + w / 2 - 0.06, y, z + 0.01, C.trim);
    box(0.08, h, d + 0.03, x, y, z + 0.02, C.trim);
    box(w, 0.08, d + 0.03, x, y, z + 0.02, C.trim);
    box(w + 0.28, 0.12, 0.28, x, y - h / 2 - 0.12, z + 0.03, C.frame);
  };

  const addDisplayWindow = (x, y, z, w = 4.2, h = 2.9, d = 0.14) => {
    box(w, h, d, x, y, z, C.glass);
    box(w + 0.18, 0.16, d + 0.03, x, y + h / 2 - 0.08, z + 0.01, C.trim);
    box(w + 0.18, 0.16, d + 0.03, x, y - h / 2 + 0.08, z + 0.01, C.trim);
    box(0.16, h + 0.12, d + 0.03, x - w / 2 + 0.08, y, z + 0.01, C.trim);
    box(0.16, h + 0.12, d + 0.03, x + w / 2 - 0.08, y, z + 0.01, C.trim);
    box(0.10, h, d + 0.04, x, y, z + 0.02, C.trim);
    box(w, 0.10, d + 0.04, x, y, z + 0.02, C.trim);
    box(w + 0.24, 0.16, 0.24, x, y - h / 2 - 0.16, z + 0.03, C.frame);
  };

  const addAwning = (x, y, z, width = 4.5) => {
    box(width, 0.18, 0.9, x, y, z, C.awning);
    const stripes = 8;
    const stripeW = width / stripes;
    for (let i = 0; i < stripes; i++) {
      if (i % 2 === 0) {
        const sx = x - width / 2 + stripeW * i + stripeW / 2;
        box(stripeW * 0.92, 0.19, 0.92, sx, y + 0.01, z + 0.01, C.awningStripe);
      }
    }
    const scallops = 6;
    for (let i = 0; i < scallops; i++) {
      const sx = x - width / 2 + (i + 0.5) * (width / scallops);
      sphere(0.16, sx, y - 0.18, z + 0.38, C.awning, [1.0, 0.65, 0.8]);
    }
    box(width + 0.1, 0.08, 0.16, x, y + 0.14, z - 0.36, C.frame);
  };

  const addPlanter = (x, y, z) => {
    box(0.55, 0.45, 0.55, x, y, z, C.planter);
    box(0.42, 0.18, 0.42, x, y + 0.24, z, C.potDark);

    const stems = [-0.10, 0, 0.10];
    for (const dx of stems) {
      box(0.04, 0.42, 0.04, x + dx, y + 0.42, z, C.leaf);
      sphere(0.08, x + dx - 0.06, y + 0.48, z, C.leaf, [1.2, 0.55, 0.8]);
      sphere(0.08, x + dx + 0.06, y + 0.56, z, C.leaf, [1.2, 0.55, 0.8]);
      for (const [px, py] of [[0,0.66],[-0.07,0.60],[0.07,0.60],[0,0.54],[-0.07,0.72],[0.07,0.72]]) {
        sphere(0.06, x + dx + px, y + py, z, C.petalPink, [1.0, 0.8, 0.8]);
      }
      sphere(0.04, x + dx, y + 0.63, z + 0.01, C.petalYellow);
    }
  };

  const addFlowerBox = (x, y, z, width = 1.8) => {
    box(width, 0.22, 0.34, x, y, z, C.planter);
    const count = 4;
    for (let i = 0; i < count; i++) {
      const px = x - width / 2 + 0.28 + i * ((width - 0.56) / (count - 1));
      box(0.03, 0.26, 0.03, px, y + 0.22, z, C.leaf);
      sphere(0.06, px - 0.05, y + 0.30, z, C.petalPink, [1.0, 0.8, 0.8]);
      sphere(0.06, px + 0.05, y + 0.30, z, C.petalPink, [1.0, 0.8, 0.8]);
      sphere(0.06, px, y + 0.24, z, C.petalPink, [1.0, 0.8, 0.8]);
      sphere(0.06, px, y + 0.36, z, C.petalPink, [1.0, 0.8, 0.8]);
      sphere(0.04, px, y + 0.30, z + 0.01, C.petalYellow);
    }
  };

  const addFlowerSign = (x, y, z) => {
    sphere(0.18, x, y, z, C.petalYellow, [1, 1, 0.7]);
    const petals = [
      [0, 0.24], [0.22, 0.08], [0.14, -0.18],
      [-0.14, -0.18], [-0.22, 0.08]
    ];
    for (const [px, py] of petals) {
      sphere(0.15, x + px, y + py, z, C.petalPink, [1.15, 0.85, 0.75]);
    }
  };

  // Основание
  box(16.0, 0.36, 10.0, 0, 0.18, 0, C.base);
  box(15.2, 8.4, 9.1, 0, 4.56, 0, C.wall);

  // Угловые акценты
  box(0.42, 8.7, 9.4, -7.4, 4.6, 0, C.trim);
  box(0.42, 8.7, 9.4, 7.4, 4.6, 0, C.trim);

  // Межэтажный пояс и карниз
  box(15.3, 0.18, 9.2, 0, 4.45, 0, C.trim);
  box(15.6, 0.26, 9.5, 0, 8.9, 0, C.trim);
  box(15.6, 0.14, 9.2, 0, 8.66, 0, C.shadow);

  // Цельная двускатная крыша
  const roofProfile = new THREE.Shape();
  roofProfile.moveTo(-8.2, 8.92);
  roofProfile.lineTo(0, 12.0);
  roofProfile.lineTo(8.2, 8.92);
  roofProfile.closePath();
  const roofGeometry = new THREE.ExtrudeGeometry(roofProfile, {
    depth: 10.2,
    bevelEnabled: false,
    steps: 1,
  });
  roofGeometry.translate(0, 0, -5.1);
  add(roofGeometry, C.roof);
  box(16.4, 0.14, 10.3, 0, 8.94, 0, C.roofDark);

  // Верхние окна
  addWindow(-4.8, 6.55, 4.57);
  addWindow(-1.6, 6.55, 4.57);
  addWindow(1.6, 6.55, 4.57);
  addWindow(4.8, 6.55, 4.57);

  // Нижние витрины
  addDisplayWindow(-4.5, 2.3, 4.58, 4.4, 3.0);
  addDisplayWindow(4.5, 2.3, 4.58, 4.4, 3.0);

  // Центральная дверь
  box(1.55, 2.95, 0.16, 0, 2.35, 4.60, C.door);
  box(0.08, 2.82, 0.18, 0, 2.35, 4.66, C.trim);
  box(1.72, 0.16, 0.22, 0, 3.78, 4.61, C.trim);
  box(1.72, 0.16, 0.22, 0, 0.92, 4.61, C.trim);
  box(0.16, 3.0, 0.22, -0.78, 2.35, 4.61, C.trim);
  box(0.16, 3.0, 0.22, 0.78, 2.35, 4.61, C.trim);
  box(0.06, 2.55, 0.20, 0, 2.35, 4.67, C.doorDark);
  box(0.08, 0.08, 0.08, 0.34, 2.2, 4.72, C.trim);

  // Ступенька
  box(2.1, 0.16, 0.7, 0, 0.42, 4.9, C.shadow);

  // Навесы
  addAwning(-4.5, 4.15, 4.58, 4.65);
  addAwning(4.5, 4.15, 4.58, 4.65);
  addAwning(0, 4.15, 4.63, 2.3);

  // Вывеска
  box(5.2, 0.92, 0.18, 0, 8.1, 4.62, C.sign);
  box(5.34, 0.12, 0.22, 0, 8.46, 4.64, C.signBorder);
  box(5.34, 0.12, 0.22, 0, 7.74, 4.64, C.signBorder);
  box(0.12, 0.98, 0.22, -2.58, 8.1, 4.64, C.signBorder);
  box(0.12, 0.98, 0.22, 2.58, 8.1, 4.64, C.signBorder);
  addFlowerSign(0, 8.08, 4.76);

  // Горшки у входа
  addPlanter(-1.45, 0.45, 4.62);
  addPlanter(1.45, 0.45, 4.62);

  // Цветы в витринах
  addFlowerBox(-4.5, 1.15, 4.45, 2.6);
  addFlowerBox(4.5, 1.15, 4.45, 2.6);

  const geometry = mergeGeometries(parts, false);
  if (!geometry) throw new Error('Не удалось объединить геометрии цветочной лавки');
  geometry.computeVertexNormals();

  for (const g of parts) g.dispose();
  return geometry;
}

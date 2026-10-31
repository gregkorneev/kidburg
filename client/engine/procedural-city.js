// Детализированная мэрия: один цветной BufferGeometry для потоковой системы чанков.
// Фасад смотрит в сторону +Z; размеры основного корпуса 22 x 9 x 14 м.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';


export function buildCityHallGeometry() {
  const parts = [];

  const COLORS = {
    wall: 0xe5e2d8,
    trim: 0xcfc8bb,
    roof: 0x8b2e23,
    roofDark: 0x5f1b15,
    glass: 0x87aebc,
    frame: 0xf2efe8,
    door: 0x5b3727,
    doorDark: 0x3e2419,
    brass: 0xc9a24a,
    sign: 0xf3ead1,
    signText: 0x5b3727,
    step: 0xd9d2c3,
    base: 0xbeb6a5,
    lantern: 0xecd38b,
    lanternTop: 0x7d3427,
    clockFace: 0xf5f1e7,
    clockRim: 0x7d2f26,
    clockHand: 0x4b3a2d,
    shadow: 0xbdb5a4,
  };

  const paint = (geometry, color) => {
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

  const add = (geometry, color, { rx = 0, ry = 0, rz = 0, tx = 0, ty = 0, tz = 0 } = {}) => {
    if (rx) geometry.rotateX(rx);
    if (ry) geometry.rotateY(ry);
    if (rz) geometry.rotateZ(rz);
    geometry.translate(tx, ty, tz);
    parts.push(paint(geometry, color));
  };

  const addBox = (w, h, d, x, y, z, color) => {
    add(new THREE.BoxGeometry(w, h, d), color, { tx: x, ty: y, tz: z });
  };

  const addCylinder = (rt, rb, h, seg, x, y, z, color, rot = {}) => {
    add(new THREE.CylinderGeometry(rt, rb, h, seg), color, { ...rot, tx: x, ty: y, tz: z });
  };

  const addGableRoof = (w, d, h, x, y, z, color) => {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0);
    shape.lineTo(0, h);
    shape.lineTo(w / 2, 0);
    shape.lineTo(-w / 2, 0);

    const geom = new THREE.ExtrudeGeometry(shape, {
      depth: d,
      bevelEnabled: false,
    });
    geom.translate(0, 0, -d / 2);
    add(geom, color, { tx: x, ty: y, tz: z });
  };

  const addWindow = (x, y, z, w = 1.95, h = 2.2, d = 0.16) => {
    addBox(w, h, d, x, y, z, COLORS.glass);
    addBox(w + 0.24, 0.16, d + 0.03, x, y + h / 2 - 0.08, z + 0.005, COLORS.frame);
    addBox(w + 0.24, 0.16, d + 0.03, x, y - h / 2 + 0.08, z + 0.005, COLORS.frame);
    addBox(0.16, h + 0.12, d + 0.03, x - w / 2 + 0.08, y, z + 0.005, COLORS.frame);
    addBox(0.16, h + 0.12, d + 0.03, x + w / 2 - 0.08, y, z + 0.005, COLORS.frame);
    addBox(0.12, h + 0.05, d + 0.04, x, y, z + 0.01, COLORS.frame);
    addBox(w + 0.05, 0.12, d + 0.04, x, y, z + 0.01, COLORS.frame);
  };

  const addLantern = (x, y, z) => {
    addBox(0.32, 0.26, 0.22, x, y + 0.38, z, COLORS.lanternTop);
    addBox(0.24, 0.52, 0.18, x, y, z, COLORS.lantern);
    addBox(0.16, 0.16, 0.16, x, y - 0.36, z, COLORS.lanternTop);
  };

  const addPixelLetter = (pattern, originX, originY, z, cell, depth, color) => {
    const rows = pattern.length;
    const cols = pattern[0].length;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (pattern[r][c] !== '1') continue;
        const x = originX + c * cell + cell / 2;
        const y = originY - r * cell - cell / 2;
        addBox(cell * 0.92, cell * 0.92, depth, x, y, z, color);
      }
    }
    return cols * cell;
  };

  const addPixelText = (text, centerX, centerY, z, cell, depth, color) => {
    const letters = {
      'М': [
        '10001',
        '11011',
        '10101',
        '10101',
        '10001',
        '10001',
        '10001',
      ],
      'Э': [
        '11111',
        '00001',
        '00111',
        '00001',
        '00001',
        '10001',
        '11111',
      ],
      'Р': [
        '11110',
        '10001',
        '10001',
        '11110',
        '10000',
        '10000',
        '10000',
      ],
      'И': [
        '10001',
        '11001',
        '10101',
        '10011',
        '10001',
        '10001',
        '10001',
      ],
      'Я': [
        '01111',
        '10001',
        '10001',
        '01111',
        '00101',
        '01001',
        '10001',
      ],
    };

    const chars = [...text];
    const letterWidth = 5 * cell;
    const spacing = cell;
    const totalWidth = chars.length * letterWidth + (chars.length - 1) * spacing;
    let x = centerX - totalWidth / 2;

    for (const ch of chars) {
      const pattern = letters[ch];
      if (!pattern) {
        x += letterWidth + spacing;
        continue;
      }
      addPixelLetter(pattern, x, centerY + (7 * cell) / 2, z, cell, depth, color);
      x += letterWidth + spacing;
    }
  };

  // Основание и корпус
  addBox(18.8, 0.55, 10.8, 0, 0.275, 0, COLORS.base);
  addBox(18.1, 8.7, 10.0, 0, 4.9, 0, COLORS.wall);

  // Угловые пилястры
  addBox(0.65, 9.0, 0.5, -8.55, 4.95, 4.9, COLORS.trim);
  addBox(0.65, 9.0, 0.5, 8.55, 4.95, 4.9, COLORS.trim);
  addBox(0.65, 9.0, 0.5, -8.55, 4.95, -4.9, COLORS.trim);
  addBox(0.65, 9.0, 0.5, 8.55, 4.95, -4.9, COLORS.trim);

  // Межэтажный пояс и карниз
  addBox(18.5, 0.28, 10.2, 0, 3.25, 0, COLORS.trim);
  addBox(19.1, 0.38, 10.6, 0, 8.9, 0, COLORS.trim);
  addBox(18.8, 0.18, 10.3, 0, 8.55, 0, COLORS.shadow);

  // Главная крыша
  addGableRoof(21.0, 12.2, 3.4, 0, 9.1, 0, COLORS.roof);
  addBox(21.1, 0.18, 12.25, 0, 9.12, 0, COLORS.roofDark);
  addBox(0.42, 0.35, 0.42, 0, 12.45, 0, COLORS.roofDark);

  // Входная зона
  addBox(7.2, 0.4, 3.25, 0, 0.78, 5.15, COLORS.step);
  addBox(6.2, 0.28, 2.3, 0, 1.12, 5.45, COLORS.step);
  addBox(4.8, 0.18, 1.4, 0, 1.35, 5.72, COLORS.step);

  // Портик
  addBox(7.4, 0.32, 2.8, 0, 6.35, 5.0, COLORS.trim);
  addBox(7.0, 0.22, 2.55, 0, 6.1, 5.05, COLORS.shadow);

  // Колонны
  const colX = [-2.45, -0.8, 0.8, 2.45];
  for (const x of colX) {
    addCylinder(0.34, 0.42, 4.75, 18, x, 3.4, 5.35, COLORS.frame);
    addBox(0.9, 0.2, 0.9, x, 5.85, 5.35, COLORS.trim);
    addBox(0.8, 0.14, 0.8, x, 0.96, 5.35, COLORS.trim);
  }

  // Крыша портика
  addGableRoof(8.2, 3.5, 1.8, 0, 6.55, 5.08, COLORS.roof);
  addBox(8.22, 0.14, 3.55, 0, 6.58, 5.08, COLORS.roofDark);

  // Фронтон портика
  addBox(6.65, 0.34, 0.38, 0, 6.08, 6.58, COLORS.trim);

  // Часы
  addCylinder(0.78, 0.78, 0.18, 32, 0, 7.45, 5.04, COLORS.clockRim, { rx: Math.PI / 2 });
  addCylinder(0.62, 0.62, 0.1, 32, 0, 7.45, 5.09, COLORS.clockFace, { rx: Math.PI / 2 });
  addBox(0.08, 0.52, 0.06, 0, 7.58, 5.15, COLORS.clockHand);
  addBox(0.38, 0.08, 0.06, 0.14, 7.43, 5.15, COLORS.clockHand);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x = Math.sin(a) * 0.5;
    const y = Math.cos(a) * 0.5;
    addBox(0.04, 0.12, 0.04, x, 7.45 + y, 5.16, COLORS.clockRim);
  }

  // Двери
  addBox(1.0, 2.6, 0.18, -0.55, 2.18, 5.03, COLORS.door);
  addBox(1.0, 2.6, 0.18, 0.55, 2.18, 5.03, COLORS.door);
  addBox(2.18, 0.18, 0.24, 0, 3.55, 5.02, COLORS.trim);
  addBox(0.1, 2.8, 0.14, 0, 2.18, 5.05, COLORS.doorDark);
  addBox(0.08, 0.08, 0.08, -0.16, 2.05, 5.15, COLORS.brass);
  addBox(0.08, 0.08, 0.08, 0.16, 2.05, 5.15, COLORS.brass);

  // Элегантная объёмная вывеска МЭРИЯ.
  // Расположена перед портиком, чтобы крыша не скрывала буквы.
  addBox(5.65, 0.75, 0.16, 0, 6.26, 7.04, COLORS.sign);

  // Тонкая архитектурная рамка.
  addBox(5.82, 0.065, 0.21, 0, 6.65, 7.06, COLORS.brass);
  addBox(5.82, 0.065, 0.21, 0, 5.87, 7.06, COLORS.brass);
  addBox(0.065, 0.82, 0.21, -2.88, 6.26, 7.06, COLORS.brass);
  addBox(0.065, 0.82, 0.21, 2.88, 6.26, 7.06, COLORS.brass);

  // Векторные линии вместо квадратных пиксельных букв.
  // Каждый штрих — гладкая объёмная кривая Three.js.
  const signStroke = (points) => {
    const curve = new THREE.CatmullRomCurve3(
      points.map(([x, y]) => new THREE.Vector3(x, y, 7.20)),
      false,
      'centripetal'
    );
    const geometry = new THREE.TubeGeometry(
      curve, 24, 0.024, 7, false
    );
    add(geometry, COLORS.signText);
  };

  const letterY = 6.08;
  const letterH = 0.39;
  const letterW = 0.42;
  const letterStep = 0.76;
  const firstX = -1.72;

  const line = (i, points) => {
    const x = firstX + i * letterStep;
    signStroke(points.map(([px, py]) => [
      x + px * letterW,
      letterY + py * letterH
    ]));
  };

  // М
  line(0, [
    [0, 0], [0, 1], [0.15, 0.82],
    [0.35, 0.48], [0.5, 0.28],
    [0.65, 0.48], [0.85, 0.82],
    [1, 1], [1, 0]
  ]);

  // Э — округлая форма и средняя перекладина.
  line(1, [
    [0.05, 0.86], [0.3, 1],
    [0.72, 0.96], [1, 0.72],
    [1, 0.28], [0.72, 0.04],
    [0.3, 0], [0.05, 0.14]
  ]);
  line(1, [[0.4, 0.5], [0.94, 0.5]]);

  // Р
  line(2, [[0.06, 0], [0.06, 1]]);
  line(2, [
    [0.06, 1], [0.65, 1],
    [0.94, 0.85], [1, 0.68],
    [0.94, 0.5], [0.65, 0.44],
    [0.06, 0.44]
  ]);

  // И
  line(3, [
    [0, 1], [0, 0],
    [1, 1], [1, 0]
  ]);

  // Я
  line(4, [[1, 0], [1, 1]]);
  line(4, [
    [1, 1], [0.4, 1],
    [0.08, 0.84], [0, 0.66],
    [0.08, 0.5], [0.4, 0.44],
    [1, 0.44]
  ]);
  line(4, [
    [0.48, 0.44], [0.26, 0.18], [0.02, 0]
  ]);

  // Фонари у входа
  addLantern(-3.55, 3.0, 5.2);
  addLantern(3.55, 3.0, 5.2);

  // Окна 1 этаж
  addWindow(-6.1, 2.1, 5.02);
  addWindow(-4.0, 2.1, 5.02);
  addWindow(4.0, 2.1, 5.02);
  addWindow(6.1, 2.1, 5.02);

  // Окна 2 этаж
  addWindow(-6.2, 5.95, 5.02);
  addWindow(-4.1, 5.95, 5.02);
  addWindow(4.1, 5.95, 5.02);
  addWindow(6.2, 5.95, 5.02);

  // Боковые небольшие окна
  addWindow(-8.98, 5.95, 0, 1.25, 2.2, 0.16);
  addWindow(8.98, 5.95, 0, 1.25, 2.2, 0.16);

  const geometry = mergeGeometries(parts, false);
  if (!geometry) throw new Error('Не удалось объединить геометрии мэрии');
  geometry.computeVertexNormals();

  for (const g of parts) g.dispose();
  return geometry;
}


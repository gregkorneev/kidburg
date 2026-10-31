// Конструктор префабов города: из простых форм собирает ОДНУ вершинно-окрашенную геометрию для InstancedMesh.
// Формы со скруглёнными рёбрами, окна с глубиной, навесы, крыши с черепицей и запечённое затемнение
// у земли и под карнизами дают тот же «игрушечный» вид, что и пожарная часть, без текстур и лишних draw calls.
// Геометрия не индексирована и содержит только position/normal/color — подходит для mergeGeometries и выгрузки чанков.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { roundedBox } from './materials.js';

const matrix = new THREE.Matrix4();
const quaternion = new THREE.Quaternion();
const euler = new THREE.Euler();
const position = new THREE.Vector3();
const scale = new THREE.Vector3();
const tmpColor = new THREE.Color();
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * @param {{seed?: number, tint?: number}} [options] tint — случайный разброс яркости деталей (ручная покраска)
 */
export function createPrefabKit({ seed = 1, tint = 0.035 } = {}) {
  const parts = [];
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Стек преобразований для at(): окна и двери можно ставить на любую стену, рисуя их «лицом» к +Z.
  const baseStack = [new THREE.Matrix4()];
  const base = () => baseStack[baseStack.length - 1];

  /** Выполняет fn в системе координат с началом pos и поворотом rotY вокруг вертикали. */
  function at(pos, rotY, fn) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(1, 1, 1));
    baseStack.push(new THREE.Matrix4().multiplyMatrices(base(), m));
    fn();
    baseStack.pop();
  }

  /** Добавляет геометрию (кит берёт её во владение). */
  function add(geometry, color, { pos = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1], tinted = true } = {}) {
    let g;
    if (geometry.userData.shared) {
      // Общие скруглённые коробки живут в кеше art/materials: правим только копию.
      g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      g.userData = {};
    } else if (geometry.index) {
      g = geometry.toNonIndexed();
      geometry.dispose();
    } else {
      g = geometry;
    }
    g.applyMatrix4(matrix.compose(position.set(...pos), quaternion.setFromEuler(euler.set(...rot)), scale.set(...scl)));
    if (baseStack.length > 1) g.applyMatrix4(base());
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    tmpColor.set(color);
    const k = tinted && tint ? 1 + (random() - 0.5) * 2 * tint : 1;
    const count = g.attributes.position.count;
    const data = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      data[i * 3] = Math.min(1, tmpColor.r * k);
      data[i * 3 + 1] = Math.min(1, tmpColor.g * k);
      data[i * 3 + 2] = Math.min(1, tmpColor.b * k);
    }
    g.setAttribute('color', new THREE.BufferAttribute(data, 3));
    parts.push(g);
    return g;
  }

  /** Коробка с центром в (x, y, z). radius > 0 — скруглённые рёбра. */
  function box(w, h, d, x, y, z, color, { r = 0, rot = [0, 0, 0], ry = 0, tinted = true } = {}) {
    // Мелкие детали (рейки, ручки) остаются плоскими: фаска на них не видна, а треугольники дороги.
    const radius = Math.min(w, h, d) < 0.14 ? 0 : Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
    const g = radius > 0.004 ? roundedBox(w, h, d, radius, 1) : new THREE.BoxGeometry(w, h, d);
    return add(g, color, { pos: [x, y, z], rot: ry ? [rot[0], ry, rot[2]] : rot, tinted });
  }

  /** Коробка, стоящая на высоте yBottom. */
  const slab = (w, h, d, x, yBottom, z, color, options) => box(w, h, d, x, yBottom + h / 2, z, color, options);

  function cyl(rt, rb, h, seg, x, y, z, color, { rot = [0, 0, 0], thetaStart = 0, thetaLength = Math.PI * 2, open = false, tinted = true } = {}) {
    return add(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open, thetaStart, thetaLength), color, { pos: [x, y, z], rot, tinted });
  }

  function sphere(r, x, y, z, color, { s = [1, 1, 1], w = 10, h = 7, rot = [0, 0, 0], tinted = true } = {}) {
    return add(new THREE.SphereGeometry(r, w, h), color, { pos: [x, y, z], rot, scl: s, tinted });
  }

  function cone(r, h, seg, x, y, z, color, { rot = [0, 0, 0], tinted = true } = {}) {
    return add(new THREE.ConeGeometry(r, h, seg), color, { pos: [x, y, z], rot, tinted });
  }

  function torus(radius, tube, x, y, z, color, { radial = 8, tubular = 40, rot = [Math.PI / 2, 0, 0], arc = Math.PI * 2 } = {}) {
    return add(new THREE.TorusGeometry(radius, tube, radial, tubular, arc), color, { pos: [x, y, z], rot });
  }

  /** Тело вращения по профилю [[радиус, высота], ...]: чаши, бордюры, кольца. */
  function lathe(profile, segments, x, y, z, color, { tinted = true, phiStart = 0, phiLength = Math.PI * 2 } = {}) {
    return add(new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), segments, phiStart, phiLength), color, { pos: [x, y, z], tinted });
  }

  /** Плоская фигура по контуру [[x, z], ...]: инкрустации и узоры на земле (верх на высоте y + h). */
  function flatShape(points, y, h, color, { tinted = false } = {}) {
    const shape = new THREE.Shape(points.map(([px, pz]) => new THREE.Vector2(px, pz)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
    g.rotateX(Math.PI / 2); // (x, z, depth) -> (x, -depth, z): верх на 0, толщина вниз
    return add(g, color, { pos: [0, y + h, 0], tinted });
  }

  /** Гладкая трубка по точкам (штрихи вывесок, антенны, дуги). */
  function tube(points, radius, color, { segments = 0, radial = 6 } = {}) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
    return add(new THREE.TubeGeometry(curve, segments || Math.max(10, points.length * 6), radius, radial, false), color);
  }

  /** Призма: треугольный профиль в плоскости XY, вытянута вдоль Z (фронтоны, коньки). */
  function prism(w, d, rise, x, y, z, color, { base = 0 } = {}) {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, base);
    shape.lineTo(0, rise);
    shape.lineTo(w / 2, base);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
    g.translate(0, 0, -d / 2);
    return add(g, color, { pos: [x, y, z] });
  }

  /**
   * Двускатная крыша: объём, свесы, лицевая кромка, конёк и «ряды черепицы».
   * Конёк идёт вдоль Z; width/depth — размеры по низу крыши с учётом свеса.
   */
  function gableRoof({ w, d, rise, x = 0, y, z = 0, color, edge, ridge, tiles, courses = 7, frontEdge = true }) {
    prism(w, d, rise, x, y, z, color);
    const slope = Math.atan2(rise, w / 2);
    const length = Math.hypot(w / 2, rise);
    if (tiles) {
      for (const side of [-1, 1]) {
        for (let i = 0; i < courses; i++) {
          const t = (i + 0.6) / (courses + 0.2); // от карниза к коньку
          const px = x + side * (w / 2) * (1 - t);
          const py = y + rise * t;
          const nx = Math.sin(slope) * side * 0.045;
          const ny = Math.cos(slope) * 0.045;
          box(0.07, 0.07, d + 0.06, px + nx, py + ny, z, tiles, { rot: [0, 0, -side * slope], tinted: i % 2 === 0 });
        }
      }
    }
    if (edge) {
      for (const side of [-1, 1]) {
        // Карнизная доска вдоль стока и лобовая доска на фронтонах.
        box(0.22, 0.3, d + 0.16, x + side * (w / 2 - 0.05), y + 0.05, z, edge, { r: 0.05 });
        if (frontEdge) {
          for (const zSide of [-1, 1]) {
            box(length + 0.1, 0.17, 0.2, x + side * w / 4, y + rise / 2 + 0.03, z + zSide * (d / 2 + 0.03), edge, { rot: [0, 0, -side * slope], r: 0.04 });
          }
        }
      }
    }
    if (ridge) box(0.5, 0.34, d + 0.2, x, y + rise + 0.02, z, ridge, { r: 0.12 });
  }

  /**
   * Окно: проём с глубиной, рама, переплёт, подоконник, наличник и необязательные ставни/ящик с цветами.
   * z — плоскость стены, окно выступает наружу (+Z).
   */
  function window(x, y, z, { w = 1.9, h = 2.1, glass = 0x86bccd, frame = 0xfff6e4, sill = null, lintel = null, cross = true, mullions = 1, rows = 2, shutters = null, flowerBox = null, arch = false, d = 0.18 } = {}) {
    const fz = z + d / 2;
    box(w + 0.3, h + 0.3, 0.1, x, y, z + 0.03, frame, { r: 0.03 }); // наличник
    box(w, h, 0.06, x, y, z + 0.085, 0x2f4d5c, { tinted: false }); // глубина проёма
    box(w - 0.1, h - 0.1, 0.05, x, y, z + 0.12, glass, { tinted: false });
    box(w - 0.14, (h - 0.1) * 0.34, 0.03, x, y + (h - 0.1) * 0.3, z + 0.15, tmpColor.set(glass).offsetHSL(0, 0, 0.1).getHex(), { tinted: false }); // блик
    if (cross) {
      for (let i = 1; i <= mullions; i++) box(0.07, h - 0.05, 0.08, x - w / 2 + (w * i) / (mullions + 1), y, fz + 0.02, frame, { r: 0.015 });
      for (let i = 1; i < rows; i++) box(w - 0.04, 0.07, 0.08, x, y - h / 2 + (h * i) / rows, fz + 0.02, frame, { r: 0.015 });
    }
    box(w + 0.18, 0.08, 0.12, x, y + h / 2 - 0.02, fz, frame, { r: 0.03 });
    for (const side of [-1, 1]) box(0.09, h, 0.12, x + side * (w / 2 - 0.02), y, fz, frame, { r: 0.03 });
    box(w + 0.18, 0.08, 0.12, x, y - h / 2 + 0.02, fz, frame, { r: 0.03 });
    if (sill !== null) box(w + 0.52, 0.16, 0.42, x, y - h / 2 - 0.16, z + 0.2, sill, { r: 0.05 });
    if (lintel !== null) box(w + 0.46, 0.2, 0.28, x, y + h / 2 + 0.2, z + 0.14, lintel, { r: 0.05 });
    if (shutters !== null) {
      for (const side of [-1, 1]) box(0.5, h + 0.1, 0.07, x + side * (w / 2 + 0.52), y, z + 0.1, shutters, { r: 0.02 });
    }
    if (flowerBox !== null) {
      box(w + 0.2, 0.32, 0.38, x, y - h / 2 - 0.22, z + 0.3, flowerBox.box, { r: 0.05 });
      for (let i = 0; i < 5; i++) {
        const fx = x - w / 2 + 0.2 + (i * (w - 0.4)) / 4;
        sphere(0.18, fx, y - h / 2 + 0.02 + (i % 2) * 0.05, z + 0.3, flowerBox.leaf, { w: 7, h: 5 });
        sphere(0.11, fx, y - h / 2 + 0.2 + (i % 2) * 0.05, z + 0.34, flowerBox.blooms[i % flowerBox.blooms.length], { w: 6, h: 5 });
      }
    }
  }

  /** Двустворчатая дверь с рамой, стеклом, ручками и порожком. z — плоскость стены. */
  function door(x, y, z, { w = 2.4, h = 3.2, leaf = 0x5b3727, frame = 0xfff1d8, glass = 0x86bccd, handle = 0xf0c85f, step = null, transom = true } = {}) {
    box(w + 0.4, h + 0.35, 0.16, x, y + 0.05, z + 0.05, frame, { r: 0.05 });
    box(w, h, 0.12, x, y, z + 0.1, 0x2a1d17, { tinted: false });
    for (const side of [-1, 1]) {
      box(w / 2 - 0.08, h - 0.1, 0.1, x + side * (w / 4), y, z + 0.17, leaf, { r: 0.04 });
      box(w / 2 - 0.4, h * 0.34, 0.06, x + side * (w / 4), y + h * 0.17, z + 0.23, glass, { r: 0.03, tinted: false });
      box(w / 2 - 0.34, h * 0.26, 0.05, x + side * (w / 4), y - h * 0.24, z + 0.23, tmpColor.set(leaf).multiplyScalar(0.82).getHex(), { r: 0.03, tinted: false });
    }
    box(0.08, h, 0.14, x, y, z + 0.2, frame, { r: 0.02 });
    for (const side of [-1, 1]) sphere(0.07, x + side * 0.2, y - 0.1, z + 0.3, handle, { w: 6, h: 5 });
    if (transom) box(w + 0.1, 0.12, 0.2, x, y + h / 2 + 0.05, z + 0.17, frame, { r: 0.04 });
    if (step !== null) {
      box(w + 1.2, 0.18, 1.1, x, 0.09 + 0.02, z + 0.6, step, { r: 0.06 });
      box(w + 0.7, 0.14, 0.7, x, 0.25 + 0.02, z + 0.45, step, { r: 0.05 });
    }
  }

  /** Полосатый навес со скруглённой бахромой. Верхний край у стены (z), свободный выступает на depth. */
  function awning(x, y, z, { w = 5, depth = 1.8, drop = 0.7, stripes = 8, a = 0xc96156, b = 0xfff1d8, bracket = 0x6b4a38 } = {}) {
    const stripe = w / stripes;
    const tilt = Math.atan2(drop, depth);
    const length = Math.hypot(depth, drop);
    for (let i = 0; i < stripes; i++) {
      const sx = x - w / 2 + stripe * (i + 0.5);
      const color = i % 2 ? b : a;
      box(stripe * 0.98, 0.09, length, sx, y - drop / 2, z + depth / 2, color, { rot: [tilt, 0, 0], r: 0.02 });
      // Бахрома: полудиск, выпуклостью вниз (ось цилиндра вдоль Z).
      cyl(stripe * 0.49, stripe * 0.49, 0.1, 10, sx, y - drop - 0.02, z + depth - 0.01, color, { rot: [Math.PI / 2, 0, 0], thetaStart: -Math.PI / 2, thetaLength: Math.PI });
    }
    for (const side of [-1, 1]) {
      box(0.1, 0.1, length * 0.9, x + side * (w / 2 - 0.15), y - drop / 2 - 0.1, z + depth / 2, bracket, { rot: [tilt, 0, 0], r: 0.02 });
    }
  }

  /** Деревянная лавка/скамейка на кованых ножках. */
  function bench(x, z, rotY, { wood = 0xb8774c, metal = 0x2f5a60, width = 2.2 } = {}) {
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    const put = (lx, ly, lz) => [x + lx * c + lz * s, ly, z - lx * s + lz * c];
    const seat = put(0, 0.5, 0);
    box(width, 0.1, 0.6, seat[0], seat[1], seat[2], wood, { ry: rotY, r: 0.03 });
    const back = put(0, 0.9, -0.26);
    box(width, 0.42, 0.08, back[0], back[1], back[2], wood, { ry: rotY, r: 0.03, rot: [-0.12, 0, 0] });
    for (const sx of [-1, 1]) {
      const leg = put(sx * (width / 2 - 0.12), 0.26, 0);
      box(0.09, 0.52, 0.5, leg[0], leg[1], leg[2], metal, { ry: rotY, r: 0.03 });
      const arm = put(sx * (width / 2 - 0.12), 0.7, -0.05);
      box(0.09, 0.07, 0.52, arm[0], arm[1], arm[2], metal, { ry: rotY, r: 0.02 });
    }
  }

  /** Сборка: слияние, запечённое затемнение у земли, под карнизами и на нижних гранях. */
  function build({ groundAO = { height: 1.6, strength: 0.34 }, bands = [], underside = 0.74 } = {}) {
    const merged = mergeGeometries(parts, false);
    for (const g of parts) g.dispose();
    parts.length = 0;
    if (!merged) throw new Error('prefab-kit: нет частей для объединения');
    const pos = merged.attributes.position;
    const nor = merged.attributes.normal;
    const col = merged.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const ny = nor.getY(i);
      let k = 1;
      const wall = Math.abs(ny) < 0.6;
      if (groundAO && wall) k *= 1 - groundAO.strength * (1 - smooth(0, groundAO.height, y));
      if (ny < -0.5) k *= underside;
      for (const band of bands) if (wall && y >= band.y0 && y <= band.y1) k *= 1 - band.strength * (1 - smooth(band.y0, band.y1, y) * (band.fade ?? 0));
      if (k !== 1) col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
    }
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
  }

  return { add, at, box, slab, cyl, sphere, cone, torus, lathe, flatShape, tube, prism, gableRoof, window, door, awning, bench, build, random, get count() { return parts.length; } };
}

// Подвижная мебель пожарной части: шкафы экипировки с дверцей на петлях и инструментальная тумба с выдвижными ящиками.
// Неподвижные корпуса склеены в одну вершинно-окрашенную геометрию, а дверцы и ящики — отдельные Mesh с настоящей
// точкой вращения / направляющей. Каждая подвижная деталь — самостоятельный механизм (open/close/toggle/applyRemote),
// поэтому они синхронизируются через mechanism-sync так же, как ворота, и работают независимо друг от друга.
//
// Система координат мебели: начало — центр у пола, +Y вверх, +Z — лицевая сторона (где стоит игрок).
import * as THREE from 'three';
import { createPrefabKit } from '../art/prefab-kit.js';
import { sharedGeometry } from '../art/materials.js';
import { createAnimatedObject, createProgress, createStateMachine, easeInOutCubic } from '../animated.js';

export const FURNITURE_TRANSITIONS = Object.freeze({
  closed: ['opening'],
  opening: ['open', 'closing'],
  open: ['closing'],
  closing: ['closed', 'opening'],
});

/** Угол распахивания дверцы шкафа (рад) и ход ящика (м). */
export const CABINET_SWING = 1.9;
export const DRAWER_TRAVEL = 0.46;

const PAL = {
  body: 0x5d7f99, bodyLight: 0x7fa0b8, bodyDark: 0x46657c, red: 0xd65a42, redDark: 0xa94436, yellow: 0xf0c85f,
  ink: 0x2b3335, steel: 0xb9c4cf, steelDark: 0x7d8b97, inside: 0x35495a, shelf: 0xc9d3dc, wood: 0xb8774c, white: 0xfff9e8, orange: 0xf28b35,
};

let sharedMaterial = null;
const furnitureMaterial = () => {
  if (!sharedMaterial) {
    sharedMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.58, metalness: 0.12 });
    sharedMaterial.userData.shared = true;
  }
  return sharedMaterial;
};

const solo = (key, fn) => sharedGeometry(key, () => {
  const kit = createPrefabKit({ seed: 21, tint: 0.012 });
  fn(kit);
  return kit.build({ groundAO: null, underside: 0.92 });
});

const meshOf = (geometry, name) => {
  const mesh = new THREE.Mesh(geometry, furnitureMaterial());
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};

/**
 * Механизм «открыто / закрыто» с общим интерфейсом (как ворота и двери): переключение, подпись, состояние с сервера.
 * layout(eased, progress) расставляет подвижные части по сглаженному прогрессу.
 */
function toggleMechanism({ id, root, parts, duration, labels, layout, api = {} }) {
  const progress = createProgress({ duration, initial: 0 });
  const machine = createStateMachine({ initial: 'closed', transitions: FURNITURE_TRANSITIONS });
  const apply = () => layout(easeInOutCubic(progress.value), progress.value);
  apply();
  function sync() {
    const v = progress.value;
    if (v === progress.target) machine.force(v >= 1 ? 'open' : 'closed');
    else machine.force(progress.target > v ? 'opening' : 'closing');
  }
  const object = createAnimatedObject({
    id,
    root,
    parts,
    machine,
    update(dt) {
      if (!progress.update(dt)) return;
      apply();
      sync();
    },
    api: Object.defineProperties({
      get progress() { return progress.value; },
      get isOpen() { return progress.target === 1 && progress.value === 1; },
      get wantsOpen() { return progress.target === 1; },
      get label() { return progress.target === 1 ? labels.close : labels.open; },
      open(advance = 0) { progress.go(1, advance); apply(); sync(); return progress.moving || progress.value === 1; },
      close(advance = 0) { progress.go(0, advance); apply(); sync(); return progress.moving || progress.value === 0; },
      toggle() { return progress.target === 1 ? object.close() : object.open(); },
      applyRemote({ open, ageMs = 0, progress: remoteProgress, elapsedMs = 0 }) {
        if (Number.isFinite(remoteProgress)) {
          progress.jump(remoteProgress);
          progress.go(open ? 1 : 0, Math.max(0, elapsedMs) / 1000);
        } else {
          if (progress.target === (open ? 1 : 0) && !progress.moving) return;
          progress.go(open ? 1 : 0, Math.max(0, ageMs) / 1000);
        }
        apply();
        sync();
      },
    }, Object.getOwnPropertyDescriptors(api)),
  });
  object.setState = (next) => (next === 'opening' ? object.open() : next === 'closing' ? object.close() : false);
  return object;
}

// ── Шкаф экипировки ───────────────────────────────────────────────────────

const WALL_T = 0.04;

/** Корпус шкафа: стенки, дно, крыша, две полки и тематическое содержимое. variant: 'gear' | 'tools'. */
function cabinetBodyGeometry({ width, height, depth, variant }) {
  return solo(`cabinet-body:${width}:${height}:${depth}:${variant}`, (k) => {
    const w = width;
    const h = height;
    const d = depth;
    k.box(w, 0.1, d, 0, 0.05, 0, PAL.bodyDark, { r: 0.02 }); // цоколь
    k.box(w, 0.06, d + 0.04, 0, h - 0.03, 0.01, PAL.bodyLight, { r: 0.025 }); // крыша
    for (const sx of [-1, 1]) k.box(WALL_T, h - 0.1, d, sx * (w / 2 - WALL_T / 2), h / 2 + 0.05, 0, PAL.body, { r: 0.012 });
    k.box(w - WALL_T * 2, h - 0.16, WALL_T, 0, h / 2 + 0.02, -d / 2 + WALL_T / 2, PAL.inside, { tinted: false });
    for (const y of [h * 0.36, h * 0.66]) k.box(w - WALL_T * 2, 0.035, d - 0.08, 0, y, 0.02, PAL.shelf, { r: 0.01 });
    k.box(w - WALL_T * 2, 0.03, d - 0.08, 0, 0.13, 0.02, PAL.shelf, { r: 0.01 });
    const y1 = 0.13 + 0.015;
    const y2 = h * 0.36 + 0.018;
    const y3 = h * 0.66 + 0.018;
    if (variant === 'gear') {
      // Нижняя полка: сапоги. Средняя: перчатки и фонарик. Верхняя: каска.
      for (const x of [-0.2, 0.2]) {
        k.sphere(0.1, x, y1 + 0.13, 0.05, PAL.ink, { s: [1, 1.3, 1.6], w: 8, h: 6 });
        k.box(0.17, 0.05, 0.3, x, y1 + 0.02, 0.07, PAL.yellow, { r: 0.01, tinted: false });
      }
      for (const x of [-0.18, 0.04]) k.box(0.15, 0.05, 0.22, x, y2 + 0.03, 0.04, PAL.orange, { r: 0.02, rot: [0, 0.3, 0] });
      k.cyl(0.035, 0.035, 0.22, 8, 0.28, y2 + 0.04, 0.03, PAL.yellow, { rot: [0, 0, Math.PI / 2], tinted: false });
      k.sphere(0.2, 0, y3 + 0.02, 0.02, PAL.red, { s: [1, 0.7, 1], w: 12, h: 6 });
      k.cyl(0.25, 0.25, 0.03, 14, 0, y3 + 0.01, 0.02, PAL.redDark, { tinted: false });
      k.box(0.22, 0.05, 0.04, 0, y3 + 0.08, 0.19, PAL.yellow, { tinted: false });
      // Куртка на вешалке сверху шкафа.
      k.box(0.46, 0.44, 0.12, 0, h - 0.34, 0.04, PAL.red, { r: 0.05 });
      k.box(0.46, 0.05, 0.125, 0, h - 0.4, 0.04, PAL.yellow, { tinted: false });
      k.box(0.46, 0.05, 0.125, 0, h - 0.28, 0.04, PAL.yellow, { tinted: false });
      for (const sx of [-1, 1]) k.box(0.12, 0.38, 0.1, sx * 0.29, h - 0.36, 0.04, PAL.red, { r: 0.04 });
    } else {
      // Огнетушитель, топорик, фонарь и ящик с инструментами.
      k.cyl(0.075, 0.075, 0.38, 10, -0.22, y1 + 0.2, 0.05, PAL.red);
      k.cyl(0.03, 0.03, 0.08, 8, -0.22, y1 + 0.42, 0.05, PAL.ink, { tinted: false });
      k.box(0.14, 0.03, 0.03, -0.17, y1 + 0.46, 0.05, PAL.ink, { tinted: false });
      k.box(0.3, 0.14, 0.2, 0.17, y2 - 0.04 + 0.04, 0.04, PAL.orange, { r: 0.02 });
      k.box(0.3, 0.04, 0.05, 0.17, y2 + 0.12, 0.04, PAL.ink, { tinted: false });
      k.cyl(0.04, 0.04, 0.3, 8, -0.14, y3 + 0.04, 0.04, PAL.yellow, { rot: [0, 0, Math.PI / 2], tinted: false });
      k.box(0.05, 0.28, 0.04, 0.2, y3 + 0.16, 0.04, PAL.wood, { rot: [0, 0, -0.15] });
      k.box(0.2, 0.08, 0.04, 0.26, y3 + 0.3, 0.04, PAL.steelDark, { rot: [0, 0, -0.15] });
    }
  });
}

/** Дверца шкафа с шарниром у кромки (x = 0 — ось петли). dir = +1: дверца уходит от петли в +X. */
function cabinetDoorGeometry({ width, height, depth, dir, variant }) {
  return solo(`cabinet-door:${width}:${height}:${depth}:${dir}:${variant}`, (k) => {
    const cx = dir * (width / 2);
    const front = variant === 'gear' ? PAL.body : PAL.redDark;
    const bright = variant === 'gear' ? PAL.bodyLight : PAL.red;
    k.box(width - 0.02, height - 0.18, 0.05, cx, 0, 0, front, { r: 0.02 });
    k.box(width - 0.14, height - 0.3, 0.02, cx, 0, 0.03, bright, { r: 0.015 });
    for (let i = 0; i < 5; i++) k.box(width - 0.34, 0.025, 0.03, cx, (height - 0.18) * 0.34 - i * 0.06, 0.04, PAL.inside, { tinted: false });
    k.box(0.04, 0.3, 0.05, dir * (width - 0.13), 0, 0.06, PAL.yellow, { r: 0.012, tinted: false });
    k.box(0.12, 0.12, 0.012, cx, -(height - 0.18) * 0.28, 0.04, PAL.white, { tinted: false });
    k.box(0.12, 0.034, 0.014, cx, -(height - 0.18) * 0.28, 0.046, PAL.red, { tinted: false });
    k.box(0.034, 0.12, 0.014, cx, -(height - 0.18) * 0.28, 0.046, PAL.red, { tinted: false });
  });
}

/**
 * @param {object} o
 * @param {string} o.id
 * @param {'left'|'right'} [o.hinge] с какой стороны петли (если смотреть спереди)
 * @param {'gear'|'tools'} [o.variant]
 */
export function createCabinet({ id, width = 1.1, height = 2.1, depth = 0.6, hinge = 'left', variant = 'gear', duration = 0.8 }) {
  const root = new THREE.Group();
  root.name = `cabinet:${id}`;
  root.add(meshOf(cabinetBodyGeometry({ width, height, depth, variant }), `cabinet:${id}:body`));
  const side = hinge === 'left' ? -1 : 1;
  const pivot = new THREE.Group();
  pivot.name = `cabinet:${id}:hinge`;
  pivot.position.set(side * (width / 2 - 0.005), height / 2 + 0.02, depth / 2 + 0.025);
  const door = meshOf(cabinetDoorGeometry({ width, height, depth, dir: -side, variant }), `cabinet:${id}:door`);
  pivot.add(door);
  // Петли: два цилиндра на оси вращения.
  const hingeGeometry = solo('cabinet-hinge', (k) => { k.cyl(0.016, 0.016, 0.12, 8, 0, 0, 0, PAL.steel, { tinted: false }); });
  for (const y of [-height * 0.32, height * 0.32]) {
    const barrel = meshOf(hingeGeometry, `cabinet:${id}:hinge-barrel`);
    barrel.position.set(0, y, 0);
    pivot.add(barrel);
  }
  root.add(pivot);
  // Дверца уходит наружу: левая петля — вправо-вперёд, правая — влево-вперёд.
  const object = toggleMechanism({
    id,
    root,
    parts: { door: pivot, hingeSide: side },
    duration,
    labels: { open: 'Открыть шкаф', close: 'Закрыть шкаф' },
    layout: (eased) => { pivot.rotation.y = side * CABINET_SWING * eased; },
    api: { width, height, depth, variant, get angle() { return Math.abs(pivot.rotation.y); } },
  });
  return object;
}

// ── Тумба с выдвижными ящиками ────────────────────────────────────────────

function chestBodyGeometry({ width, height, depth, drawers }) {
  return solo(`chest-body:${width}:${height}:${depth}:${drawers}`, (k) => {
    const slot = (width - 0.1) / drawers;
    k.box(width, 0.1, depth, 0, 0.05, 0, PAL.bodyDark, { r: 0.02 });
    k.box(width + 0.04, 0.07, depth + 0.04, 0, height - 0.035, 0.01, PAL.steel, { r: 0.025 }); // столешница
    for (const sx of [-1, 1]) k.box(0.05, height - 0.17, depth, sx * (width / 2 - 0.025), height / 2 + 0.02, 0, PAL.body, { r: 0.012 });
    k.box(width - 0.1, height - 0.17, 0.04, 0, height / 2 + 0.02, -depth / 2 + 0.02, PAL.inside, { tinted: false });
    for (let i = 1; i < drawers; i++) k.box(0.04, height - 0.17, depth - 0.04, -width / 2 + 0.05 + slot * i, height / 2 + 0.02, 0, PAL.bodyDark);
    k.box(width - 0.1, 0.03, depth - 0.04, 0, 0.12, 0, PAL.inside, { tinted: false });
    // Инструменты на столешнице: ящик, ключ, рулон ленты.
    k.box(0.42, 0.1, 0.2, -width * 0.3, height + 0.05, -0.05, PAL.red, { r: 0.02 });
    k.box(0.3, 0.025, 0.05, -width * 0.3, height + 0.115, -0.05, PAL.ink, { tinted: false });
    k.cyl(0.07, 0.07, 0.05, 10, width * 0.3, height + 0.03, 0.05, PAL.orange, { rot: [0, 0, 0], tinted: false });
    k.box(0.04, 0.4, 0.02, width * 0.05, height + 0.01, 0.1, PAL.steelDark, { rot: [Math.PI / 2, 0, 0.5] });
  });
}

/** Ящик: лицевая панель и короб с инструментами; начало — центр лицевой панели в закрытом положении. */
function drawerGeometry({ w, h, d, index }) {
  return solo(`chest-drawer:${w}:${h}:${d}:${index}`, (k) => {
    const color = index % 2 ? PAL.red : PAL.body;
    k.box(w, h, 0.04, 0, 0, 0, color, { r: 0.015 });
    k.box(w - 0.12, 0.035, 0.05, 0, 0.0, 0.035, PAL.yellow, { r: 0.012, tinted: false });
    for (const sx of [-1, 1]) k.box(0.025, 0.07, 0.05, sx * (w / 2 - 0.1), 0, 0.03, PAL.steelDark, { tinted: false });
    // Короб за лицевой панелью.
    const inner = w - 0.08;
    k.box(inner, 0.03, d, 0, -h / 2 + 0.05, -d / 2, PAL.steel, { r: 0.008 });
    for (const sx of [-1, 1]) k.box(0.025, h - 0.1, d, sx * (inner / 2), -0.02, -d / 2, PAL.steel, { r: 0.008 });
    k.box(inner, h - 0.1, 0.025, 0, -0.02, -d, PAL.steel, { r: 0.008 });
    // Содержимое: у каждого ящика свой набор мелких инструментов.
    const floor = -h / 2 + 0.07;
    if (index === 0) {
      k.cyl(0.055, 0.055, 0.2, 8, -0.15, floor + 0.05, -0.2, PAL.orange, { rot: [Math.PI / 2, 0, 0], tinted: false });
      k.box(0.14, 0.05, 0.1, 0.12, floor + 0.01, -0.2, PAL.yellow, { r: 0.012, tinted: false });
    } else if (index === 1) {
      k.box(0.04, 0.03, 0.34, -0.1, floor, -0.22, PAL.steelDark, { rot: [0, 0.12, 0], tinted: false });
      k.box(0.12, 0.04, 0.05, 0.14, floor + 0.01, -0.18, PAL.red, { rot: [0, 0.4, 0] });
      k.cyl(0.03, 0.03, 0.22, 8, 0.0, floor + 0.04, -0.34, PAL.wood, { rot: [Math.PI / 2, 0, 0.3] });
    } else {
      k.box(0.17, 0.06, 0.22, -0.12, floor + 0.01, -0.22, PAL.orange, { r: 0.025, rot: [0, 0.2, 0] });
      k.box(0.17, 0.06, 0.22, 0.12, floor + 0.01, -0.3, PAL.orange, { r: 0.025, rot: [0, -0.25, 0] });
    }
  });
}

/**
 * Тумба с N независимыми ящиками. Возвращает { root, drawers: [механизм…], dispose, update }.
 * Каждый ящик — свой механизм: id = `${id}-${i}`.
 */
export function createDrawerChest({ id, width = 2.2, height = 0.95, depth = 0.65, drawers = 3, duration = 0.6 }) {
  const root = new THREE.Group();
  root.name = `chest:${id}`;
  root.add(meshOf(chestBodyGeometry({ width, height, depth, drawers }), `chest:${id}:body`));
  const slot = (width - 0.1) / drawers;
  const drawerH = height - 0.3;
  const list = [];
  for (let i = 0; i < drawers; i++) {
    const group = new THREE.Group();
    const home = new THREE.Vector3(-width / 2 + 0.05 + slot * (i + 0.5), height / 2 - 0.02, depth / 2 + 0.01);
    group.position.copy(home);
    group.add(meshOf(drawerGeometry({ w: slot - 0.04, h: drawerH, d: depth - 0.12, index: i }), `chest:${id}:drawer:${i}`));
    root.add(group);
    const drawer = toggleMechanism({
      id: `${id}-${i}`,
      root: group,
      parts: { slide: group },
      duration,
      labels: { open: 'Выдвинуть ящик', close: 'Задвинуть ящик' },
      layout: (eased) => { group.position.z = home.z + DRAWER_TRAVEL * eased; },
      api: { index: i, travel: DRAWER_TRAVEL, home, get offset() { return group.position.z - home.z; } },
    });
    list.push(drawer);
  }
  return {
    id,
    root,
    drawers: list,
    width,
    depth,
    update(dt, elapsed) { for (const drawer of list) drawer.update(dt, elapsed); },
    dispose() {
      for (const drawer of list) drawer.dispose();
      root.traverse((node) => { if (node.geometry && !node.geometry.userData?.shared) node.geometry.dispose(); });
      root.removeFromParent();
    },
  };
}

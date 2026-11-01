// Входная дверь здания: неподвижная рама остаётся в слитой геометрии префаба, а створки (одна или две) — отдельные Mesh
// на петлях. Створки открываются наружу вокруг внешних кромок, ручки и стёкла закреплены на створках.
//
// Система координат двери: начало — центр проёма (как в k.door), +Y вверх, +Z наружу, к фасаду.
// Состояния: closed → opening → open → closing → closed. Повторные команды безопасны: open() во время closing
// разворачивает створки с текущего угла без рывка. Интерфейс совпадает с воротами (gate.js), поэтому сетевая
// синхронизация mechanism-sync.js работает без изменений.
import * as THREE from 'three';
import { createPrefabKit } from '../art/prefab-kit.js';
import { sharedGeometry } from '../art/materials.js';
import { createAnimatedObject, createProgress, createStateMachine, easeInOutSine } from '../animated.js';
import { DOOR_DURATION_S } from '../../../shared/doors.js';

export const DOOR_TRANSITIONS = Object.freeze({
  closed: ['opening'],
  opening: ['open', 'closing'],
  open: ['closing'],
  closing: ['closed', 'opening'],
});
export const DOOR_LABELS = Object.freeze({ open: 'Открыть дверь', close: 'Закрыть дверь' });
/** Максимальный угол распахивания створки (рад). */
export const DOOR_SWING = 1.75;
/** Расстояние шарнира от кромки проёма (м): совпадает с зазором створки в k.door(). */
const HINGE_INSET = 0.04;
/** Смещение плоскости створки наружу от центра проёма (м): как у k.door(). */
export const LEAF_Z = 0.17;

let sharedMaterial = null;
const leafMaterial = () => {
  if (!sharedMaterial) {
    sharedMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.62, metalness: 0.04 });
    sharedMaterial.userData.shared = true;
  }
  return sharedMaterial;
};

const shade = (hex, k) => new THREE.Color(hex).multiplyScalar(k).getHex();

/**
 * Геометрия створки с шарниром в начале координат. dir = −1: створка уходит от шарнира в −X (шарнир на правой кромке),
 * dir = +1: в +X (левая кромка).
 */
function leafGeometry({ width, height, leaf, glass, handle, dir }) {
  return sharedGeometry(`door-leaf:${width}:${height}:${leaf}:${glass ?? 'none'}:${handle}:${dir}`, () => {
    const kit = createPrefabKit({ seed: 9, tint: 0.01 });
    const cx = dir * (width / 2);
    kit.box(width, height, 0.1, cx, 0, 0, leaf, { r: 0.04 });
    if (glass !== null) {
      kit.box(width - 0.32, height * 0.34, 0.06, cx, height * 0.17, 0.06, glass, { r: 0.03, tinted: false });
      kit.box(width - 0.26, height * 0.26, 0.05, cx, -height * 0.24, 0.06, shade(leaf, 0.82), { r: 0.03, tinted: false });
    } else {
      // Глухая створка: филёнки вместо стекла.
      kit.box(width - 0.3, height * 0.36, 0.05, cx, height * 0.2, 0.06, shade(leaf, 0.9), { r: 0.03, tinted: false });
      kit.box(width - 0.26, height * 0.28, 0.05, cx, -height * 0.24, 0.06, shade(leaf, 0.82), { r: 0.03, tinted: false });
    }
    kit.sphere(0.07, dir * (width - 0.16), -0.1, 0.13, handle, { w: 6, h: 5, tinted: false });
    kit.box(0.05, 0.05, 0.1, dir * (width - 0.16), -0.1, 0.07, handle, { tinted: false });
    return kit.build({ groundAO: null, underside: 1 });
  });
}

/**
 * @param {object} o
 * @param {string} o.id
 * @param {number} o.w ширина проёма (м)
 * @param {number} o.h высота створки (м, как у k.door)
 * @param {number} o.leaf цвет створок
 * @param {number|null} [o.glass] цвет стёкол; null — глухие створки
 * @param {number} [o.handle] цвет ручек
 * @param {number} [o.duration] полное время открытия (с)
 * @param {boolean} [o.initialOpen]
 */
export function createDoor({ id, w, h, leaf, glass = null, handle = 0xf0c85f, duration = DOOR_DURATION_S, initialOpen = false }) {
  const root = new THREE.Group();
  root.name = `door:${id}`;
  const leafWidth = w / 2 - 0.08;
  const leafHeight = h - 0.1;
  const hinges = [-1, 1].map((side) => {
    // side = +1 — правая кромка проёма (шарнир справа), створка уходит влево от шарнира.
    const dir = -side;
    const pivot = new THREE.Group();
    pivot.name = `door:${id}:hinge:${side}`;
    pivot.position.set(side * (w / 2 - HINGE_INSET), 0, LEAF_Z);
    const mesh = new THREE.Mesh(leafGeometry({ width: leafWidth, height: leafHeight, leaf, glass, handle, dir }), leafMaterial());
    mesh.name = `door:${id}:leaf:${side}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    pivot.add(mesh);
    root.add(pivot);
    return { side, pivot, mesh };
  });

  const progress = createProgress({ duration, initial: initialOpen ? 1 : 0 });
  const machine = createStateMachine({ initial: initialOpen ? 'open' : 'closed', transitions: DOOR_TRANSITIONS });

  function layout() {
    const angle = easeInOutSine(progress.value) * DOOR_SWING;
    // Створки расходятся в противоположные стороны независимо друг от друга.
    for (const { side, pivot } of hinges) pivot.rotation.y = side * angle;
  }
  layout();

  function sync() {
    const v = progress.value;
    if (v === progress.target) machine.force(v >= 1 ? 'open' : 'closed');
    else machine.force(progress.target > v ? 'opening' : 'closing');
  }

  const object = createAnimatedObject({
    id,
    root,
    parts: { hinges: hinges.map((hinge) => hinge.pivot), leaves: hinges.map((hinge) => hinge.mesh) },
    machine,
    update(dt) {
      if (!progress.update(dt)) return;
      layout();
      sync();
    },
    api: {
      get progress() { return progress.value; },
      get isOpen() { return progress.target === 1 && progress.value === 1; },
      get wantsOpen() { return progress.target === 1; },
      /** Дверь в городе только открывается: стены здания сплошные, переход в станцию — отдельной страницей. */
      get passable() { return progress.value >= 0.92; },
      get blocking() { return false; },
      get label() { return progress.target === 1 ? DOOR_LABELS.close : DOOR_LABELS.open; },
      open(advance = 0) { progress.go(1, advance); layout(); sync(); return progress.moving || progress.value === 1; },
      close(advance = 0) { progress.go(0, advance); layout(); sync(); return progress.moving || progress.value === 0; },
      toggle() { return progress.target === 1 ? object.close() : object.open(); },
      /** Состояние сервера: цель, прогресс на момент сообщения и сколько мс прошло с тех пор. */
      applyRemote({ open, ageMs = 0, progress: remoteProgress, elapsedMs = 0 }) {
        if (Number.isFinite(remoteProgress)) {
          progress.jump(remoteProgress);
          progress.go(open ? 1 : 0, Math.max(0, elapsedMs) / 1000);
          layout();
          sync();
          return;
        }
        if (progress.target === (open ? 1 : 0) && !progress.moving) return;
        progress.go(open ? 1 : 0, Math.max(0, ageMs) / 1000);
        layout();
        sync();
      },
      leafCount: hinges.length,
      swing: DOOR_SWING,
    },
  });
  object.setState = (next) => (next === 'opening' ? object.open() : next === 'closing' ? object.close() : false);
  return object;
}

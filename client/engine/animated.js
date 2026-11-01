// Каркас анимированных составных объектов (ворота, пожарная машина, тестомес, антенна).
// Неподвижная основа остаётся в общей слитой геометрии, а подвижные части — отдельные Object3D с правильной точкой
// вращения. Объект не крутит собственный requestAnimationFrame: его вызывает цикл сцены через update(dt, elapsed).
//
//   const door = createAnimatedObject({ id, root, machine, update(dt, elapsed) {...}, dispose() {...} });
//   door.setState('opening');   door.update(dt, elapsed);   door.dispose();
import * as THREE from 'three';
import { isSharedResource } from './art/materials.js';

export const clamp01 = (v) => Math.min(1, Math.max(0, v));
export const lerp = (a, b, t) => a + (b - a) * t;
/** Доля пути p между моментами a и b общего прогресса: для последовательных фаз механизма. */
export const phase = (p, a, b) => clamp01((p - a) / (b - a));
export const easeInOutSine = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t));
export const easeInOutCubic = (t) => { const x = clamp01(t); return x < 0.5 ? 4 * x * x * x : 1 - ((-2 * x + 2) ** 3) / 2; };
export const easeOutCubic = (t) => 1 - (1 - clamp01(t)) ** 3;

/**
 * Прогресс 0..1 с направлением. go(1) идёт вперёд, go(0) — назад; повторная команда в ту же сторону ничего не меняет,
 * обратная — разворачивает движение с текущего положения, без скачка. Длительность считается на полный путь.
 */
export function createProgress({ duration = 1, initial = 0 } = {}) {
  let value = clamp01(initial);
  let target = value;
  return {
    get value() { return value; },
    get target() { return target; },
    get moving() { return value !== target; },
    /** Новое направление; `advance` — секунды, уже прошедшие с начала перехода (восстановление по времени сервера). */
    go(next, advance = 0) {
      target = clamp01(next);
      if (advance > 0) this.update(advance);
      return value !== target;
    },
    jump(next) { value = target = clamp01(next); },
    setDuration(seconds) { duration = Math.max(0.05, seconds); },
    get duration() { return duration; },
    update(dt) {
      if (value === target) return false;
      const step = dt / duration;
      value = value < target ? Math.min(target, value + step) : Math.max(target, value - step);
      return true;
    },
  };
}

/**
 * Конечный автомат. transitions: { состояние: [допустимые следующие] }. set() с недопустимым состоянием или с тем
 * же состоянием возвращает false и ничего не меняет — повторные команды безопасны.
 */
export function createStateMachine({ initial, transitions, onChange = () => {} }) {
  if (!Object.hasOwn(transitions, initial)) throw new RangeError(`Неизвестное начальное состояние: ${initial}`);
  let state = initial;
  const listeners = new Set([onChange]);
  return {
    get state() { return state; },
    states: Object.keys(transitions),
    can: (next) => next !== state && Boolean(transitions[state]?.includes(next)),
    set(next) {
      if (!this.can(next)) return false;
      const previous = state;
      state = next;
      for (const listener of listeners) listener(next, previous);
      return true;
    },
    /** Принудительно (восстановление состояния с сервера): допускает любой известный переход. */
    force(next) {
      if (!Object.hasOwn(transitions, next) || next === state) return false;
      const previous = state;
      state = next;
      for (const listener of listeners) listener(next, previous);
      return true;
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

/**
 * Общий интерфейс механизма. `root` добавляется в сцену владельцем; update вызывается каждый кадр;
 * dispose снимает root, освобождает только собственные (не общие) геометрии и материалы и повторно безопасен.
 */
export function createAnimatedObject({ id, root, parts = {}, machine, update = () => {}, dispose = () => {}, api = {} }) {
  let disposed = false;
  const object = {
    id,
    root,
    parts,
    machine,
    get state() { return machine?.state ?? 'idle'; },
    get disposed() { return disposed; },
    setState(next) { return machine ? machine.set(next) : false; },
    update(dt, elapsed = 0) { if (!disposed) update(dt, elapsed); },
    dispose() {
      if (disposed) return;
      disposed = true;
      dispose();
      disposeOwned(root);
      root.removeFromParent();
    },
  };
  // Дескрипторы, а не spread: геттеры механизма (progress, passable) должны оставаться живыми.
  Object.defineProperties(object, Object.getOwnPropertyDescriptors(api));
  return object;
}

/** Освобождает всё, что не помечено shared: общие геометрии, материалы и текстуры живут всю сессию. */
export function disposeOwned(root) {
  root.traverse((node) => {
    if (node.geometry && !isSharedResource(node.geometry)) node.geometry.dispose();
    const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    for (const material of materials) {
      if (isSharedResource(material)) continue;
      material.dispose();
    }
    if (node.isInstancedMesh) node.dispose();
  });
}

/** Pivot-группа: точка вращения в pos, дети смещены так, что их локальные координаты остаются исходными. */
export function pivot(parent, [x, y, z], name = '') {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.name = name;
  parent.add(group);
  return group;
}

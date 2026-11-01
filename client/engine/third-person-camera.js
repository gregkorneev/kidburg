// Общая основа вида от третьего лица для города и игровых комнат: камера стоит сзади и выше персонажа.
// Каждая сцена сама задаёт точку фокуса и желаемую позицию камеры, а плечо (расстояние от фокуса до камеры)
// сокращается у препятствий и у земли, поэтому камера не оказывается внутри стен и под полом.

import { approachCameraDistance, safeCameraDistance } from './camera-collision.js';

/** Если плечо короче, камера почти в персонаже: модель на этот кадр скрывается. */
export const MIN_VISIBLE_ARM = 0.9;
const MIN_ARM = 0.12;
const GROUND_PASSES = 8;

/**
 * Желаемая позиция камеры на орбите вокруг фокуса. yaw = 0 смотрит вдоль −Z, +yaw поворачивает налево;
 * pitch > 0 — взгляд вверх (камера опускается), pitch < 0 — взгляд вниз (камера поднимается).
 */
export function orbitCameraGoal(focus, yaw, pitch, distance, out = { x: 0, y: 0, z: 0 }) {
  const horizontal = Math.cos(pitch) * distance;
  out.x = focus.x + Math.sin(yaw) * horizontal;
  out.y = focus.y - Math.sin(pitch) * distance;
  out.z = focus.z + Math.cos(yaw) * horizontal;
  return out;
}

/** Ограничивает плечо `limit` так, чтобы камера оставалась выше земли в своей точке (бисекция по длине). */
function limitByGround(focus, goal, full, limit, groundAt, clearance) {
  const above = (length) => {
    const k = length / full;
    const ground = groundAt(focus.x + (goal.x - focus.x) * k, focus.z + (goal.z - focus.z) * k);
    return !Number.isFinite(ground) || focus.y + (goal.y - focus.y) * k >= ground + clearance;
  };
  if (above(limit)) return limit;
  let low = Math.min(MIN_ARM, limit);
  let high = limit;
  for (let pass = 0; pass < GROUND_PASSES; pass++) {
    const mid = (low + high) / 2;
    if (above(mid)) low = mid;
    else high = mid;
  }
  return low;
}

/**
 * Плечо камеры с памятью: препятствие сокращает его сразу, а свободная камера плавно возвращается к норме.
 * @param {object} options
 * @param {number} options.distance нормальная длина плеча
 * @param {number} [options.radius] радиус «шара» камеры при проверке стен
 * @param {number} [options.clearance] отступ от стены
 * @param {number} [options.returnSpeed] скорость возврата, 1/с
 * @param {number} [options.floorClearance] минимальная высота камеры над землёй
 */
export function createCameraArm({ distance, radius = 0.2, clearance = 0.1, returnSpeed = 4, floorClearance = 0.25 }) {
  let length = distance;
  const position = { x: 0, y: 0, z: 0 };
  return {
    /** Текущая длина плеча. */
    get length() {
      return length;
    },
    /** Мгновенный возврат к нормальной длине (смена сцены, телепорт игрока). */
    reset() {
      length = distance;
    },
    /**
     * @param {{x: number, y: number, z: number}} focus точка на персонаже, куда смотрит камера
     * @param {{x: number, y: number, z: number}} goal желаемая позиция камеры без учёта препятствий
     * @param {object[]} blockers AABB с minX..maxZ
     * @param {number} dt секунды
     * @param {(x: number, z: number) => number | null} [groundAt] высота земли под камерой
     * @returns {{x: number, y: number, z: number}} позиция камеры (объект переиспользуется)
     */
    resolve(focus, goal, blockers, dt, groundAt) {
      const full = Math.hypot(goal.x - focus.x, goal.y - focus.y, goal.z - focus.z);
      let safe = safeCameraDistance(focus, goal, blockers, { radius, clearance });
      if (groundAt && full > 1e-8) safe = limitByGround(focus, goal, full, safe, groundAt, floorClearance);
      length = approachCameraDistance(length, safe, dt, returnSpeed);
      const k = full > 1e-8 ? length / full : 0;
      position.x = focus.x + (goal.x - focus.x) * k;
      position.y = focus.y + (goal.y - focus.y) * k;
      position.z = focus.z + (goal.z - focus.z) * k;
      return position;
    },
  };
}

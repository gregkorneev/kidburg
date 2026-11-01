// Локальный игрок: движение по рельефу с AABB-коллизиями, без физического движка.
// Скорости ниже MAX_SPEED сервера (shared/constants.js), иначе сервер вернёт `correct`.

import { MAX_SPEED, WORLD_SIZE_X, WORLD_SIZE_Z } from '../../shared/constants.js';

export const PLAYER = Object.freeze({
  radius: 0.4,
  height: 1.8,
  eyeHeight: 1.6,
  walkSpeed: 5,
  runSpeed: 8,
  maxStep: 0.1, // самый длинный шаг по времени, с: после паузы игрок не телепортируется
});

if (PLAYER.runSpeed >= MAX_SPEED) throw new Error('runSpeed должен быть меньше MAX_SPEED');

const EDGE = 0.001;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Пересекает ли круг игрока (x, z) в диапазоне высот [y, y + height] какую-нибудь коробку. */
export function collides(boxes, x, y, z) {
  const r = PLAYER.radius;
  for (const b of boxes) {
    if (b.rotationY && Number.isFinite(b.halfWidth) && Number.isFinite(b.halfDepth)) {
      if (y >= b.maxY || y + PLAYER.height <= b.minY) continue;
      const dx = x - b.x;
      const dz = z - b.z;
      const cos = Math.cos(b.rotationY);
      const sin = Math.sin(b.rotationY);
      const localX = cos * dx - sin * dz;
      const localZ = sin * dx + cos * dz;
      const nearestX = Math.max(-b.halfWidth, Math.min(b.halfWidth, localX));
      const nearestZ = Math.max(-b.halfDepth, Math.min(b.halfDepth, localZ));
      if (Math.hypot(localX - nearestX, localZ - nearestZ) < r) return true;
      continue;
    }
    if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r && y < b.maxY && y + PLAYER.height > b.minY) {
      return true;
    }
  }
  return false;
}

function collisionDepth(boxes, x, y, z) {
  let depth = 0;
  const r = PLAYER.radius;
  for (const b of boxes) {
    if (y >= b.maxY || y + PLAYER.height <= b.minY) continue;
    let localX = x - (b.minX + b.maxX) / 2;
    let localZ = z - (b.minZ + b.maxZ) / 2;
    let halfWidth = (b.maxX - b.minX) / 2;
    let halfDepth = (b.maxZ - b.minZ) / 2;
    if (b.rotationY && Number.isFinite(b.halfWidth) && Number.isFinite(b.halfDepth)) {
      const dx = x - b.x;
      const dz = z - b.z;
      const cos = Math.cos(b.rotationY);
      const sin = Math.sin(b.rotationY);
      localX = cos * dx - sin * dz;
      localZ = sin * dx + cos * dz;
      halfWidth = b.halfWidth;
      halfDepth = b.halfDepth;
    }
    const overlapX = r + halfWidth - Math.abs(localX);
    const overlapZ = r + halfDepth - Math.abs(localZ);
    if (overlapX > 0 && overlapZ > 0) depth += Math.min(overlapX, overlapZ);
  }
  return depth;
}

export function createPlayer() {
  return { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, moving: false, running: false };
}

export function setPlayerPosition(player, x, y, z) {
  player.x = clamp(x, 0, WORLD_SIZE_X - EDGE);
  player.y = y;
  player.z = clamp(z, 0, WORLD_SIZE_Z - EDGE);
}

/**
 * Один шаг движения.
 * @param {ReturnType<createPlayer>} player
 * @param {{forward: boolean, back: boolean, left: boolean, right: boolean, run: boolean}} keys
 * @param {number} dt секунды
 * @param {{heightAt(x: number, z: number): number | null, collidersNear(x: number, z: number): object[]}} world
 */
export function stepPlayer(player, keys, dt, world) {
  const step = Math.min(dt, PLAYER.maxStep);
  const forward = Number(keys.forward) - Number(keys.back);
  const strafe = Number(keys.right) - Number(keys.left);
  player.moving = forward !== 0 || strafe !== 0;
  player.running = player.moving && keys.run;

  if (player.moving) {
    // yaw = 0 смотрит вдоль -Z (как камера three.js), +yaw поворачивает налево.
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    let dx = -sin * forward + cos * strafe;
    let dz = -cos * forward - sin * strafe;
    const len = Math.hypot(dx, dz);
    const speed = (player.running ? PLAYER.runSpeed : PLAYER.walkSpeed) * step;
    dx = (dx / len) * speed;
    dz = (dz / len) * speed;

    const boxes = world.collidersNear(player.x, player.z);
    // По осям раздельно: упираясь в стену, игрок скользит вдоль неё.
    const nx = clamp(player.x + dx, 0, WORLD_SIZE_X - EDGE);
    if (!collides(boxes, nx, player.y, player.z)) player.x = nx;
    // Сохранённая позиция может пересекать новый коллайдер: разрешаем только шаг наружу.
    else if (collides(boxes, player.x, player.y, player.z)
      && collisionDepth(boxes, nx, player.y, player.z) < collisionDepth(boxes, player.x, player.y, player.z)) player.x = nx;
    const nz = clamp(player.z + dz, 0, WORLD_SIZE_Z - EDGE);
    if (!collides(boxes, player.x, player.y, nz)) player.z = nz;
    else if (collides(boxes, player.x, player.y, player.z)
      && collisionDepth(boxes, player.x, player.y, nz) < collisionDepth(boxes, player.x, player.y, player.z)) player.z = nz;
  }

  const ground = world.heightAt(player.x, player.z);
  if (ground !== null) player.y = ground;
}

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
    if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r && y < b.maxY && y + PLAYER.height > b.minY) {
      return true;
    }
  }
  return false;
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
    const nz = clamp(player.z + dz, 0, WORLD_SIZE_Z - EDGE);
    if (!collides(boxes, player.x, player.y, nz)) player.z = nz;
  }

  const ground = world.heightAt(player.x, player.z);
  if (ground !== null) player.y = ground;
}

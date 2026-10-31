import { SPAWN } from '../../shared/constants.js';
import { ROUTES } from '../../client/engine/plaza-plan.js';

// New arrivals stand on the clear route spokes around the fountain. Using the
// authored plaza routes keeps these positions aligned with the walkable plan.
const SPAWN_RADII = [10, 14];
const MIN_SPAWN_DISTANCE = 3.5;

export const SPAWN_CANDIDATES = Object.freeze(SPAWN_RADII.flatMap((radius) => ROUTES.map((route) => Object.freeze({
  x: SPAWN.x + Math.cos(route.angle) * radius,
  y: SPAWN.y,
  z: SPAWN.z + Math.sin(route.angle) * radius,
  ry: Math.atan2(-Math.cos(route.angle), -Math.sin(route.angle)),
}))));

/** Pick the first safe authored spot that is not occupied by an active player. */
export function chooseSpawn(occupied) {
  if (occupied.length === 0) return SPAWN;
  return SPAWN_CANDIDATES.find((candidate) => occupied.every((player) =>
    Math.hypot(candidate.x - player.x, candidate.z - player.z) >= MIN_SPAWN_DISTANCE)) ?? SPAWN;
}

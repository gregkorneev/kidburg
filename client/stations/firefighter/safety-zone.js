// Footprint of the training wall and its restricted area, including the marked front line.
// Координаты локальные (layout.js); сервер переводит позицию игрока в них перед проверкой.
export const SAFETY_ZONE = Object.freeze({ minX: -0.5, maxX: 7.5, minZ: 0.9, maxZ: 6.0 });
export const PLAYER_RADIUS = 0.4;

export function insideSafetyZone(x, z, radius = PLAYER_RADIUS) {
  return x + radius > SAFETY_ZONE.minX && x - radius < SAFETY_ZONE.maxX
    && z + radius > SAFETY_ZONE.minZ && z - radius < SAFETY_ZONE.maxZ;
}

export function blockedBySafetyZone(stage, x, z) {
  return stage === 'fire_drill' && insideSafetyZone(x, z);
}

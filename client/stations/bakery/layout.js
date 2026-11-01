// План локальной пекарни. Координаты сцены отделены от Three.js, чтобы проходы
// и зоны взаимодействия можно было проверять обычными unit-тестами.
export const ROOM = Object.freeze({ minX: -8.5, maxX: 8.5, minZ: -6.5, maxZ: 6.5, wallHeight: 5.6 });
// Игрок появляется у входа, но с запасом места для камеры за плечом.
export const SPAWN = Object.freeze({ x: 0, z: 4.25 });
export const PLAYER_RADIUS = 0.34;

export const ZONES = Object.freeze([
  Object.freeze({ id: 'mentor', label: 'Получить заказ у пекаря', x: -6.0, z: 4.15, radius: 1.3, action: 'get_order' }),
  Object.freeze({ id: 'ingredients', label: 'Подготовить ингредиенты', x: -4.0, z: 0.5, radius: 1.25, action: 'prepare_ingredients' }),
  Object.freeze({ id: 'worktable', label: 'Сформовать изделие', x: 0, z: -2.55, radius: 1.25, action: 'shape_product' }),
  Object.freeze({ id: 'oven', label: 'Использовать закрытую печь', x: 5, z: 0.45, radius: 1.25, action: 'use_oven' }),
  Object.freeze({ id: 'cooling_rack', label: 'Забрать готовое изделие', x: 3.0, z: 3.7, radius: 1.25, action: 'collect_product' }),
  Object.freeze({ id: 'delivery', label: 'Сдать заказ пекарю', x: -2.2, z: 4.0, radius: 1.25, action: 'deliver_order' }),
]);

// Мебельные границы используются одновременно для движения и тестов плана.
export const OBSTACLES = Object.freeze([
  Object.freeze({ id: 'ingredient-counter', minX: -7.35, maxX: -5.05, minZ: -0.1, maxZ: 1.15 }),
  Object.freeze({ id: 'worktable', minX: -1.65, maxX: 1.65, minZ: -5.25, maxZ: -4.0 }),
  Object.freeze({ id: 'oven', minX: 3.8, maxX: 6.2, minZ: -1.85, maxZ: -0.45 }),
  Object.freeze({ id: 'cooling-rack', minX: 4.0, maxX: 6.2, minZ: 4.05, maxZ: 5.55 }),
  Object.freeze({ id: 'delivery-counter', minX: -4.8, maxX: -2.0, minZ: 5.15, maxZ: 6.25 }),
  Object.freeze({ id: 'mentor-stand', minX: -7.15, maxX: -5.4, minZ: 2.2, maxZ: 2.75 }),
]);

export const WALK_WAYPOINTS = Object.freeze([
  Object.freeze({ x: 0, z: 4.8 }), Object.freeze({ x: -3.1, z: 4.8 }),
  Object.freeze({ x: -4.0, z: 2.1 }), Object.freeze({ x: -2.1, z: 0.1 }),
  Object.freeze({ x: 0, z: -1.0 }), Object.freeze({ x: 2.5, z: -1.0 }),
  Object.freeze({ x: 3.1, z: 2.1 }), Object.freeze({ x: 1.3, z: 3.8 }),
]);

export function isInsideRoom(x, z, margin = PLAYER_RADIUS) {
  return x >= ROOM.minX + margin && x <= ROOM.maxX - margin
    && z >= ROOM.minZ + margin && z <= ROOM.maxZ - margin;
}

export function collidesWithFurniture(x, z, margin = PLAYER_RADIUS) {
  return OBSTACLES.some((box) => x + margin > box.minX && x - margin < box.maxX
    && z + margin > box.minZ && z - margin < box.maxZ);
}

export function isWalkable(x, z) {
  return isInsideRoom(x, z) && !collidesWithFurniture(x, z);
}

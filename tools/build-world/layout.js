// Компактная согласованная планировка городского хаба.
// Изменение расстояний внутри роли 1; серверные константы и SPAWN не изменяются.
export const CITY_LAYOUT_STATUS = 'DRAFT_NEEDS_APPROVAL';
export const CITY_CENTER = Object.freeze({ x: 416, z: 416 });
export const PLAZA = Object.freeze({ x: 416, z: 416, width: 44, depth: 44 });

// Центры зданий, габариты и ориентация фасадов в мировых метрах.
export const BUILDINGS = Object.freeze([
  Object.freeze({ id: 'city_hall', name: 'Мэрия', x: 416, z: 387, width: 22, depth: 14, rotationY: 0 }),
  Object.freeze({ id: 'fire_station', name: 'Пожарная часть', x: 382, z: 412, width: 24, depth: 16, rotationY: Math.PI / 2 }),
  Object.freeze({ id: 'bakery', name: 'Пекарня', x: 450, z: 412, width: 18, depth: 14, rotationY: -Math.PI / 2 }),
  Object.freeze({ id: 'flower_shop', name: 'Цветочная лавка', x: 384, z: 449, width: 18, depth: 14, rotationY: Math.PI / 2 }),
  Object.freeze({ id: 'music_school', name: 'Музыкальная школа', x: 416, z: 456, width: 22, depth: 14, rotationY: Math.PI }),
  Object.freeze({ id: 'radio_station', name: 'Радиостанция', x: 448, z: 449, width: 18, depth: 14, rotationY: -Math.PI / 2 }),
]);

// Небольшие пешеходные сегменты от площади к фасадам.
export const PATHS = Object.freeze([
  Object.freeze({ id: 'north', x: 416, z: 400, width: 8, depth: 12 }),
  Object.freeze({ id: 'west', x: 395, z: 416, width: 2, depth: 8 }),
  Object.freeze({ id: 'east', x: 439.5, z: 416, width: 3, depth: 8 }),
  Object.freeze({ id: 'south', x: 416, z: 443, width: 8, depth: 12 }),
  Object.freeze({ id: 'south_west', x: 405, z: 440, width: 22, depth: 4 }),
  Object.freeze({ id: 'south_east', x: 427, z: 440, width: 22, depth: 4 }),
]);

export function boundsOf({ x, z, width, depth }) {
  return { minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 };
}
export function overlaps(a, b) {
  const aa = boundsOf(a);
  const bb = boundsOf(b);
  return aa.minX < bb.maxX && aa.maxX > bb.minX && aa.minZ < bb.maxZ && aa.maxZ > bb.minZ;
}
export function chunkOf(x, z, chunkSize = 64) {
  return { cx: Math.floor(x / chunkSize), cz: Math.floor(z / chunkSize) };
}

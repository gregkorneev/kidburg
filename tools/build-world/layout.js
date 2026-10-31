// Предварительная схема компактного города для согласования с руководителем.
// Координаты мировые, в метрах. Не изменяет сервер или формат чанков.
// Точка SPAWN (416, 416) берётся из текущих shared/constants.js.

export const CITY_LAYOUT_STATUS = 'DRAFT_NEEDS_APPROVAL';
export const CITY_CENTER = Object.freeze({ x: 416, z: 416 });
export const PLAZA = Object.freeze({ x: 416, z: 416, width: 44, depth: 44 });

// x, z — центры зданий; width/depth — пятно застройки.
// rotationY — предполагаемая ориентация главного фасада (радианы).
export const BUILDINGS = Object.freeze([
  Object.freeze({ id: 'city_hall', name: 'Мэрия', x: 416, z: 377, width: 22, depth: 14, rotationY: 0 }),
  Object.freeze({ id: 'fire_station', name: 'Пожарная часть', x: 367, z: 412, width: 24, depth: 16, rotationY: Math.PI / 2 }),
  Object.freeze({ id: 'bakery', name: 'Пекарня', x: 465, z: 412, width: 18, depth: 14, rotationY: -Math.PI / 2 }),
  Object.freeze({ id: 'flower_shop', name: 'Цветочная лавка', x: 369, z: 472, width: 18, depth: 14, rotationY: Math.PI / 2 }),
  Object.freeze({ id: 'music_school', name: 'Музыкальная школа', x: 416, z: 480, width: 22, depth: 14, rotationY: Math.PI }),
  Object.freeze({ id: 'radio_station', name: 'Радиостанция', x: 466, z: 472, width: 18, depth: 14, rotationY: -Math.PI / 2 }),
]);

export const PATHS = Object.freeze([
  Object.freeze({ id: 'north', x: 416, z: 402, width: 8, depth: 30 }),
  Object.freeze({ id: 'west', x: 395, z: 416, width: 30, depth: 8 }),
  Object.freeze({ id: 'east', x: 440, z: 416, width: 30, depth: 8 }),
  Object.freeze({ id: 'south', x: 416, z: 446, width: 8, depth: 48 }),
  Object.freeze({ id: 'south_west', x: 392, z: 472, width: 24, depth: 8 }),
  Object.freeze({ id: 'south_east', x: 441, z: 472, width: 26, depth: 8 }),
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

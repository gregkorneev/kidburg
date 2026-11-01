// Входные двери зданий центрального города. Один источник правды для сервера (дальность клавиши E, mech_set),
// клиента (геометрия подвижных створок, подсказки) и тестов. Статическая коробка здания (рама, проём, ступень) остаётся
// в слитой геометрии префаба; створки с ручками — отдельные подвижные детали (client/engine/mechanisms/door.js).
// Координаты `local` — в системе здания: ось Z выходит наружу, к фасаду; `y` — центр створок по высоте.
import { BUILDINGS } from '../tools/build-world/layout.js';

/** Время полного открытия/закрытия створок (с). */
export const DOOR_DURATION_S = 0.9;
/** Дальность клавиши E до точки перед дверью (м) и запас сервера на запаздывание позиции. */
export const DOOR_REACH = 4.2;
/** Через сколько секунд открытая дверь без интерьера закрывается сама (двери с переходом закрывать не нужно). */
export const DOOR_AUTO_CLOSE_S = 12;
/** Насколько дальше порога стоит игрок, нажимающий E (м, по нормали к фасаду). */
const FRONT_OFFSET = 1.4;

/**
 * id — идентификатор механизма (shared/mechanisms.js); building — id здания в tools/build-world/layout.js.
 * href — страница интерьера: если есть, после открытия двери выполняется переход; иначе дверь только открывается.
 */
export const DOOR_SPECS = Object.freeze([
  Object.freeze({ id: 'door-city-hall', building: 'city_hall', label: 'городскую мэрию', local: Object.freeze({ x: 0, y: 3.4, z: 5.2, w: 2.9, h: 3.1 }), leaf: 0x6a3f2b, glass: null, handle: 0xe3b95c, href: '/' }),
  Object.freeze({ id: 'door-fire', building: 'fire_station', label: 'пожарную часть', local: Object.freeze({ x: 7.72, y: 2.4, z: 6.75, w: 2.2, h: 3.1 }), leaf: 0x438266, glass: 0x86bccd, handle: 0xf0c85f, href: '/firefighter-preview.html' }),
  Object.freeze({ id: 'door-bakery', building: 'bakery', label: 'пекарню', local: Object.freeze({ x: 0, y: 2.35, z: 6.5, w: 2.5, h: 3.4 }), leaf: 0x9b6748, glass: 0x8cc3c9, handle: 0xedbc61, href: '/bakery-preview.html' }),
  Object.freeze({ id: 'door-florist', building: 'flower_shop', label: 'цветочную лавку', local: Object.freeze({ x: 0, y: 2.3, z: 4.55, w: 1.9, h: 3.0 }), leaf: 0x6d9a7b, glass: 0xa6cfd6, handle: 0xf0cd67, href: '/florist-preview.html' }),
  Object.freeze({ id: 'door-music-school', building: 'music_school', label: 'музыкальную школу', local: Object.freeze({ x: 0, y: 2.7, z: 5.1, w: 2.5, h: 3.3 }), leaf: 0x466d86, glass: 0x8fc3d6, handle: 0xe4bb5e, href: '/musician-preview.html' }),
  Object.freeze({ id: 'door-radio', building: 'radio_station', label: 'радиостанцию', local: Object.freeze({ x: 0, y: 2.4, z: 5.65, w: 2.4, h: 3.2 }), leaf: 0x3a6872, glass: 0x86c2d2, handle: 0xf0c85f, href: '/radio-preview.html' }),
]);

export const DOOR_IDS = Object.freeze(DOOR_SPECS.map((d) => d.id));
export const doorSpec = (id) => DOOR_SPECS.find((d) => d.id === id) ?? null;

/** Мировая точка из координат здания (поворот rotationY: x' = x·cos + z·sin; z' = −x·sin + z·cos). */
export function buildingToWorld(building, x, z) {
  const c = Math.cos(building.rotationY);
  const s = Math.sin(building.rotationY);
  return { x: building.x + x * c + z * s, z: building.z - x * s + z * c };
}

/** Мировая позиция «перед дверью», от которой считается дальность E. */
export function doorWorldPoint(spec) {
  const building = BUILDINGS.find((b) => b.id === spec.building);
  if (!building) throw new Error(`Нет здания ${spec.building}`);
  return { ...buildingToWorld(building, spec.local.x, spec.local.z + FRONT_OFFSET), rotationY: building.rotationY };
}

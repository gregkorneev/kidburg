// Игровые механизмы с общим состоянием для всех игроков: ворота пожарной части и лестница учебной пожарной машины.
// Сервер хранит для каждого механизма цель (active) и момент последнего переключения; клиент получает цель и «возраст»
// перехода в миллисекундах и сам доигрывает анимацию — позиции створок и ступеней по сети не передаются.
// Координаты — мировые (метры). Учебная локация сдвинута относительно мира так же, как в client/stations/firefighter/layout.js.
import { SPAWN } from './constants.js';
import { DOOR_AUTO_CLOSE_S, DOOR_DURATION_S, DOOR_REACH, DOOR_SPECS, doorWorldPoint } from './doors.js';

const TRAINING_START_Z = 13.25; // START.z учебной локации (layout.js): точка появления игрока
const training = (x, z) => Object.freeze({ x: x + SPAWN.x, z: z + SPAWN.z - TRAINING_START_Z });

/** type: gate — ворота (active = открыты), ladder — лестница машины (active = выдвинута), door — входная дверь здания. radius — дальность клавиши E. */
const TABLE = {
  // Здание станции в городе: центр (382, 412), поворот π/2; плоскость секций — локально z = 7.12, x = −5.5 и 1.15.
  'fire-city-gate-0': Object.freeze({ type: 'gate', duration: 2.6, x: 389.12, z: 417.5, radius: 3.4 }),
  'fire-city-gate-1': Object.freeze({ type: 'gate', duration: 2.6, x: 389.12, z: 410.85, radius: 3.4 }),
  // Учебная станция стоит в (−9, −4); ворота в стене z = 4.5, секции на 0.08 впереди.
  'fire-yard-gate-0': Object.freeze({ type: 'gate', duration: 2.6, ...training(-12.7, 0.58), radius: 3 }),
  'fire-yard-gate-1': Object.freeze({ type: 'gate', duration: 2.6, ...training(-8.6, 0.58), radius: 3 }),
  'fire-truck-ladder': Object.freeze({ type: 'ladder', duration: 4, ...training(5.7, -4.4), radius: 3.6 }),
};

// Двери зданий города (shared/doors.js): autoCloseS — сервер закрывает дверь, которую оставили открытой.
for (const spec of DOOR_SPECS) {
  const { x, z } = doorWorldPoint(spec);
  TABLE[spec.id] = Object.freeze({ type: 'door', duration: DOOR_DURATION_S, x, z, radius: DOOR_REACH, autoCloseS: DOOR_AUTO_CLOSE_S });
}

export const MECHANISMS = Object.freeze(TABLE);
export const MECHANISM_IDS = Object.freeze(Object.keys(MECHANISMS));
export const isMechanismId = (id) => typeof id === 'string' && Object.hasOwn(MECHANISMS, id);
/** Запас к радиусу на стороне сервера: позиция игрока на сервере отстаёт на кадр-другой. */
export const MECHANISM_REACH_MARGIN = 2.5;

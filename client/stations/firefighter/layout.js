// Канонические точки пожарной станции. Единственный источник для сцены (scene.js),
// сетевого слоя (network.js) и сервера (server/tasks): без three.js и DOM.
//
// Системы координат:
//   локальная — полигон preview, начало (0, 0), ось Y вверх, земля y = 0;
//   мировая   — координаты сервера (мир 768 × 768 м), в них хранятся позиции игроков.
// Преобразование — только сдвиг по X и Z (без поворота и масштаба):
//   world = local + FIRE_ORIGIN. Начало подобрано так, что точка появления нового игрока
//   SPAWN попадает в стартовую точку полигона START.

import { SPAWN } from '../../../shared/constants.js';

export const START = Object.freeze({ x: 0, z: 13.25 });
export const FIRE_ORIGIN = Object.freeze({ x: SPAWN.x - START.x, z: SPAWN.z - START.z });

export const toWorld = (x, z) => ({ x: x + FIRE_ORIGIN.x, z: z + FIRE_ORIGIN.z });
export const toLocal = (x, z) => ({ x: x - FIRE_ORIGIN.x, z: z - FIRE_ORIGIN.z });

/** Длина рукава: дальше этого расстояния от стойки игрок с рукавом не отходит (м). Клиент и сервер используют одно значение. */
export const HOSE_REACH = 10;
/** Допуск сервера к радиусам клиента: позиция на сервере отстаёт на кадр-другой (м). */
export const SERVER_MARGIN = 1;
/** Допуск по высоте: сервер проверяет расстояние по земле, высота нужна лишь против «взлёта» (м). */
export const VERTICAL_TOLERANCE = 4;

/** Точки в локальных координатах; radius — дальность взаимодействия на клиенте (м). */
export const LOCAL_POINTS = Object.freeze({
  npc: Object.freeze({ x: -3, z: 2.1, radius: 2.8 }),
  locker: Object.freeze({ x: -7.6, z: 2.3, radius: 2.5 }),
  hose: Object.freeze({ x: -0.9, z: 7.4, radius: HOSE_REACH }),
  mannequin: Object.freeze({ x: 8.2, z: 10.1, radius: 2.4 }),
  safe_zone: Object.freeze({ x: 9.2, z: 5.1, radius: 2.6 }),
});

/** Центр учебной стены с четырьмя окнами (локальные координаты). Стена обращена к игроку стороной +Z. */
export const WALL = Object.freeze({ x: 3.5, z: 3.2 });
/** Толщина облицовки: окна лежат на этом расстоянии от плоскости стены к игроку (м). */
export const WINDOW_DEPTH = 0.4;
/** Расстояние от центра стены до центра окна по X (м) и высота рядов (м). */
export const WINDOW_OFFSET_X = 1.65;
export const WINDOW_ROWS = Object.freeze([2, 4.8]);

/** Центры окон 0..3 в локальных координатах: индекс чётный — левое окно, ряд = индекс >> 1. */
export const LOCAL_WINDOWS = Object.freeze(
  [0, 1, 2, 3].map((index) =>
    Object.freeze({
      x: WALL.x + (index % 2 ? WINDOW_OFFSET_X : -WINDOW_OFFSET_X),
      y: WINDOW_ROWS[index >> 1],
      z: WALL.z + WINDOW_DEPTH,
    }),
  ),
);

/** Те же точки в мировых координатах; radius расширен на SERVER_MARGIN. */
export const WORLD_POINTS = Object.freeze(
  Object.fromEntries(
    Object.entries(LOCAL_POINTS).map(([name, p]) => {
      const { x, z } = toWorld(p.x, p.z);
      return [name, Object.freeze({ x, y: 0, z, radius: p.radius > 0 ? p.radius + SERVER_MARGIN : 0 })];
    }),
  ),
);

/** Окна в мировых координатах: сервер проверяет направление взгляда игрока на окно с заданным индексом. */
export const WORLD_WINDOWS = Object.freeze(
  LOCAL_WINDOWS.map((w) => {
    const { x, z } = toWorld(w.x, w.z);
    return Object.freeze({ x, y: w.y, z });
  }),
);

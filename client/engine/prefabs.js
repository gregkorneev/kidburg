// Префабы игрового мира. ID 1–5 совместимы со старыми тестовыми чанками;
// ID 10–15, 20–21 соответствуют tools/build-world/index.js.
// На данном этапе здания — цветные объёмы. Детализированные фасады потребуют
// расширения клиентского рендеринга (не сетевого формата).
import * as THREE from 'three';
import { buildFireStationGeometry } from './fire-station.js';
import { buildCityHallGeometry } from './procedural-city.js';

const box = (w, h, d) => () => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);

const PREFABS = {
  1: { name: 'tree', color: 0x6f9b68, collider: [1, 6, 1], build: () => new THREE.ConeGeometry(1.4, 6, 6).translate(0, 3, 0) },
  2: { name: 'bench', color: 0xb57d4f, collider: [2, 1, 1], build: box(2, 1, 1) },
  3: { name: 'lamp', color: 0xf0c85f, collider: [0.5, 4, 0.5], build: box(0.4, 4, 0.4) },
  4: { name: 'bed', color: 0xdfe7ee, collider: [1, 1, 2], build: box(1, 1, 2) },
  5: { name: 'cabinet', color: 0xb9c4cf, collider: [1, 2, 1], build: box(1, 2, 1) },
  10: { name: 'city_hall', color: 0xffffff, vertexColors: true, collider: [22, 9, 14], build: buildCityHallGeometry },
  11: { name: 'fire_station', color: 0xffffff, vertexColors: true, collider: [24, 9, 16], build: buildFireStationGeometry },
  12: { name: 'bakery', color: 0xf0c85f, collider: [18, 9, 14], build: box(18, 9, 14) },
  13: { name: 'flower_shop', color: 0x83aa70, collider: [18, 9, 14], build: box(18, 9, 14) },
  14: { name: 'music_school', color: 0x6ca4ac, collider: [22, 9, 14], build: box(22, 9, 14) },
  15: { name: 'radio_station', color: 0xb57d4f, collider: [18, 9, 14], build: box(18, 9, 14) },
  20: { name: 'city_plaza', color: 0xe8d4a3, collider: null, build: box(44, 0.05, 44) },
  // Все дорожки сейчас имеют один ID, хотя их размеры различаются.
  // Этот временный объём 8×8 будет заменён размерными префабами.
  21: { name: 'city_path', color: 0xe8d4a3, collider: null, build: box(8, 0.05, 8) },
};

const FALLBACK = { name: 'unknown', color: 0x888888, collider: null, build: box(1, 1, 1) };

export function getPrefab(id) {
  return PREFABS[id] ?? FALLBACK;
}

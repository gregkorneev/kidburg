// Префабы игрового мира. ID 1–5 совместимы со старыми тестовыми чанками;
// ID 10–15, 20–21 соответствуют tools/build-world/index.js.
// Все городские префабы — одна вершинно-окрашенная геометрия (art/prefab-kit.js) для InstancedMesh.
// Некоторые ID имеют варианты (деревья, дорожки): вариант выбирается по положению инстанса, формат чанка не меняется.
// Поле decorate (необязательно) создаёт «живой» декор рядом с инстансом (вывески, вода, ветер) — см. city-decor.js.
import * as THREE from 'three';
import { TREE_BUILDERS, TREE_VARIANTS, buildBenchPrefab, buildLampPrefab } from './art/flora.js';
import { buildBakeryGeometry } from './bakery.js';
import { BAKERY_SIGNS } from './bakery.js';
import { buildCityPlazaGeometry } from './city-plaza.js';
import { buildPathGeometry, pathIdAt } from './city-paths.js';
import { createSignDecor, decoratePlaza } from './city-decor.js';
import { FIRE_STATION_SIGNS, buildFireStationGeometry } from './fire-station.js';
import { FLOWER_SHOP_SIGNS, buildFlowerShopGeometry } from './flower-shop.js';
import { MUSIC_SCHOOL_SIGNS, buildMusicSchoolGeometry } from './music-school.js';
import { CITY_HALL_SIGNS, buildCityHallGeometry } from './procedural-city.js';
import { RADIO_STATION_SIGNS, buildRadioStationGeometry } from './radio-station.js';
import { PATHS } from '../../tools/build-world/layout.js';
import { plazaCollisionBoxes } from './plaza-plan.js';

const box = (w, h, d) => () => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);

const PREFABS = {
  1: { name: 'tree', color: 0xffffff, vertexColors: true, collider: [1, 6, 1], build: TREE_BUILDERS.round, variantOf: (x, z) => TREE_VARIANTS[Math.abs(Math.floor(x * 7.3 + z * 3.1)) % TREE_VARIANTS.length], buildVariant: (variant) => TREE_BUILDERS[variant] },
  2: { name: 'bench', color: 0xffffff, vertexColors: true, collider: [2, 1, 1], build: buildBenchPrefab },
  3: { name: 'lamp', color: 0xffffff, vertexColors: true, collider: [0.5, 4, 0.5], build: buildLampPrefab },
  4: { name: 'bed', color: 0xdfe7ee, collider: [1, 1, 2], build: box(1, 1, 2) },
  5: { name: 'cabinet', color: 0xb9c4cf, collider: [1, 2, 1], build: box(1, 2, 1) },
  10: { name: 'city_hall', color: 0xffffff, vertexColors: true, collider: [22, 9, 14], build: buildCityHallGeometry, decorate: createSignDecor(CITY_HALL_SIGNS) },
  11: { name: 'fire_station', color: 0xffffff, vertexColors: true, collider: [24, 9, 16], build: buildFireStationGeometry, decorate: createSignDecor(FIRE_STATION_SIGNS) },
  12: { name: 'bakery', color: 0xffffff, vertexColors: true, collider: [18, 9, 14], build: buildBakeryGeometry, decorate: createSignDecor(BAKERY_SIGNS) },
  13: { name: 'flower_shop', color: 0xffffff, vertexColors: true, collider: [18, 9, 14], build: buildFlowerShopGeometry, decorate: createSignDecor(FLOWER_SHOP_SIGNS) },
  14: { name: 'music_school', color: 0xffffff, vertexColors: true, collider: [22, 9, 14], build: buildMusicSchoolGeometry, decorate: createSignDecor(MUSIC_SCHOOL_SIGNS) },
  15: { name: 'radio_station', color: 0xffffff, vertexColors: true, collider: [18, 9, 14], build: buildRadioStationGeometry, decorate: createSignDecor(RADIO_STATION_SIGNS) },
  20: { name: 'city_plaza', color: 0xffffff, vertexColors: true, collider: null, colliders: plazaCollisionBoxes, build: buildCityPlazaGeometry, decorate: decoratePlaza },
  // Все дорожки в мире имеют один ID; размеры берутся из PATHS по положению инстанса (city-paths.js).
  21: {
    name: 'city_path', color: 0xe8d4a3, vertexColors: true, collider: null,
    build: () => buildPathGeometry({ width: 8, depth: 8 }),
    variantOf: (x, z) => pathIdAt(x, z),
    buildVariant: (variant) => () => buildPathGeometry(PATHS.find((p) => p.id === variant)),
  },
};

const FALLBACK = { name: 'unknown', color: 0x888888, collider: null, build: box(1, 1, 1) };

export function getPrefab(id) {
  return PREFABS[id] ?? FALLBACK;
}

/** Ключ варианта инстанса (строка) или '' для префабов без вариантов. */
export function variantKey(id, x, z) {
  const prefab = PREFABS[id];
  return prefab?.variantOf?.(x, z) ?? '';
}

/** Префаб с учётом варианта: build возвращает геометрию именно этого варианта. */
export function getPrefabVariant(id, variant) {
  const prefab = getPrefab(id);
  if (!variant || !prefab.buildVariant) return prefab;
  return { ...prefab, build: prefab.buildVariant(variant) };
}

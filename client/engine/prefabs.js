// Библиотека префабов. Локальных моделей в assets/ пока нет, поэтому каждый префаб —
// лёгкая процедурная заглушка. world.json клиенту не раздаётся, поэтому id (см. tools/fixtures)
// и размеры коллайдеров перечислены здесь; неизвестный id рисуется серым кубом без коллизии.
// Чтобы подключить настоящую модель позже, достаточно заменить `build` у нужного префаба.

import * as THREE from 'three';

/**
 * @typedef {Object} Prefab
 * @property {string} name
 * @property {number} color
 * @property {[number, number, number] | null} collider размер AABB [ширина, высота, глубина] в метрах
 * @property {() => THREE.BufferGeometry} build геометрия с основанием в y = 0
 */

const box = (w, h, d) => () => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);

/** @type {Record<number, Prefab>} */
const PREFABS = {
  1: { name: 'tree', color: 0x2f7d3a, collider: [1, 6, 1], build: () => new THREE.ConeGeometry(1.4, 6, 6).translate(0, 3, 0) },
  2: { name: 'bench', color: 0x8a5a2b, collider: [2, 1, 1], build: box(2, 1, 1) },
  3: { name: 'lamp', color: 0xe8e2b0, collider: [0.5, 4, 0.5], build: box(0.4, 4, 0.4) },
  4: { name: 'bed', color: 0xdfe7ee, collider: [1, 1, 2], build: box(1, 1, 2) },
  5: { name: 'cabinet', color: 0xb9c4cf, collider: [1, 2, 1], build: box(1, 2, 1) },
};

const FALLBACK = { name: 'unknown', color: 0x888888, collider: null, build: box(1, 1, 1) };

export function getPrefab(id) {
  return PREFABS[id] ?? FALLBACK;
}

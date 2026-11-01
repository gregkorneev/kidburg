// Геометрия разрешённых типов динамических объектов (shared/world-objects.js). Тип приходит с сервера по имени из
// фиксированного списка; путей к файлам и кода клиент от сервера не принимает. Всё строится процедурно из того же
// конструктора, что и остальные префабы, поэтому выглядит как остальной мир.
import { WORLD_OBJECT_TYPES } from '../../shared/world-objects.js';
import { createPrefabKit } from './art/prefab-kit.js';
import {
  FLORA_COLORS,
  TREE_BUILDERS,
  buildBenchPrefab,
  buildLampPrefab,
  bush,
  infoStand,
  roundBed,
  rock,
} from './art/flora.js';

const solo = (fn, options) => {
  const kit = createPrefabKit({ seed: 7 });
  fn(kit);
  return kit.build(options);
};

function buildCrate() {
  const { wood, woodDark } = FLORA_COLORS;
  return solo((k) => {
    k.box(0.96, 0.94, 0.96, 0, 0.5, 0, wood, { r: 0.05 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.1, 1.0, 0.1, sx * 0.46, 0.5, sz * 0.46, woodDark);
    for (const y of [0.22, 0.78]) {
      k.box(1.02, 0.1, 1.02, 0, y, 0, woodDark, { r: 0.02 });
    }
  });
}

/**
 * type -> { key(params): ключ общей геометрии, build(params): THREE.BufferGeometry }.
 * Параметры, которые не меняют форму (текст таблички), в ключ не входят.
 */
export const DYNAMIC_TYPES = Object.freeze({
  tree: { key: (p) => p.variant, build: (p) => (TREE_BUILDERS[p.variant] ?? TREE_BUILDERS.round)() },
  bush: { key: (p) => String(p.tone), build: (p) => solo((k) => bush(k, 0, 0, 1, p.tone)) },
  bench: { key: () => '', build: buildBenchPrefab },
  lamp: { key: () => '', build: buildLampPrefab },
  rock: { key: (p) => String(p.tone), build: (p) => solo((k) => rock(k, 0, 0, 1.3, p.tone)) },
  flowerbed: { key: (p) => String(p.tone), build: (p) => solo((k) => roundBed(k, 0, 0, 1.2, p.tone)) },
  crate: { key: () => '', build: buildCrate },
  sign: { key: () => '', build: () => solo((k) => infoStand(k, 0, 0, 0)) },
});

export const isDynamicType = (type) => Object.hasOwn(DYNAMIC_TYPES, type) && Object.hasOwn(WORLD_OBJECT_TYPES, type);

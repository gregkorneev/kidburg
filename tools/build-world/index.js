// Генератор данных города. Не меняет серверный протокол или формат чанков v1.
// Запуск: npm run world:build [-- <каталог>]
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { encode } from '@msgpack/msgpack';
import { CHUNK_SIZE, WORLD_CHUNKS_X, WORLD_CHUNKS_Z } from '../../shared/constants.js';
import { BUILDINGS, CITY_CENTER, PATHS, PLAZA, chunkOf, overlaps } from './layout.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DEFAULT_OUT_DIR = path.join(ROOT, 'generated');
export const BUILDING_PREFAB_IDS = Object.freeze({
  city_hall: 10,
  fire_station: 11,
  bakery: 12,
  flower_shop: 13,
  music_school: 14,
  radio_station: 15,
});
export const PLAZA_PREFAB_ID = 20;
export const PATH_PREFAB_ID = 21;
const HEIGHT_NODES = 17 * 17;
const CENTER_CHUNK = chunkOf(CITY_CENTER.x, CITY_CENTER.z);
const CENTRAL_MIN = 5;
const CENTRAL_MAX = 7;

const PREFABS = [
  { id: 1, name: 'tree', model: 'procedural/tree', collider: { type: 'aabb', size: [1, 6, 1] } },
  { id: 2, name: 'bench', model: 'procedural/bench', collider: { type: 'aabb', size: [2, 1, 1] } },
  { id: 3, name: 'lamp', model: 'procedural/lamp', collider: { type: 'aabb', size: [0.5, 4, 0.5] } },
  ...BUILDINGS.map(b => ({
    id: BUILDING_PREFAB_IDS[b.id], name: b.id, model: `procedural/${b.id}`,
    collider: { type: 'aabb', size: [b.width, 9, b.depth] },
  })),
  { id: PLAZA_PREFAB_ID, name: 'city_plaza', model: 'procedural/city_plaza', collider: null },
  { id: PATH_PREFAB_ID, name: 'city_path', model: 'procedural/city_path', collider: null },
];

function rand(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cityFootprints = [...BUILDINGS, PLAZA, ...PATHS];
function occupied(x, z, margin = 2) {
  return cityFootprints.some(s => Math.abs(x - s.x) < s.width / 2 + margin && Math.abs(z - s.z) < s.depth / 2 + margin);
}

export function makeCityChunk(cx, cz) {
  if (!Number.isInteger(cx) || !Number.isInteger(cz) || cx < 0 || cz < 0 || cx >= WORLD_CHUNKS_X || cz >= WORLD_CHUNKS_Z) {
    throw new RangeError(`Неверный чанк: ${cx},${cz}`);
  }
  const center = cx >= CENTRAL_MIN && cx <= CENTRAL_MAX && cz >= CENTRAL_MIN && cz <= CENTRAL_MAX;
  const zone = center ? 'plain' : (cx >= 2 && cx <= 4 && cz >= 2 && cz <= 4 ? 'park' : 'plain');
  const instances = [];
  const push = (id, x, z, ry = 0, scale = 1) => {
    if (chunkOf(x, z).cx === cx && chunkOf(x, z).cz === cz) instances.push([id, x, 0, z, ry, scale]);
  };
  for (const b of BUILDINGS) push(BUILDING_PREFAB_IDS[b.id], b.x, b.z, b.rotationY);
  push(PLAZA_PREFAB_ID, PLAZA.x, PLAZA.z);
  // Дороги могут пересекать границы чанков: их локальные сегменты добавляются по центру.
  // До внедрения render-prefab дорожки (как и здания) остаются placeholder-объектами.
  for (const p of PATHS) push(PATH_PREFAB_ID, p.x, p.z);
  const random = rand(cx * 4099 + cz * 131 + 2026);
  // В центре оставляем свободные проходы, по краям добавляем простое озеленение.
  const target = center ? 4 : (zone === 'park' ? 16 : 12);
  let placed = 0;
  for (let attempt = 0; attempt < target * 12 && placed < target; attempt++) {
    const x = cx * CHUNK_SIZE + 3 + random() * (CHUNK_SIZE - 6);
    const z = cz * CHUNK_SIZE + 3 + random() * (CHUNK_SIZE - 6);
    if (occupied(x, z, 5) || (center && Math.hypot(x - CITY_CENTER.x, z - CITY_CENTER.z) < 40)) continue;
    push(random() < 0.6 ? 1 : random() < 0.6 ? 2 : 3, x, z, random() * Math.PI * 2);
    placed++;
  }
  return { v: 1, cx, cz, zone, heights: new Float32Array(HEIGHT_NODES), instances, npcs: [] };
}

export function buildCityWorld(outDir = DEFAULT_OUT_DIR) {
  const chunksDir = path.join(outDir, 'chunks');
  mkdirSync(chunksDir, { recursive: true });
  const bytes = {};
  let totalBytes = 0;
  const districts = { center: [], park: [] };
  for (let cz = 0; cz < WORLD_CHUNKS_Z; cz++) {
    for (let cx = 0; cx < WORLD_CHUNKS_X; cx++) {
      const chunk = makeCityChunk(cx, cz);
      const data = encode(chunk);
      writeFileSync(path.join(chunksDir, `${cx}_${cz}.bin`), data);
      bytes[`${cx}_${cz}`] = data.length;
      totalBytes += data.length;
      if (cx >= CENTRAL_MIN && cx <= CENTRAL_MAX && cz >= CENTRAL_MIN && cz <= CENTRAL_MAX) districts.center.push([cx, cz]);
      else if (chunk.zone === 'park') districts.park.push([cx, cz]);
    }
  }
  const index = {
    v: 1, chunkSize: CHUNK_SIZE, chunksX: WORLD_CHUNKS_X, chunksZ: WORLD_CHUNKS_Z,
    totalBytes, bytes, prefabs: PREFABS,
    districts: [
      { id: 'city_center', name: 'Центральный город', chunks: districts.center },
      { id: 'park', name: 'Парк', chunks: districts.park },
    ],
    npcs: [],
  };
  writeFileSync(path.join(outDir, 'world.json'), JSON.stringify(index, null, 2) + '\n');
  return { outDir, chunks: WORLD_CHUNKS_X * WORLD_CHUNKS_Z, totalBytes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = path.resolve(process.argv[2] ?? DEFAULT_OUT_DIR);
  const result = buildCityWorld(outDir);
  console.log(`Город сгенерирован: ${result.chunks} чанка, ${result.totalBytes} байт → ${result.outDir}`);
}

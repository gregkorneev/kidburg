// Генератор тестового мира: 144 чанка и generated/world.json (формат: shared/chunk-format.md).
// Нужен, чтобы сервер и клиент не ждали tools/build-world. Результат детерминирован.
// Запуск: npm run world:fixtures [-- <папка>]; по умолчанию generated/ в корне репозитория.

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { encode } from '@msgpack/msgpack';
import { CHUNK_SIZE, WORLD_CHUNKS_X, WORLD_CHUNKS_Z } from '../../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_OUT_DIR = path.join(ROOT, 'generated');

const HOSPITAL_CENTER = { cx: 6, cz: 6 };
const HEIGHT_NODES = 17 * 17;
// Число инстансов задаёт размер чанка: больничные чанки тяжелее обычных,
// но обязательная область 3×3 вокруг (6, 6) остаётся в бюджете 10% мира.
const INSTANCES = { plain: 10, park: 14, hospital: 24 };

const PREFABS = [
  { id: 1, name: 'tree', model: 'models/tree.glb', collider: { type: 'aabb', size: [1, 6, 1] } },
  { id: 2, name: 'bench', model: 'models/bench.glb', collider: { type: 'aabb', size: [2, 1, 1] } },
  { id: 3, name: 'lamp', model: 'models/lamp.glb', collider: { type: 'aabb', size: [0.5, 4, 0.5] } },
  { id: 4, name: 'bed', model: 'models/bed.glb', collider: { type: 'aabb', size: [1, 1, 2] } },
  { id: 5, name: 'cabinet', model: 'models/cabinet.glb', collider: { type: 'aabb', size: [1, 2, 1] } },
];
const PREFABS_BY_ZONE = { plain: [1, 3], park: [1, 2, 3], hospital: [4, 5, 3] };

const NPCS = [
  { id: 'npc_therapist', agentId: 'therapist', x: 6 * CHUNK_SIZE + 40, y: 0, z: 6 * CHUNK_SIZE + 32, ry: 3.14 },
  { id: 'npc_nurse', agentId: 'nurse', x: 6 * CHUNK_SIZE + 24, y: 0, z: 6 * CHUNK_SIZE + 30, ry: 0 },
];

export function zoneOf(cx, cz) {
  if (Math.max(Math.abs(cx - HOSPITAL_CENTER.cx), Math.abs(cz - HOSPITAL_CENTER.cz)) <= 1) return 'hospital';
  if (cx >= 3 && cx <= 4 && cz >= 3 && cz <= 4) return 'park';
  return 'plain';
}

// mulberry32: небольшой детерминированный генератор.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildChunk(cx, cz) {
  const zone = zoneOf(cx, cz);
  const rand = rng(cx * 1000 + cz + 1);
  const prefabs = PREFABS_BY_ZONE[zone];
  const instances = [];
  for (let i = 0; i < INSTANCES[zone]; i++) {
    instances.push([
      prefabs[Math.floor(rand() * prefabs.length)],
      cx * CHUNK_SIZE + rand() * CHUNK_SIZE,
      0,
      cz * CHUNK_SIZE + rand() * CHUNK_SIZE,
      rand() * Math.PI * 2,
      1,
    ]);
  }
  const npcs = NPCS.filter((n) => Math.floor(n.x / CHUNK_SIZE) === cx && Math.floor(n.z / CHUNK_SIZE) === cz);
  return { v: 1, cx, cz, zone, heights: new Float32Array(HEIGHT_NODES), instances, npcs };
}

/**
 * Пишет chunks/*.bin и world.json в `outDir`.
 * @returns {{outDir: string, chunks: number, totalBytes: number}}
 */
export function makeFixtures(outDir = DEFAULT_OUT_DIR) {
  const chunksDir = path.join(outDir, 'chunks');
  mkdirSync(chunksDir, { recursive: true });

  const bytes = {};
  let totalBytes = 0;
  const districts = { hospital: [], park: [] };
  for (let cz = 0; cz < WORLD_CHUNKS_Z; cz++) {
    for (let cx = 0; cx < WORLD_CHUNKS_X; cx++) {
      const chunk = buildChunk(cx, cz);
      const data = encode(chunk);
      writeFileSync(path.join(chunksDir, `${cx}_${cz}.bin`), data);
      bytes[`${cx}_${cz}`] = data.length;
      totalBytes += data.length;
      if (chunk.zone !== 'plain') districts[chunk.zone].push([cx, cz]);
    }
  }

  const world = {
    v: 1,
    chunkSize: CHUNK_SIZE,
    chunksX: WORLD_CHUNKS_X,
    chunksZ: WORLD_CHUNKS_Z,
    totalBytes,
    bytes,
    prefabs: PREFABS,
    districts: [
      { id: 'hospital', name: 'Больница', chunks: districts.hospital },
      { id: 'park', name: 'Парк', chunks: districts.park },
    ],
    npcs: NPCS,
  };
  writeFileSync(path.join(outDir, 'world.json'), `${JSON.stringify(world, null, 2)}\n`);
  return { outDir, chunks: WORLD_CHUNKS_X * WORLD_CHUNKS_Z, totalBytes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.resolve(process.argv[2] ?? DEFAULT_OUT_DIR);
  const res = makeFixtures(out);
  console.log(`Фикстуры мира: ${res.chunks} чанков, ${res.totalBytes} байт → ${out}`);
}

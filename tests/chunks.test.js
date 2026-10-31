import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decode } from '@msgpack/msgpack';
import {
  CACHE_MAX_CHUNKS,
  CHUNK_SIZE,
  WORLD_CHUNKS_TOTAL,
  WORLD_CHUNKS_X,
  WORLD_SIZE_X,
  WORLD_SIZE_Z,
} from '../shared/constants.js';
import { chunkOf, createChunkMirror, planChunks } from '../server/net/chunks.js';
import { loadWorld } from '../server/net/world.js';
import { makeFixtures } from '../tools/fixtures/make-fixtures.mjs';
import { tempWorld } from './helpers.js';

const { worldDir, cleanup } = tempWorld();
test.after(cleanup);
const world = loadWorld(worldDir);

test('фикстуры: 144 чанка и world.json читаются из локальных файлов', () => {
  const index = JSON.parse(readFileSync(path.join(worldDir, 'world.json'), 'utf8'));
  assert.equal(index.v, 1);
  assert.equal(Object.keys(index.bytes).length, WORLD_CHUNKS_TOTAL);
  assert.equal(world.count, WORLD_CHUNKS_TOTAL);
  let sum = 0;
  for (const [key, size] of Object.entries(index.bytes)) {
    const file = path.join(worldDir, 'chunks', `${key}.bin`);
    assert.ok(existsSync(file), key);
    assert.equal(readFileSync(file).length, size, `размер ${key} совпадает с индексом`);
    sum += size;
  }
  assert.equal(sum, index.totalBytes);
  assert.equal(world.bytesMax, Math.floor(0.1 * index.totalBytes));
});

test('фикстуры: чанк (6, 6) — больница, формат по shared/chunk-format.md', () => {
  const hospital = decode(world.readChunk(6, 6));
  assert.equal(hospital.zone, 'hospital');
  assert.deepEqual([hospital.v, hospital.cx, hospital.cz], [1, 6, 6]);
  assert.equal(hospital.heights.length, 17 * 17 * 4);
  assert.equal(hospital.instances[0].length, 6);
  assert.equal(decode(world.readChunk(0, 0)).zone, 'plain');
  assert.equal(decode(world.readChunk(3, 3)).zone, 'park');
  for (const c of world.chunks) {
    const near = Math.max(Math.abs(c.cx - 6), Math.abs(c.cz - 6)) <= 1;
    assert.equal(decode(world.readChunk(c.cx, c.cz)).zone === 'hospital', near);
  }
});

test('фикстуры: обязательная область 3×3 у больницы укладывается в 10% мира', () => {
  const { list, requiredBytes } = planChunks(world, 6.5 * CHUNK_SIZE, 6.5 * CHUNK_SIZE);
  assert.ok(requiredBytes <= world.bytesMax);
  assert.ok(list.length >= 9 && list.length <= CACHE_MAX_CHUNKS);
});

test('loadWorld: без индекса возвращает null, повреждённый индекс — ошибка', () => {
  assert.equal(loadWorld(path.join(worldDir, 'нет-такой-папки')), null);
  const bad = mkdtempSync(path.join(tmpdir(), 'city-badworld-'));
  try {
    writeFileSync(path.join(bad, 'world.json'), JSON.stringify({ v: 1, chunkSize: 32, chunksX: 12, chunksZ: 12 }));
    assert.throws(() => loadWorld(bad), /размеры мира/);
    writeFileSync(path.join(bad, 'world.json'), JSON.stringify({ v: 2 }));
    assert.throws(() => loadWorld(bad), /версия/);
  } finally {
    rmSync(bad, { recursive: true, force: true });
  }
});

test('loadWorld: отсутствующий или изменённый чанк отклоняется до запуска кеш-зеркала', () => {
  const damaged = tempWorld();
  const chunk = path.join(damaged.worldDir, 'chunks', '0_0.bin');
  try {
    unlinkSync(chunk);
    assert.throws(() => loadWorld(damaged.worldDir), /отсутствует чанк 0_0/);

    makeFixtures(damaged.worldDir);
    const data = readFileSync(chunk);
    writeFileSync(chunk, Buffer.concat([data, Buffer.from([0])]));
    assert.throws(() => loadWorld(damaged.worldDir), /размер чанка 0_0/);
  } finally {
    damaged.cleanup();
  }
});

test('зеркало: первый вход загружает набор, повторный вызов в том же чанке ничего не шлёт', () => {
  const mirror = createChunkMirror(world);
  const first = mirror.update(6.5 * CHUNK_SIZE, 6.5 * CHUNK_SIZE);
  assert.deepEqual(first.unload, []);
  assert.ok(first.load.length >= 9);
  assert.deepEqual(first.stats, mirror.stats());
  assert.equal(first.stats.loaded, first.load.length);
  assert.equal(first.stats.worldTotal, WORLD_CHUNKS_TOTAL);
  assert.equal(mirror.update(6.5 * CHUNK_SIZE + 10, 6.5 * CHUNK_SIZE - 10), null);
});

test('зеркало: при смене чанка выгружается отставшее и догружается новое, без повторов', () => {
  const mirror = createChunkMirror(world);
  mirror.update(6.5 * CHUNK_SIZE, 6.5 * CHUNK_SIZE);
  const diff = mirror.update(7.5 * CHUNK_SIZE, 6.5 * CHUNK_SIZE);
  assert.ok(diff.unload.length > 0 && diff.load.length > 0);
  for (const c of diff.load) assert.ok(!diff.unload.some((u) => u.cx === c.cx && u.cz === c.cz));
  assert.ok(mirror.has(8, 6), 'передний край 3×3 загружен');
  assert.ok(!mirror.has(5, 5), 'задний край выгружен');
  assert.equal(mirror.update(7.5 * CHUNK_SIZE + 1, 6.5 * CHUNK_SIZE), null, 'тот же чанк — ничего');
});

// Детерминированный генератор для блуждания.
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test('случайное блуждание на 10 000 шагов: не больше 14 чанков и 10% мира по байтам', () => {
  const rand = lcg(2026);
  const mirror = createChunkMirror(world);
  let x = 6.5 * CHUNK_SIZE;
  let z = 6.5 * CHUNK_SIZE;
  let changes = 0;
  let maxLoaded = 0;
  let previous = null;

  for (let step = 0; step < 10_000; step++) {
    const angle = rand() * Math.PI * 2;
    // Чаще мелкие шаги, иногда рывок через много чанков.
    const len = rand() < 0.05 ? rand() * 300 : rand() * 25;
    x = Math.min(WORLD_SIZE_X - 0.001, Math.max(0, x + Math.cos(angle) * len));
    z = Math.min(WORLD_SIZE_Z - 0.001, Math.max(0, z + Math.sin(angle) * len));

    const here = chunkOf(x, z).key;
    const diff = mirror.update(x, z);
    const stats = mirror.stats();
    assert.ok(stats.loaded <= CACHE_MAX_CHUNKS, `шаг ${step}: ${stats.loaded} чанков`);
    assert.ok(stats.bytes <= world.bytesMax, `шаг ${step}: ${stats.bytes} байт`);
    maxLoaded = Math.max(maxLoaded, stats.loaded);

    if (here === previous) assert.equal(diff, null, `шаг ${step}: тот же чанк, а данные отправлены`);
    if (diff) {
      changes++;
      assert.deepEqual(diff.stats, stats);
      const c = chunkOf(x, z);
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = c.cx + dx;
        const nz = c.cz + dz;
        if (nx >= 0 && nz >= 0 && nx < WORLD_CHUNKS_X && nz < WORLD_CHUNKS_X) {
          assert.ok(mirror.has(nx, nz), `шаг ${step}: нет обязательного чанка ${nx},${nz}`);
        }
      }
    }
    previous = here;
  }
  assert.ok(changes > 500, `блуждание должно пересекать границы чанков (${changes})`);
  assert.ok(maxLoaded >= 9);
});

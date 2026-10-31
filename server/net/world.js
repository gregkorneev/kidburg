// Индекс мира (generated/world.json) и чтение чанков. Размеры берутся из индекса,
// сами файлы читаются только в момент отправки клиенту.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CACHE_FRACTION, CHUNK_SIZE, WORLD_CHUNKS_X, WORLD_CHUNKS_Z } from '../../shared/constants.js';

/**
 * Загружает мир или возвращает null, если индекса нет (тогда чанки не передаются).
 * Повреждённый индекс — ошибка: сервер не должен молча работать с неверным миром.
 */
export function loadWorld(dir, log) {
  const indexFile = path.join(dir, 'world.json');
  if (!existsSync(indexFile)) {
    log?.warn(`${indexFile} не найден: чанки не передаются (npm run world:fixtures)`);
    return null;
  }
  const index = JSON.parse(readFileSync(indexFile, 'utf8'));
  if (index.v !== 1) throw new Error(`world.json: версия ${index.v}, нужна 1`);
  if (index.chunkSize !== CHUNK_SIZE || index.chunksX !== WORLD_CHUNKS_X || index.chunksZ !== WORLD_CHUNKS_Z) {
    throw new Error('world.json: размеры мира не совпадают с shared/constants.js');
  }
  if (!(index.totalBytes > 0) || typeof index.bytes !== 'object' || index.bytes === null) {
    throw new Error('world.json: нет totalBytes или bytes');
  }

  const chunks = [];
  for (const [key, size] of Object.entries(index.bytes)) {
    const [cx, cz] = key.split('_').map(Number);
    if (!Number.isInteger(cx) || !Number.isInteger(cz) || !(size > 0)) {
      throw new Error(`world.json: неверная запись bytes[${key}]`);
    }
    chunks.push({ cx, cz, key: cx + cz * WORLD_CHUNKS_X, bytes: size });
  }
  chunks.sort((a, b) => a.key - b.key);

  return {
    dir,
    chunks,
    count: chunks.length,
    totalBytes: index.totalBytes,
    bytesMax: Math.floor(CACHE_FRACTION * index.totalBytes),
    npcs: index.npcs ?? [],
    /** Байты файла чанка как есть, для chunk_load. */
    readChunk: (cx, cz) => new Uint8Array(readFileSync(path.join(dir, 'chunks', `${cx}_${cz}.bin`))),
  };
}

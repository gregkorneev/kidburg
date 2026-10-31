// Константы мира. Источник правды для клиента и сервера (меняет только роль 2).

export const CHUNK_SIZE = 64;
export const WORLD_CHUNKS_X = 12;
export const WORLD_CHUNKS_Z = 12;
export const WORLD_CHUNKS_TOTAL = WORLD_CHUNKS_X * WORLD_CHUNKS_Z;

export const VIEW_RADIUS = 1;
export const CACHE_FRACTION = 0.1;
export const CACHE_MAX_CHUNKS = Math.floor(CACHE_FRACTION * WORLD_CHUNKS_TOTAL);

export const TICK_HZ = 15;
export const MAX_SPEED = 9;
export const SPEED_TOLERANCE = 1.5;
export const TALK_DISTANCE = 8;

export const PROTO_VERSION = 1;

// Точка возрождения: центр чанка (6, 6), район больницы.
export const SPAWN = Object.freeze({
  x: 6 * CHUNK_SIZE + CHUNK_SIZE / 2,
  y: 0,
  z: 6 * CHUNK_SIZE + CHUNK_SIZE / 2,
  ry: 0,
});

export const WORLD_SIZE_X = WORLD_CHUNKS_X * CHUNK_SIZE;
export const WORLD_SIZE_Z = WORLD_CHUNKS_Z * CHUNK_SIZE;

// Пересылается клиенту в welcome.consts.
export const CLIENT_CONSTS = Object.freeze({
  CHUNK_SIZE,
  WORLD_CHUNKS_X,
  WORLD_CHUNKS_Z,
  WORLD_CHUNKS_TOTAL,
  VIEW_RADIUS,
  CACHE_FRACTION,
  CACHE_MAX_CHUNKS,
  TICK_HZ,
  MAX_SPEED,
  TALK_DISTANCE,
});

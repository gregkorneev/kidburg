// Зеркало кеша клиента: какие чанки сервер уже отправил и не выгрузил.
// Желаемый набор D = обязательная область R (3×3) + резерв ближайших чанков,
// всего не больше CACHE_MAX_CHUNKS и не больше 10% мира по байтам (lead-spec, S2).

import {
  CACHE_MAX_CHUNKS,
  CHUNK_SIZE,
  VIEW_RADIUS,
  WORLD_CHUNKS_X,
  WORLD_CHUNKS_Z,
} from '../../shared/constants.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function chunkOf(x, z) {
  const cx = clamp(Math.floor(x / CHUNK_SIZE), 0, WORLD_CHUNKS_X - 1);
  const cz = clamp(Math.floor(z / CHUNK_SIZE), 0, WORLD_CHUNKS_Z - 1);
  return { cx, cz, key: cx + cz * WORLD_CHUNKS_X };
}

/**
 * Желаемый набор чанков для позиции, ближайшие первыми.
 * Обязательная область берётся всегда; резерв режется с самых дальних чанков,
 * пока не уложится в число и в байты.
 * @returns {{list: Array, requiredBytes: number}}
 */
export function planChunks(world, x, z) {
  const here = chunkOf(x, z);
  const required = [];
  const rest = [];
  for (const c of world.chunks) {
    const item = {
      ...c,
      dist: Math.hypot(x - (c.cx + 0.5) * CHUNK_SIZE, z - (c.cz + 0.5) * CHUNK_SIZE),
    };
    const near = Math.max(Math.abs(c.cx - here.cx), Math.abs(c.cz - here.cz)) <= VIEW_RADIUS;
    (near ? required : rest).push(item);
  }
  const byDistance = (a, b) => a.dist - b.dist || a.cz - b.cz || a.cx - b.cx;
  rest.sort(byDistance);

  const requiredBytes = required.reduce((sum, c) => sum + c.bytes, 0);
  let bytesLeft = world.bytesMax - requiredBytes;
  const reserve = [];
  for (const c of rest) {
    if (required.length + reserve.length >= CACHE_MAX_CHUNKS || c.bytes > bytesLeft) break;
    reserve.push(c);
    bytesLeft -= c.bytes;
  }
  return { list: [...required, ...reserve].sort(byDistance), requiredBytes };
}

/**
 * Зеркало одного клиента. update() пересчитывает набор только при смене чанка игрока
 * и возвращает разницу; если набор не изменился, возвращает null (ничего не отправляется).
 */
export function createChunkMirror(world, log) {
  /** @type {Map<number, {cx: number, cz: number, key: number, bytes: number}>} */
  const sent = new Map();
  let bytes = 0;
  let lastKey = -1;
  let warnedRequired = false;

  const stats = () => ({
    loaded: sent.size,
    max: CACHE_MAX_CHUNKS,
    worldTotal: world.count,
    bytes,
    bytesMax: world.bytesMax,
  });

  function replan(x, z) {
    const { list, requiredBytes } = planChunks(world, x, z);
    if (requiredBytes > world.bytesMax && !warnedRequired) {
      warnedRequired = true;
      log?.warn('обязательная область 3×3 не помещается в 10% мира: проверьте контент');
    }
    const wanted = new Set(list.map((c) => c.key));
    const unload = [...sent.values()].filter((c) => !wanted.has(c.key));
    const load = list.filter((c) => !sent.has(c.key));
    for (const c of unload) {
      sent.delete(c.key);
      bytes -= c.bytes;
    }
    for (const c of load) {
      sent.set(c.key, { cx: c.cx, cz: c.cz, key: c.key, bytes: c.bytes });
      bytes += c.bytes;
    }
    return {
      unload: unload.map(({ cx, cz }) => ({ cx, cz })),
      load: load.map(({ cx, cz }) => ({ cx, cz })),
      stats: stats(),
    };
  }

  return {
    stats,
    has: (cx, cz) => sent.has(cx + cz * WORLD_CHUNKS_X),
    update(x, z) {
      const here = chunkOf(x, z);
      if (here.key === lastKey) return null;
      lastKey = here.key;
      const diff = replan(x, z);
      return diff.unload.length === 0 && diff.load.length === 0 ? null : diff;
    },
    /**
     * Пересчитывает размеры уже отправленных чанков (динамические объекты изменили их вес) и набор заново.
     * Всегда возвращает разницу со свежей статистикой, даже пустую.
     */
    refresh(x, z) {
      lastKey = chunkOf(x, z).key;
      bytes = 0;
      for (const c of sent.values()) {
        c.bytes = world.chunks[c.key]?.bytes ?? c.bytes;
        bytes += c.bytes;
      }
      return replan(x, z);
    },
  };
}

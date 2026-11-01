// Динамический слой мира: объекты, которые администратор создаёт, двигает и удаляет через Control Center.
// Сервер — единственный источник правды. Файлы generated/*.bin не меняются: объекты живут в SQLite,
// при подключении и входе в чанк уходят клиенту отдельными сообщениями dyn_*, а их размер входит в учёт
// кеша клиента (10% мира), см. wrapWorld().

import { randomBytes } from 'node:crypto';
import { encode } from '@msgpack/msgpack';
import {
  CACHE_FRACTION,
  CHUNK_SIZE,
  WORLD_CHUNKS_X,
  WORLD_CHUNKS_Z,
} from '../../shared/constants.js';
import {
  WORLD_OBJECT_LIMITS,
  WORLD_OBJECT_TYPES,
  isObjectType,
  normalizeObjectParams,
} from '../../shared/world-objects.js';

const TWO_PI = Math.PI * 2;

export const chunkKeyOf = (x, z) => {
  const cx = Math.min(WORLD_CHUNKS_X - 1, Math.max(0, Math.floor(x / CHUNK_SIZE)));
  const cz = Math.min(WORLD_CHUNKS_Z - 1, Math.max(0, Math.floor(z / CHUNK_SIZE)));
  return { cx, cz, key: cx + cz * WORLD_CHUNKS_X };
};

const round = (v, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;
const normalizeAngle = (a) => round(((a % TWO_PI) + TWO_PI) % TWO_PI, 3);

const fail = (status, code, message) => ({ ok: false, status, code, message });

/** Объект в формате протокола (dyn_snapshot / dyn_upsert). */
export const toWire = (o) => ({ id: o.id, type: o.type, x: o.x, z: o.z, ry: o.ry, scale: o.scale, params: o.params, rev: o.rev });

/**
 * @param {object} deps
 * @param {ReturnType<import('../db/index.js').openDb>} deps.db
 * @param {ReturnType<import('./placement.js').createPlacement>} deps.placement
 * @param {object|null} [deps.world] индекс мира (loadWorld) для учёта байтов кеша
 */
export function createDynamicWorld({ db, placement, world = null, now = Date.now, log }) {
  /** @type {Map<string, object>} */
  const objects = new Map();
  const staticBytes = new Array(WORLD_CHUNKS_X * WORLD_CHUNKS_Z).fill(0);
  for (const c of world?.chunks ?? []) staticBytes[c.key] = c.bytes;
  const dynBytes = new Array(WORLD_CHUNKS_X * WORLD_CHUNKS_Z).fill(0);
  const perChunk = new Array(WORLD_CHUNKS_X * WORLD_CHUNKS_Z).fill(0);
  const wireBytes = new Map();
  const listeners = new Set();
  let revision = 0;
  /** Игровые предметы занимают места и не должны перекрываться административными объектами. */
  let reserved = () => [];

  const sizeOf = (o) => encode(toWire(o)).length;

  function index(o, sign) {
    const { key } = chunkKeyOf(o.x, o.z);
    if (sign > 0) wireBytes.set(o.id, sizeOf(o));
    dynBytes[key] += sign * (wireBytes.get(o.id) ?? 0);
    perChunk[key] += sign;
    if (sign < 0) wireBytes.delete(o.id);
  }

  for (const row of db.listWorldObjects()) {
    if (!isObjectType(row.type)) {
      log?.warn({ id: row.id, type: row.type }, 'динамический объект неизвестного типа пропущен');
      continue;
    }
    const obj = { ...row, params: normalizeObjectParams(row.type, row.params).params ?? {} };
    objects.set(obj.id, obj);
    index(obj, +1);
  }
  revision = Math.max(db.getWorldRevision(), ...[...objects.values()].map((o) => o.rev), 0);

  const emit = (ops) => {
    for (const fn of listeners) {
      try {
        fn({ ops, revision, count: objects.size });
      } catch (err) {
        log?.error({ err }, 'сбой обработчика изменения мира');
      }
    }
  };

  /** Размеры в байтах после гипотетического изменения: обязательная область 3×3 любого чанка должна помещаться в 10% мира. */
  function budgetOk(deltaByKey) {
    if (!world) return true;
    const dyn = dynBytes.map((b, i) => b + (deltaByKey.get(i) ?? 0));
    const total = world.totalBytes + dyn.reduce((a, b) => a + b, 0);
    const limit = Math.floor(CACHE_FRACTION * total);
    for (let cz = 0; cz < WORLD_CHUNKS_Z; cz++) {
      for (let cx = 0; cx < WORLD_CHUNKS_X; cx++) {
        let sum = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const x = cx + dx;
            const z = cz + dz;
            if (x < 0 || z < 0 || x >= WORLD_CHUNKS_X || z >= WORLD_CHUNKS_Z) continue;
            const key = x + z * WORLD_CHUNKS_X;
            sum += staticBytes[key] + dyn[key];
          }
        }
        if (sum > limit) return false;
      }
    }
    return true;
  }

  /** Полная проверка кандидата. `ignoreId` — объект, который сейчас двигается. */
  function validate(input, { ignoreId = null } = {}) {
    if (!isObjectType(input.type)) return fail(400, 'bad_type', 'Этот тип объектов не разрешён');
    const spec = WORLD_OBJECT_TYPES[input.type];
    const num = (v) => typeof v === 'number' && Number.isFinite(v);
    if (!num(input.x) || !num(input.z)) return fail(400, 'bad_position', 'Нужны числовые координаты x и z');
    const ry = input.ry ?? 0;
    if (!num(ry) || Math.abs(ry) > 100) return fail(400, 'bad_rotation', 'Поворот ry — число в радианах');
    const scale = input.scale ?? 1;
    if (!num(scale) || scale < spec.scale[0] || scale > spec.scale[1]) {
      return fail(400, 'bad_scale', `Масштаб для «${spec.label}»: от ${spec.scale[0]} до ${spec.scale[1]}`);
    }
    const params = normalizeObjectParams(input.type, input.params);
    if (!params.ok) return fail(400, 'bad_params', params.error);
    const candidate = { type: input.type, x: round(input.x), z: round(input.z), ry: normalizeAngle(ry), scale: round(scale), params: params.params };

    const base = placement.checkStatic(candidate);
    if (!base.ok) return fail(422, base.code, base.reason);

    const r = spec.radius * candidate.scale;
    for (const other of objects.values()) {
      if (other.id === ignoreId) continue;
      const gap = Math.hypot(other.x - candidate.x, other.z - candidate.z);
      const need = r + WORLD_OBJECT_TYPES[other.type].radius * other.scale + WORLD_OBJECT_LIMITS.MIN_GAP;
      if (gap < need) return fail(422, 'overlap', 'Пересекается с другим динамическим объектом');
    }
    for (const spot of reserved()) {
      if (Math.hypot(spot.x - candidate.x, spot.z - candidate.z) < r + spot.r + WORLD_OBJECT_LIMITS.MIN_GAP) {
        return fail(422, 'overlap', `Место занято игровым предметом («${spot.label}»)`);
      }
    }
    return { ok: true, candidate };
  }

  function checkCapacity(candidate, previous) {
    const to = chunkKeyOf(candidate.x, candidate.z).key;
    const from = previous ? chunkKeyOf(previous.x, previous.z).key : -1;
    if (!previous && objects.size >= WORLD_OBJECT_LIMITS.MAX_TOTAL) {
      return fail(409, 'limit_total', `Достигнут предел: ${WORLD_OBJECT_LIMITS.MAX_TOTAL} динамических объектов`);
    }
    if (to !== from && perChunk[to] >= WORLD_OBJECT_LIMITS.MAX_PER_CHUNK) {
      return fail(409, 'limit_chunk', `В чанке не больше ${WORLD_OBJECT_LIMITS.MAX_PER_CHUNK} динамических объектов`);
    }
    const delta = new Map();
    const bytes = encode(toWire({ ...candidate, id: previous?.id ?? 'o_0000000000', rev: revision + 1 })).length;
    delta.set(to, (delta.get(to) ?? 0) + bytes);
    if (previous) delta.set(from, (delta.get(from) ?? 0) - (wireBytes.get(previous.id) ?? 0));
    if (!budgetOk(delta)) {
      return fail(409, 'cache_budget', 'Объекты не должны выводить область вокруг игрока за пределы 10% кеша клиента');
    }
    return null;
  }

  const newId = () => {
    for (;;) {
      const id = `o_${randomBytes(5).toString('hex')}`;
      if (!objects.has(id)) return id;
    }
  };

  const state = {
    get revision() {
      return revision;
    },
    get count() {
      return objects.size;
    },
    get bytes() {
      return dynBytes.reduce((a, b) => a + b, 0);
    },
    list: () => [...objects.values()],
    setReserved(fn) {
      reserved = typeof fn === 'function' ? fn : () => [];
    },
    get: (id) => objects.get(id) ?? null,
    /** Объекты чанка в формате протокола. */
    forChunk(cx, cz) {
      const out = [];
      for (const o of objects.values()) {
        const c = chunkKeyOf(o.x, o.z);
        if (c.cx === cx && c.cz === cz) out.push(toWire(o));
      }
      return out;
    },
    chunkDynBytes: (key) => dynBytes[key] ?? 0,
    totalDynBytes: () => dynBytes.reduce((a, b) => a + b, 0),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** Проверка без изменений (для предпросмотра на карте). */
    check(input, options) {
      const v = validate(input, options);
      if (!v.ok) return v;
      const cap = checkCapacity(v.candidate, options?.ignoreId ? objects.get(options.ignoreId) : null);
      return cap ?? { ok: true };
    },

    create(input, { id = null } = {}) {
      const v = validate(input);
      if (!v.ok) return v;
      const cap = checkCapacity(v.candidate, null);
      if (cap) return cap;
      const at = now();
      const obj = { id: id ?? newId(), ...v.candidate, rev: revision + 1, createdAt: at, updatedAt: at };
      if (objects.has(obj.id)) return fail(409, 'exists', 'Объект с таким id уже есть');
      db.world((tx) => {
        tx.insert(obj, at);
        tx.setRevision(obj.rev);
      });
      revision = obj.rev;
      objects.set(obj.id, obj);
      index(obj, +1);
      emit([{ op: 'upsert', object: toWire(obj), prev: null }]);
      return { ok: true, object: obj, before: null };
    },

    update(id, patch, { expectedRev = null } = {}) {
      const current = objects.get(id);
      if (!current) return fail(404, 'not_found', 'Объект не найден');
      if (expectedRev !== null && expectedRev !== current.rev) {
        return fail(409, 'conflict', 'Объект уже изменён (версия устарела), обновите карту');
      }
      const merged = {
        type: current.type,
        x: patch.x ?? current.x,
        z: patch.z ?? current.z,
        ry: patch.ry ?? current.ry,
        scale: patch.scale ?? current.scale,
        params: patch.params === undefined ? current.params : { ...current.params, ...patch.params },
      };
      if (patch.type !== undefined && patch.type !== current.type) return fail(400, 'bad_type', 'Тип объекта менять нельзя');
      const v = validate(merged, { ignoreId: id });
      if (!v.ok) return v;
      const cap = checkCapacity(v.candidate, current);
      if (cap) return cap;
      const at = now();
      const next = { ...current, ...v.candidate, rev: revision + 1, updatedAt: at };
      db.world((tx) => {
        tx.update(next, at);
        tx.setRevision(next.rev);
      });
      revision = next.rev;
      index(current, -1);
      objects.set(id, next);
      index(next, +1);
      const prev = chunkKeyOf(current.x, current.z);
      emit([{ op: 'upsert', object: toWire(next), prev: { cx: prev.cx, cz: prev.cz } }]);
      return { ok: true, object: next, before: current };
    },

    remove(id, { expectedRev = null } = {}) {
      const current = objects.get(id);
      if (!current) return fail(404, 'not_found', 'Объект не найден');
      if (expectedRev !== null && expectedRev !== current.rev) {
        return fail(409, 'conflict', 'Объект уже изменён (версия устарела), обновите карту');
      }
      const rev = revision + 1;
      db.world((tx) => {
        tx.remove(id);
        tx.setRevision(rev);
      });
      revision = rev;
      index(current, -1);
      objects.delete(id);
      const c = chunkKeyOf(current.x, current.z);
      emit([{ op: 'remove', id, rev, cx: c.cx, cz: c.cz }]);
      return { ok: true, object: current, before: current };
    },

    /** Удаляет все динамические объекты (мир возвращается к сгенерированному состоянию). */
    clear() {
      const before = [...objects.values()];
      const rev = revision + 1;
      db.world((tx) => {
        tx.clear();
        tx.setRevision(rev);
      });
      revision = rev;
      const ops = before.map((o) => {
        const c = chunkKeyOf(o.x, o.z);
        return { op: 'remove', id: o.id, rev, cx: c.cx, cz: c.cz };
      });
      objects.clear();
      dynBytes.fill(0);
      perChunk.fill(0);
      wireBytes.clear();
      if (ops.length) emit(ops);
      return { ok: true, before };
    },

    /** Возвращает набор объектов (откат очистки) с прежними id; каждый проходит обычную проверку. */
    restore(list) {
      const created = [];
      for (const o of list) {
        const res = state.create({ type: o.type, x: o.x, z: o.z, ry: o.ry, scale: o.scale, params: o.params }, { id: o.id });
        if (!res.ok) {
          for (const c of created.reverse()) state.remove(c.id);
          return res;
        }
        created.push(res.object);
      }
      return { ok: true, objects: created };
    },
  };

  /**
   * Вид мира для игрового сервера: размеры чанков и лимит кеша включают динамические объекты.
   * Чанк = файл + его динамические объекты; лимит = 10% от суммы всех размеров.
   */
  state.wrapWorld = function wrapWorld(base) {
    if (!base) return null;
    const chunks = base.chunks.map((c) => ({
      cx: c.cx,
      cz: c.cz,
      key: c.key,
      get bytes() {
        return c.bytes + (dynBytes[c.key] ?? 0);
      },
    }));
    return {
      ...base,
      chunks,
      get totalBytes() {
        return base.totalBytes + state.totalDynBytes();
      },
      get bytesMax() {
        return Math.floor(CACHE_FRACTION * (base.totalBytes + state.totalDynBytes()));
      },
    };
  };

  return state;
}

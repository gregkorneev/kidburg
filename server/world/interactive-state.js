// Серверное состояние интерактивного мира: переносимые предметы и футбольные мячи.
// Сервер — единственный источник правды. Клиент присылает только намерение (взять, поставить, пнуть); дальность,
// владение, место постановки и направление удара определяются здесь по данным соединения игрока.
//   • предметы: available (на стартовой точке) → held (в руках одного игрока) → placed (поставлен). Положение
//     хранится в SQLite после каждой постановки, предмет в руках в базе не хранится;
//   • мячи: только память процесса (shared/interaction-contracts.js), физика — ball-physics.js.
import {
  BALL,
  FIELD,
  INTERACT_CODES as CODE,
  INTERACT_LIMITS as LIMIT,
  PROP_HOMES,
  PROP_TYPES,
  forwardOf,
  isBallId,
} from '../../shared/interaction-contracts.js';
import { WORLD_OBJECT_TYPES } from '../../shared/world-objects.js';
import { createBallWorld } from './ball-physics.js';

const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const fail = (code, message) => ({ ok: false, code, message });
const round2 = (v) => Math.round(v * 100) / 100;

/** Смещения проб постановки (дистанция вперёд, боковой сдвиг): сначала прямо перед игроком, потом вокруг. */
const PLACE_PROBES = [[1, 0], [0.8, 0], [1.3, 0], [1, 0.55], [1, -0.55], [1.6, 0], [0.6, 0.6], [0.6, -0.6], [2, 0]];
const DROP_PROBES = [[0.55, 0], [0.35, 0.4], [0.35, -0.4], [0.9, 0], [0, 0.7], [0, -0.7], [-0.6, 0]];

/**
 * @param {object} deps
 * @param {ReturnType<import('../db/index.js').openDb>} deps.db
 * @param {ReturnType<import('./placement.js').createPlacement>} deps.placement
 * @param {ReturnType<import('./dynamic-objects.js').createDynamicWorld>|null} [deps.dynamic]
 */
export function createInteractive({ db, placement, dynamic = null, now = Date.now, log = null }) {
  const listeners = new Set();
  let rev = 0;
  let propRev = 0;
  /** @type {Map<string, object>} */
  const props = new Map();
  /** @type {Map<number, string>} userId -> id предмета в руках */
  const holders = new Map();
  const lastKickAt = new Map();

  const homeOf = new Map(PROP_HOMES.map((h) => [h.id, h]));
  const stored = new Map(db.listInteractiveProps().map((r) => [r.id, r]));
  for (const home of PROP_HOMES) {
    const row = stored.get(home.id);
    const placed = row && row.state === 'placed' && row.type === home.type && [row.x, row.z, row.ry].every(Number.isFinite);
    const prop = {
      id: home.id,
      type: home.type,
      x: placed ? row.x : home.x,
      z: placed ? row.z : home.z,
      ry: placed ? row.ry : home.ry,
      state: placed ? 'placed' : 'available',
      holder: 0,
      rev: 0,
    };
    props.set(prop.id, prop);
    if (!row) db.saveInteractiveProp(prop, now());
  }

  const radiusOf = (prop) => PROP_TYPES[prop.type].radius;

  function emit(prop) {
    prop.rev = ++rev;
    propRev += 1;
    for (const fn of listeners) {
      try {
        fn(propWire(prop));
      } catch (err) {
        log?.error({ err }, 'сбой обработчика изменения предметов');
      }
    }
  }

  const persist = (prop) => db.saveInteractiveProp({ ...prop, state: prop.state === 'held' ? 'placed' : prop.state }, now());

  // ── физика мячей ─────────────────────────────────────────────────────────
  const baseObstacles = placement.staticObstacles();
  const box = { x: FIELD.x, z: FIELD.z };
  const near = (o) => Math.abs(o.x - box.x) < FIELD.halfW + FIELD.hardMargin + 20 && Math.abs(o.z - box.z) < FIELD.halfD + FIELD.hardMargin + 20;
  const staticObstacles = { boxes: baseObstacles.boxes.filter(near), circles: baseObstacles.circles.filter(near) };
  let cachedKey = '';
  let cached = { boxes: [], circles: [] };
  function obstacles() {
    const key = `${dynamic?.revision ?? 0}:${propRev}`;
    if (key === cachedKey) return cached;
    cachedKey = key;
    const circles = [];
    for (const o of dynamic?.list() ?? []) {
      const spec = WORLD_OBJECT_TYPES[o.type];
      if (!spec || !near(o)) continue;
      circles.push({ x: o.x, z: o.z, r: (Math.max(spec.collider[0], spec.collider[2]) / 2) * o.scale, height: spec.collider[1] * o.scale });
    }
    for (const p of props.values()) {
      if (p.state === 'held' || !near(p)) continue;
      circles.push({ x: p.x, z: p.z, r: radiusOf(p), height: PROP_TYPES[p.type].height });
    }
    cached = { boxes: [], circles };
    return cached;
  }
  const balls = createBallWorld({ staticObstacles, obstacles, now });

  // ── предметы ─────────────────────────────────────────────────────────────

  /** Можно ли поставить prop в (x, z): правила мира, динамические объекты, другие предметы. */
  function spotOk(prop, x, z) {
    return placement.checkProp(x, z, radiusOf(prop));
  }

  function findSpot(prop, player, probes) {
    const fwd = forwardOf(player.ry);
    const side = { x: -fwd.z, z: fwd.x };
    for (const [ahead, lateral] of probes) {
      const x = round2(player.x + fwd.x * ahead + side.x * lateral);
      const z = round2(player.z + fwd.z * ahead + side.z * lateral);
      if (spotOk(prop, x, z).ok) return { x, z };
    }
    return null;
  }

  function take(player, id) {
    const prop = props.get(id);
    if (!prop) return fail(CODE.UNKNOWN, 'Такого предмета нет');
    if (prop.state === 'held') {
      return prop.holder === player.id ? fail(CODE.HANDS_FULL, 'Предмет уже у вас в руках') : fail(CODE.BUSY, 'Этот предмет уже несёт другой игрок');
    }
    if (holders.has(player.id)) return fail(CODE.HANDS_FULL, 'Руки заняты: сначала поставьте предмет');
    if (dist(player.x, player.z, prop.x, prop.z) > LIMIT.TAKE_REACH + LIMIT.REACH_MARGIN) return fail(CODE.TOO_FAR, 'Предмет слишком далеко');
    // Атомарно: проверка и смена владельца в одном синхронном вызове.
    prop.state = 'held';
    prop.holder = player.id;
    holders.set(player.id, prop.id);
    emit(prop);
    return { ok: true, code: CODE.OK, message: '', prop: propWire(prop) };
  }

  function place(player, id, mode = 'place') {
    const heldId = holders.get(player.id);
    if (!heldId) return fail(CODE.NOT_HOLDING, 'В руках ничего нет');
    if (id && id !== heldId) return fail(CODE.NOT_HOLDING, 'Этот предмет не у вас в руках');
    const prop = props.get(heldId);
    const spot = findSpot(prop, player, mode === 'drop' ? DROP_PROBES : PLACE_PROBES);
    if (!spot) return fail(CODE.BLOCKED, 'Нельзя поставить за пределами игрового мира');
    Object.assign(prop, { x: spot.x, z: spot.z, ry: round2(player.ry), state: 'placed', holder: 0 });
    holders.delete(player.id);
    persist(prop);
    emit(prop);
    return { ok: true, code: CODE.OK, message: '', prop: propWire(prop) };
  }

  /** Игрок ушёл с предметом: тот возвращается на последнее безопасное положение, а если оно занято — на старт. */
  function release(userId) {
    const id = holders.get(userId);
    if (!id) return null;
    holders.delete(userId);
    const prop = props.get(id);
    prop.holder = 0;
    const home = homeOf.get(prop.id);
    if (!spotOk(prop, prop.x, prop.z).ok) Object.assign(prop, { x: home.x, z: home.z, ry: home.ry });
    prop.state = prop.x === home.x && prop.z === home.z ? 'available' : 'placed';
    persist(prop);
    emit(prop);
    return propWire(prop);
  }

  // ── мячи ─────────────────────────────────────────────────────────────────

  function kick(player, id) {
    if (!isBallId(id)) return fail(CODE.UNKNOWN, 'Такого мяча нет');
    const ball = balls.get(id);
    const t = now();
    if (t - (lastKickAt.get(player.id) ?? -Infinity) < LIMIT.KICK_COOLDOWN_MS) return fail(CODE.COOLDOWN, 'Слишком часто');
    if (dist(player.x, player.z, ball.x, ball.z) > LIMIT.KICK_REACH + LIMIT.REACH_MARGIN) return fail(CODE.TOO_FAR, 'Мяч слишком далеко');
    lastKickAt.set(player.id, t);
    balls.kick(id, { id: player.id, ry: player.ry });
    return { ok: true, code: CODE.OK, message: '' };
  }

  function propWire(p) {
    return { id: p.id, type: p.type, x: p.x, z: p.z, ry: p.ry, state: p.state, holder: p.holder, rev: p.rev };
  }

  // Резервирование мест под предметы: администратор не может поставить динамический объект поверх них.
  dynamic?.setReserved?.(() =>
    [...props.values()].map((p) => ({ x: p.x, z: p.z, r: radiusOf(p), label: PROP_TYPES[p.type].label })),
  );

  return {
    balls,
    props: () => [...props.values()],
    propRows: () => [...props.values()].map(propWire),
    propWire,
    heldBy: (userId) => props.get(holders.get(userId)) ?? null,
    get revision() {
      return rev;
    },
    take,
    place,
    release,
    kick,
    /** Один физический шаг мячей; возвращает события (kick/reset). */
    step: (dt, players) => balls.step(dt, players),
    ballRows: () => balls.list().map((b) => balls.wire(b)),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Для Control Center: состояние всех игровых предметов и мячей. */
    describe() {
      return {
        props: [...props.values()].map((p) => ({ ...propWire(p), label: PROP_TYPES[p.type].label, home: homeOf.get(p.id) })),
        balls: balls.list().map((b) => balls.describe(b)),
      };
    },
    /** Возвращает предмет на стартовую точку (администратор). Предмет в руках не трогаем: сначала его должны поставить. */
    resetProp(id) {
      const prop = props.get(id);
      if (!prop) return fail(CODE.UNKNOWN, 'Такого предмета нет');
      if (prop.state === 'held') return fail(CODE.BUSY, 'Предмет сейчас в руках у игрока');
      const home = homeOf.get(id);
      Object.assign(prop, { x: home.x, z: home.z, ry: home.ry, state: 'available' });
      persist(prop);
      emit(prop);
      return { ok: true, code: CODE.OK, message: '', prop: propWire(prop) };
    },
    BALL,
  };
}

// Единая клавиша E в городе. Менеджер выбирает ОДНУ цель из всех источников (вход в здание, дверь, ворота, NPC,
// предметы, мяч), показывает подсказку и выполняет действие. Новый источник добавляется функцией, которая возвращает
// кандидатов {kind, label, distance, run}, — обработчик клавиатуры один (input.js → activate()).
//
// Правила выбора: побеждает ближайшая цель; предметы с учётом направления взгляда; цель за стеной недоступна;
// предмет в руках всегда можно поставить (виртуальная дистанция PLACE_RANK), но вплотную к двери или NPC важнее.
import { INTERACT_LIMITS, PROP_TYPES } from '../../../shared/interaction-contracts.js';
import { pickCityInteraction } from '../city-interactions.js';

/** Виртуальная дистанция действия «Поставить»: ближе к игроку, чем вход, но не ближе, чем дверь или NPC под руками. */
export const PLACE_RANK = 1.4;
/** Штраф дистанции предмета за взгляд «мимо» (до ×2 за спиной). */
const BEHIND_PENALTY = 1;
const MIN_ACTION_INTERVAL_MS = 220;
const ENTER_TIMEOUT_MS = 3000;

const forwardOf = (yaw) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });

/**
 * Пересекает ли отрезок (a → b) один из прямоугольников-препятствий высотой больше `minHeight`.
 * Цель внутри самого препятствия (дверь в стене здания) не считается заслонённой им.
 */
export function segmentBlocked(ax, az, bx, bz, colliders, { minHeight = 0.6, groundY = 0 } = {}) {
  const dx = bx - ax;
  const dz = bz - az;
  for (const c of colliders) {
    if ((c.maxY ?? 9) - groundY < minHeight || (c.minY ?? 0) > groundY + 1.2) continue;
    const inside = (x, z) => x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ;
    if (inside(ax, az) || inside(bx, bz)) continue;
    let t0 = 0;
    let t1 = 1;
    let hit = true;
    for (const [p, d, lo, hi] of [[ax, dx, c.minX, c.maxX], [az, dz, c.minZ, c.maxZ]]) {
      if (Math.abs(d) < 1e-9) {
        if (p < lo || p > hi) hit = false;
      } else {
        let ta = (lo - p) / d;
        let tb = (hi - p) / d;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) hit = false;
      }
    }
    if (hit) return true;
  }
  return false;
}

/**
 * Игровые цели вокруг игрока: мяч, предмет на земле, постановка предмета из рук.
 * @returns {{kind: 'kick'|'take'|'place', id: string, label: string, distance: number, score: number} | null}
 */
export function pickWorldInteraction({ player, props = [], balls = [], held = null, colliders = [] }) {
  if (!Number.isFinite(player?.x) || !Number.isFinite(player?.z)) return null;
  const fwd = Number.isFinite(player.yaw) ? forwardOf(player.yaw) : null;
  const candidates = [];
  const facing = (dx, dz, d) => (fwd && d > 0.3 ? (dx * fwd.x + dz * fwd.z) / d : 1);
  const visible = (x, z) => !segmentBlocked(player.x, player.z, x, z, colliders);

  for (const ball of balls) {
    const dx = ball.x - player.x;
    const dz = ball.z - player.z;
    const d = Math.hypot(dx, dz);
    if (d > INTERACT_LIMITS.KICK_REACH || !visible(ball.x, ball.z)) continue;
    const dot = facing(dx, dz, d);
    candidates.push({ kind: 'kick', id: ball.id, label: 'Пнуть мяч', distance: d, score: d * (1 + BEHIND_PENALTY * Math.max(0, 1 - dot) * 0.5) });
  }
  if (held) {
    candidates.push({ kind: 'place', id: held.id, label: `Поставить ${PROP_TYPES[held.type]?.label ?? 'предмет'}`, distance: PLACE_RANK, score: PLACE_RANK });
  } else {
    for (const prop of props) {
      if (prop.state === 'held') continue;
      const dx = prop.x - player.x;
      const dz = prop.z - player.z;
      const d = Math.hypot(dx, dz);
      if (d > INTERACT_LIMITS.TAKE_REACH || !visible(prop.x, prop.z)) continue;
      const dot = facing(dx, dz, d);
      candidates.push({ kind: 'take', id: prop.id, label: `Взять ${PROP_TYPES[prop.type]?.label ?? 'предмет'}`, distance: d, score: d * (1 + BEHIND_PENALTY * Math.max(0, 1 - dot) * 0.5) });
    }
  }
  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) => (c.score < best.score ? c : best));
}

/** Общий выбор: города (вход, двери, ворота, NPC) и мира (мяч, предметы). */
export function pickInteraction(ctx) {
  const base = pickCityInteraction(ctx.player, ctx.entrances, ctx.mechanisms, ctx.npc);
  const world = pickWorldInteraction(ctx);
  if (!world) return base;
  if (!base) return world;
  // Дистанция входа — расстояние до порога; пока игрок не вплотную, мяч и предмет рядом важнее.
  return world.score <= base.distance ? world : base;
}

/**
 * @param {object} deps
 * @param {{send(msg: object): boolean, status?: string}} deps.net
 * @param {{request(id: string, active: boolean, fallback?: (open: boolean) => void): boolean}} deps.mechSync
 * @param {() => number} [deps.now]
 * @param {(href: string) => void} deps.navigate переход на страницу станции
 * @param {(text: string) => void} [deps.notify] короткое сообщение игроку
 * @param {() => void} [deps.onNpc] нажата E у NPC
 * @param {(action: string, id: string) => void} [deps.onAction] локальная реакция (анимация) до ответа сервера
 */
export function createInteractionManager({ net, mechSync, now = () => performance.now(), navigate, notify = () => {}, onNpc = () => {}, onAction = () => {} }) {
  let seq = 0;
  let lastAt = -Infinity;
  let navigating = false;
  /** @type {{href: string, door: object, since: number} | null} */
  let pendingEnter = null;
  /** @type {Map<number, {action: string, id: string}>} */
  const pending = new Map();
  let doors = [];

  const connected = () => net.status === undefined || net.status === 'open';

  function go(href) {
    if (navigating) return;
    navigating = true;
    navigate(href);
  }

  /** Вход: если дверь рядом, она сначала открывается, переход — когда створки раскрылись. */
  function enter(target, player) {
    const door = doors.find((d) => d.kind === 'door' && d.href === target.href);
    if (!door) return go(target.href);
    if (door.object.isOpen) return go(target.href);
    const near = Math.hypot(player.x - door.x, player.z - door.z) <= door.radius;
    if (!near) return go(target.href); // издали открывать нечего: прежнее поведение входа
    if (!pendingEnter) {
      pendingEnter = { href: target.href, door, since: now() };
      mechSync.request(door.id, true, (open) => (open ? door.object.open() : door.object.close()));
    }
  }

  return {
    /** Список механизмов загруженных чанков (для входа через дверь). */
    setMechanisms(list) {
      doors = list;
    },
    pick: pickInteraction,
    get busy() {
      return navigating || pendingEnter !== null;
    },
    /** Нажата E: выполняет выбранную цель. @returns {boolean} было ли действие */
    activate(target, player) {
      const t = now();
      if (navigating || pendingEnter) return false;
      if (t - lastAt < MIN_ACTION_INTERVAL_MS) return false;
      lastAt = t;
      if (!target) {
        onNpc(null);
        return false;
      }
      if (target.kind === 'npc') {
        onNpc(target.npc);
        return true;
      }
      if (target.href) {
        enter(target, player);
        return true;
      }
      if (target.mechanism) {
        const { id, object } = target.mechanism;
        mechSync.request(id, !object.wantsOpen, (open) => (open ? object.open() : object.close()));
        return true;
      }
      if (target.kind === 'take' || target.kind === 'place' || target.kind === 'kick') {
        if (!connected()) {
          notify('Нет соединения с сервером');
          return false;
        }
        seq += 1;
        const action = target.kind;
        if (net.send({ t: 'interact', id: target.id, action, seq })) {
          pending.set(seq, { action, id: target.id });
          onAction(action, target.id);
          return true;
        }
      }
      return false;
    },
    /** interact_result от сервера. */
    onResult(msg) {
      const request = pending.get(msg.seq);
      pending.delete(msg.seq);
      if (!msg.ok && msg.message) notify(msg.message);
      return request ?? null;
    },
    /** Каждый кадр: ждёт открытия двери, затем переходит на страницу станции. */
    update() {
      if (!pendingEnter) return;
      const { door, href, since } = pendingEnter;
      if (door.object.isOpen || door.object.progress >= 0.98 || now() - since > ENTER_TIMEOUT_MS) {
        pendingEnter = null;
        go(href);
      }
    },
    reset() {
      pendingEnter = null;
      navigating = false;
      pending.clear();
    },
  };
}

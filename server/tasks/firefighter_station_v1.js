// Серверное задание станции «Пожарный»: прогресс в SQLite (task_progress) по авторизованному userId.
// Правила переходов — чистый автомат клиентского state.js (одна копия правил). Здесь добавляются
// то, что клиенту доверять нельзя: владелец прогресса, позиция игрока, направление и частота.
// Из payload читается только `action`; state, progress, done, координаты и userId игнорируются.
//
// Обработчик синхронный (better-sqlite3), поэтому два действия одного игрока не перемешиваются.

import { FIRE_HIT_LIMIT, createInitialState, transitionTask } from '../../client/stations/firefighter/state.js';
import { VERTICAL_TOLERANCE, WORLD_POINTS } from '../../client/stations/firefighter/layout.js';

export const FIREFIGHTER_TASK_ID = 'firefighter_station_v1';
export const FIRE_HIT_COOLDOWN_MS = 120;
/** Допустимое отклонение взгляда игрока от направления на мишень при `fire_hit` (рад). */
export const AIM_TOLERANCE_RAD = 0.45;
/** Ближе этого расстояния до мишени направление не определено (м). */
export const MIN_AIM_DISTANCE = 0.5;

/** Какой точкой ограничено каждое действие. Для fire_hit дополнительно проверяется взгляд на target. */
const POINT_BY_ACTION = Object.freeze({
  start: 'npc',
  accept_briefing: 'npc',
  equip: 'locker',
  fire_hit: 'hose',
  pickup_mannequin: 'mannequin',
  deliver_mannequin: 'safe_zone',
  report: 'npc',
});

const STAGES = ['not_started', 'briefing', 'equipping', 'fire_drill', 'rescue', 'debrief', 'completed'];

const STORAGE_ERROR = 'Сервер не смог сохранить прогресс. Действие не засчитано, попробуйте ещё раз.';

const finite = (v) => Number.isFinite(v);

function isStoredState(state) {
  return (
    state !== null &&
    typeof state === 'object' &&
    STAGES.includes(state.stage) &&
    typeof state.equipped === 'boolean' &&
    Number.isInteger(state.fireHits) &&
    state.fireHits >= 0 &&
    state.fireHits <= FIRE_HIT_LIMIT &&
    typeof state.carryingMannequin === 'boolean' &&
    typeof state.mannequinDelivered === 'boolean'
  );
}

/** Только известные поля: лишнее из базы клиенту не отдаётся. */
function cleanState(state) {
  const { stage, equipped, fireHits, carryingMannequin, mannequinDelivered } = state;
  return { stage, equipped, fireHits, carryingMannequin, mannequinDelivered };
}

const reply = (state, feedback = '', changed = false, error) => ({
  state: cleanState(state),
  done: state.stage === 'completed',
  feedback,
  changed,
  ...(error ? { error } : {}),
});

function horizontalDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function isNear(position, point) {
  return (
    finite(position?.x) &&
    finite(position?.y) &&
    finite(position?.z) &&
    horizontalDistance(position, point) <= point.radius &&
    Math.abs(position.y - point.y) <= VERTICAL_TOLERANCE
  );
}

/** Смотрит ли игрок (yaw: 0 вдоль −Z, как в протоколе) на точку в пределах допуска. */
function isAimedAt(position, yaw, point) {
  if (!finite(yaw)) return false;
  const dx = point.x - position.x;
  const dz = point.z - position.z;
  if (Math.hypot(dx, dz) < MIN_AIM_DISTANCE) return false;
  const wanted = Math.atan2(-dx, -dz);
  const delta = Math.atan2(Math.sin(wanted - yaw), Math.cos(wanted - yaw));
  return Math.abs(delta) <= AIM_TOLERANCE_RAD;
}

/**
 * @param {object} deps
 * @param {{getTaskProgress: Function, saveTaskProgress: Function}} deps.db
 * @param {() => number} [deps.now]
 * @param {{warn?: Function, error?: Function}} [deps.log]
 * @param {typeof WORLD_POINTS} [deps.points] мировые точки станции (тестам нужны свои)
 */
export function createFirefighterTask({ db, now = Date.now, log = console, points = WORLD_POINTS }) {
  const lastHitAt = new Map();

  function load(userId) {
    const saved = db.getTaskProgress(userId, FIREFIGHTER_TASK_ID);
    return saved && isStoredState(saved.state) ? saved.state : createInitialState();
  }

  return {
    taskId: FIREFIGHTER_TASK_ID,

    /** Сохранённое состояние (после hello и переподключения). Бросает, если база недоступна. */
    getState(userId) {
      return reply(load(userId));
    },

    /**
     * Одно намерение игрока. `context` — только данные сервера: { position: {x, y, z}, yaw }.
     * Не бросает при сбое записи: возвращает прежнее состояние с error: 'storage'.
     */
    handle(userId, payload, context) {
      if (!Number.isInteger(userId) || userId <= 0) throw new TypeError('нужен userId авторизованного соединения');
      const state = load(userId);
      const action = payload !== null && typeof payload === 'object' && typeof payload.action === 'string' ? payload.action : '';
      if (action === 'resume') return reply(state);
      if (!Object.hasOwn(POINT_BY_ACTION, action)) return reply(state, 'Это действие сейчас недоступно.');

      const transition = transitionTask(state, { type: action });
      if (!transition.changed) return reply(state, transition.feedback);

      const position = context?.position;
      if (!isNear(position, points[POINT_BY_ACTION[action]])) {
        return reply(state, 'Подойдите к нужному объекту, чтобы выполнить действие.');
      }
      const t = now();
      if (action === 'fire_hit') {
        if (!isAimedAt(position, context?.yaw, points.target)) return reply(state, 'Направьте учебный рукав на мишень.');
        const last = lastHitAt.get(userId);
        if (last !== undefined && t - last < FIRE_HIT_COOLDOWN_MS) return reply(state);
      }

      const next = transition.state;
      try {
        db.saveTaskProgress(userId, FIREFIGHTER_TASK_ID, { state: cleanState(next), done: next.stage === 'completed' }, t);
      } catch (err) {
        log.error?.({ err, userId }, 'не удалось сохранить прогресс задания');
        return reply(state, STORAGE_ERROR, false, 'storage');
      }
      if (action === 'fire_hit') lastHitAt.set(userId, t);
      return reply(next, transition.feedback, true);
    },

    forget(userId) {
      lastHitAt.delete(userId);
    },
  };
}

export const STORAGE_ERROR_TEXT = STORAGE_ERROR;

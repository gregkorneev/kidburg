// Server-side adapter for the station's existing pure state machine.
// Position and interaction points must come from trusted server-side context.
import { createInitialState, transitionTask } from '../../client/stations/firefighter/state.js';

export const FIREFIGHTER_TASK_ID = 'firefighter_station_v1';

const INTERACTION_BY_ACTION = Object.freeze({
  start: 'npc',
  accept_briefing: 'npc',
  equip: 'locker',
  fire_hit: 'target',
  pickup_mannequin: 'mannequin',
  deliver_mannequin: 'safe_zone',
  report: 'npc',
});

function isPoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
    && Number.isFinite(point.radius) && point.radius > 0;
}

function isNear(playerPosition, point) {
  return playerPosition
    && Number.isFinite(playerPosition.x)
    && Number.isFinite(playerPosition.y)
    && Number.isFinite(playerPosition.z)
    && isPoint(point)
    && Math.hypot(
      playerPosition.x - point.x,
      playerPosition.y - point.y,
      playerPosition.z - point.z,
    ) <= point.radius;
}

function isPersistedState(state) {
  return state
    && typeof state === 'object'
    && ['not_started', 'briefing', 'equipping', 'fire_drill', 'rescue', 'debrief', 'completed'].includes(state.stage)
    && typeof state.equipped === 'boolean'
    && Number.isInteger(state.fireHits)
    && state.fireHits >= 0
    && state.fireHits <= 18
    && typeof state.carryingMannequin === 'boolean'
    && typeof state.mannequinDelivered === 'boolean';
}

function result(state, feedback, changed = false) {
  return { state, done: state.stage === 'completed', feedback, changed };
}

/**
 * Apply one station action to the per-user SQLite record.
 *
 * `playerPosition` is deliberately a separate server-only argument. Never copy
 * coordinates, progress, completion flags, or state from the client payload.
 * Interaction point coordinates are injected by the eventual world/network
 * integration; they are not guessed from the standalone preview scene.
 */
export function handleFirefighterTask({
  db,
  userId,
  taskId = FIREFIGHTER_TASK_ID,
  payload,
  playerPosition,
  interactionPoints,
  now = Date.now,
}) {
  if (taskId !== FIREFIGHTER_TASK_ID) {
    return result(createInitialState(), 'Неизвестное задание.');
  }
  if (!db || typeof db.getTaskProgress !== 'function' || typeof db.saveTaskProgress !== 'function') {
    throw new TypeError('Для задания нужен адаптер SQLite с getTaskProgress и saveTaskProgress.');
  }
  if (!Number.isInteger(userId) || userId <= 0) throw new TypeError('Нужен авторизованный userId сервера.');

  const saved = db.getTaskProgress(userId, FIREFIGHTER_TASK_ID);
  const state = saved && isPersistedState(saved.state) ? saved.state : createInitialState();
  const actionType = payload && typeof payload.action === 'string' ? payload.action : '';
  const pointName = INTERACTION_BY_ACTION[actionType];
  if (!pointName) return result(state, 'Это действие сейчас недоступно.');

  const point = interactionPoints?.[pointName];
  if (!isNear(playerPosition, point)) {
    return result(state, 'Подойдите к нужному объекту, чтобы выполнить действие.');
  }

  // Only the action name is read from payload. Client state/progress/done/position
  // fields are ignored; the transition and done flag are derived on the server.
  const transition = transitionTask(state, { type: actionType });
  if (!transition.changed) return result(state, transition.feedback);

  const done = transition.state.stage === 'completed';
  db.saveTaskProgress(userId, FIREFIGHTER_TASK_ID, { state: transition.state, done }, now());
  return result(transition.state, transition.feedback, true);
}

export function getFirefighterTaskState(db, userId) {
  const saved = db.getTaskProgress(userId, FIREFIGHTER_TASK_ID);
  const state = saved && isPersistedState(saved.state) ? saved.state : createInitialState();
  return result(state, '', false);
}

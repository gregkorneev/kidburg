// Task dispatcher (role 4). The WebSocket owner calls this after authentication
// and supplies player position/heading separately from the client payload.
import {
  FIREFIGHTER_TASK_ID,
  getFirefighterTaskState,
  handleFirefighterTask,
} from './firefighter_station_v1.js';

let taskContext = null;

function requireContext() {
  if (!taskContext) throw new Error('Задачи ещё не зарегистрированы через registerTasks().');
  return taskContext;
}

async function dispatch(ctx, userId, taskId, payload, serverContext = {}) {
  if (taskId !== FIREFIGHTER_TASK_ID) {
    return { state: {}, done: false, feedback: 'Неизвестное задание.' };
  }

  return handleFirefighterTask({
    db: ctx.db,
    userId,
    taskId,
    payload,
    playerPosition: serverContext.playerPosition,
    playerYaw: serverContext.playerYaw,
    interactionPoints: serverContext.interactionPoints ?? ctx.config.firefighterInteractionPoints,
    now: serverContext.now ?? ctx.config.now ?? Date.now,
  });
}

function readState(ctx, userId, taskId = FIREFIGHTER_TASK_ID) {
  if (taskId !== FIREFIGHTER_TASK_ID) return { state: {}, done: false, feedback: '' };
  return getFirefighterTaskState(ctx.db, userId);
}

/**
 * @returns {Promise<{state:object, done:boolean, feedback?:string}>}
 * `serverContext` is a server-only optional extension for the WebSocket bridge;
 * never derive its fields from the client payload.
 */
export async function handle(userId, taskId, payload, serverContext = {}) {
  return dispatch(requireContext(), userId, taskId, payload, serverContext);
}

/** Read-only state query used to restore the station after hello/reconnect. */
export function getState(userId, taskId = FIREFIGHTER_TASK_ID) {
  return readState(requireContext(), userId, taskId);
}

/** ctx: { db, config, log } */
export function registerTasks(app, ctx) {
  if (!ctx?.db) throw new TypeError('registerTasks требует ctx.db.');
  taskContext = ctx;

  // createGame and registerTasks receive the same Fastify app in server/index.js.
  // This gives the network layer a named integration point without changing
  // shared protocol messages or adding routes/authentication here.
  if (app?.decorate && !app.hasDecorator?.('taskHandlers')) {
    app.decorate('taskHandlers', Object.freeze({
      handle: (userId, taskId, payload, serverContext) => dispatch(ctx, userId, taskId, payload, serverContext),
      getState: (userId, taskId) => readState(ctx, userId, taskId),
    }));
  }
}

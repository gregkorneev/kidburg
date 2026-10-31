// Задания (роль 4). registerTasks(app, ctx) создаёт обработчики и кладёт их в app.taskHandlers;
// сетевой слой (server/net/game.js) вызывает их с userId и позицией из серверного соединения.

import { FIREFIGHTER_TASK_ID, createFirefighterTask } from './firefighter_station_v1.js';

/** ctx: { db, config, log } */
export function registerTasks(app, ctx) {
  const firefighter = createFirefighterTask({ db: ctx.db, now: ctx.config?.now, log: ctx.log });
  const byId = new Map([[firefighter.taskId, firefighter]]);

  const handlers = Object.freeze({
    /** Задания, чьё состояние отправляется игроку после hello. */
    taskIds: Object.freeze([...byId.keys()]),
    has: (taskId) => byId.has(taskId),
    getState: (userId, taskId) => byId.get(taskId).getState(userId),
    handle: (userId, taskId, payload, serverContext) => byId.get(taskId).handle(userId, payload, serverContext),
    /**
     * Ход задания для разговора с NPC: {key, label, text} или null, если у этого NPC нет задания.
     * Данные берутся из сохранённого состояния игрока, а не из сообщений клиента.
     */
    describeForAgent: (userId, agentId) => {
      for (const task of byId.values()) if (task.agentId === agentId) return task.describe?.(userId) ?? null;
      return null;
    },
    forget: (userId) => byId.forEach((task) => task.forget?.(userId)),
  });
  app.decorate('taskHandlers', handlers);
}

export { FIREFIGHTER_TASK_ID };

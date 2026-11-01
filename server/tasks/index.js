// Задания (роль 4). registerTasks(app, ctx) создаёт обработчики и кладёт их в app.taskHandlers;
// сетевой слой (server/net/game.js) вызывает их с userId и позицией из серверного соединения.

import { FIREFIGHTER_TASK_ID, createFirefighterTask } from './firefighter_station_v1.js';
import { RADIO_TASK_ID, createRadioTask } from './radio_station_v1.js';
import { generateRadioScript } from '../agents/index.js';
import { createBakeryTask, createFloristTask, createPianistTask } from './station_tasks.js';

/** ctx: { db, config, log } */
export function registerTasks(app, ctx) {
  const firefighter = createFirefighterTask({ db: ctx.db, now: ctx.config?.now, log: ctx.log });
  const radio = createRadioTask({ db: ctx.db, now: ctx.config?.now, log: ctx.log, generateRadioScript });
  const deps = { db: ctx.db, now: ctx.config?.now, log: ctx.log };
  // Станции с локальными координатами подтверждают прогресс на сервере (station_tasks.js).
  const stationTasks = [createBakeryTask(deps), createFloristTask(deps), createPianistTask(deps)];
  const byId = new Map([[firefighter.taskId, firefighter], [radio.taskId, radio], ...stationTasks.map((t) => [t.taskId, t])]);

  const handlers = Object.freeze({
    /** Задания, чьё состояние отправляется игроку после hello. */
    taskIds: Object.freeze([...byId.keys()]),
    /** agentId -> taskId: у каких агентов есть задание (для панели администратора: где размещён агент). */
    agentTasks: Object.freeze(Object.fromEntries([...byId.values()].filter((t) => t.agentId).map((t) => [t.agentId, t.taskId]))),
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
    /** Игрок вошёл в станцию (station_enter): задания этой станции сбрасывают временные признаки сессии. */
    enterStation: (userId, stationId) => stationTasks.forEach((task) => task.stationId === stationId && task.enterStation?.(userId)),
    forget: (userId) => byId.forEach((task) => task.forget?.(userId)),
  });
  app.decorate('taskHandlers', handlers);
}

export { FIREFIGHTER_TASK_ID, RADIO_TASK_ID };

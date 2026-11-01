// Зеркало прогресса станции на сервере (server/tasks/station_tasks.js).
//
// Станция по-прежнему применяет действие сразу у себя (звук, анимация, отклик без задержки сети), а здесь
// то же действие уходит на сервер через task_answer. Сервер повторяет его по тем же правилам, проверяет станцию
// и расстояние и присылает task_state. Когда ответы на все отправленные действия получены и сервер
// расходится с локальным состоянием, побеждает сервер (его факты видит наставник): станция получает adopt().
// Исключение — действия, совершённые без связи: пока они не подтверждены, серверное состояние старее
// локального, и откатывать игрока к нему нельзя.

export const PENDING_TTL_MS = 2500;

/**
 * @param {object} deps
 * @param {{on(type: string, handler: Function): () => void, net: {send(msg: object): boolean}}} deps.api
 * @param {string} deps.taskId
 * @param {(state: object) => unknown} deps.project подтверждаемая часть состояния (локальное и серверное сравниваются по ней)
 * @param {() => object} deps.getLocal
 * @param {(serverState: object) => void} deps.adopt принять состояние сервера
 * @param {() => boolean} deps.canSend есть ли сессия станции на сервере
 * @param {() => number} [deps.now]
 */
export function createStationProgress({ api, taskId, project, getLocal, adopt, canSend, onDiverged = () => {}, onReject = () => {}, now = () => performance.now(), timers = globalThis }) {
  let pending = []; // метки времени отправленных действий, на которые ответ ещё не пришёл
  let diverged = false; // действие выполнено без связи с сервером
  let timer = null;
  const markDiverged = () => {
    if (!diverged) onDiverged();
    diverged = true;
  };
  const same = (a, b) => JSON.stringify(project(a)) === JSON.stringify(project(b));
  const prune = () => {
    const t = now();
    const remaining = pending.filter((at) => t - at < PENDING_TTL_MS);
    if (remaining.length !== pending.length) markDiverged();
    pending = remaining;
  };
  const schedule = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
    if (!pending.length) return;
    timer = timers.setTimeout(() => {
      timer = null;
      prune();
      schedule();
    }, Math.max(0, PENDING_TTL_MS - (now() - pending[0])));
    timer?.unref?.();
  };

  const offs = [
    api.on('task_state', (msg) => {
      if (msg.taskId !== taskId || msg.state === null || typeof msg.state !== 'object') return;
      prune();
      if (pending.length && msg.state.changed === false && typeof msg.state.feedback === 'string' && msg.state.feedback) onReject(msg.state.feedback);
      if (pending.length) pending.shift();
      schedule();
      if (msg.state.error) markDiverged();
      if (pending.length) return; // ждём остальные ответы: промежуточные состояния сервера не показываем
      if (diverged) return;
      const { done, feedback, changed, error, ...serverState } = msg.state;
      if (typeof serverState.stage !== 'string') return;
      if (!same(serverState, getLocal())) adopt(serverState);
    }),
    // После переподключения сервер заново присылает task_state; прежние ожидания уже недействительны.
    api.on('welcome', () => {
      if (pending.length) markDiverged();
      pending = [];
      schedule();
    }),
    api.on('status', ({ status }) => {
      if (status !== 'open' && pending.length) {
        markDiverged();
        pending = [];
        schedule();
      }
    }),
  ];

  return {
    /** Отправляет действие на сервер. @returns {boolean} ушло ли */
    send(payload) {
      if (!canSend() || !api.net.send({ t: 'task_answer', taskId, payload })) {
        markDiverged();
        return false;
      }
      prune();
      pending.push(now());
      schedule();
      return true;
    },
    get pending() {
      prune();
      schedule();
      return pending.length;
    },
    get diverged() {
      return diverged;
    },
    dispose() {
      if (timer !== null) timers.clearTimeout(timer);
      for (const off of offs) off();
    },
  };
}

// Задание станции: клиент только просит выполнить действие, а состояние приходит с сервера
// (task_state). Локального автомата в игровом режиме нет: интерфейс показывает то, что сервер
// записал в SQLite. Протокол и проверки: docs/PROJECT_CONTEXT.md, content/firefighter/FIREFIGHTER_STATION.md.

import { createInitialState } from './state.js';

export const TASK_ID = 'firefighter_station_v1';
const REPLY_TIMEOUT_MS = 5000;

const pickState = (s) => ({
  stage: s.stage,
  equipped: s.equipped === true,
  fireHits: Number.isInteger(s.fireHits) ? s.fireHits : 0,
  carryingMannequin: s.carryingMannequin === true,
  mannequinDelivered: s.mannequinDelivered === true,
});

/**
 * @param {object} deps
 * @param {{on(type: string, handler: Function): () => void, net: {send(msg: object): boolean}}} deps.api
 * @param {(state: object, meta: {changed: boolean, done: boolean, feedback: string}) => void} deps.onState подтверждённое сервером состояние
 * @param {(text: string) => void} deps.onNotice
 * @param {(busy: boolean) => void} [deps.onBusy] ждём ответ на действие
 * @param {() => void} [deps.beforeSend] вызывается перед отправкой (preview досылает позицию и взгляд)
 */
export function createTaskSync({ api, onState, onNotice, onBusy = () => {}, beforeSend = () => {}, timers = globalThis }) {
  let state = createInitialState();
  let pending = null;
  let timer = null;

  const settle = () => {
    clearTimeout(timer);
    timer = null;
    if (pending) {
      pending = null;
      onBusy(false);
    }
  };

  const off = api.on('task_state', (msg) => {
    if (msg.taskId !== TASK_ID) return;
    const s = msg.state;
    if (s?.error) {
      // Не засчитано: интерфейс остаётся на последнем подтверждённом состоянии.
      const rejected = pending;
      settle();
      onNotice(s.feedback || 'Сервер не смог выполнить действие.');
      rejected?.onRejected?.();
      return;
    }
    if (!s || typeof s.stage !== 'string') return;
    state = pickState(s);
    const changed = s.changed === true;
    const settled = pending;
    settle();
    onState(state, { changed, done: s.done === true, feedback: typeof s.feedback === 'string' ? s.feedback : '' });
    if (!settled) return;
    if (changed) settled.onConfirmed?.(state);
    else {
      if (s.feedback) onNotice(s.feedback);
      settled.onRejected?.();
    }
  });

  return {
    get state() {
      return state;
    },
    get busy() {
      return pending !== null;
    },
    /**
     * Отправляет намерение. Пока ждём ответ на обычное действие, второе не отправляется;
     * серия fire_hit идёт без ожидания (сервер сам ограничивает частоту).
     */
    send(action, { onConfirmed, onRejected } = {}) {
      if (pending && action !== 'fire_hit') return false;
      beforeSend();
      if (!api.net.send({ t: 'task_answer', taskId: TASK_ID, payload: { action } })) {
        onNotice('Нет связи с сервером. Прогресс не изменён.');
        onRejected?.();
        return false;
      }
      if (action !== 'fire_hit') {
        pending = { action, onConfirmed, onRejected };
        onBusy(true);
        timer = timers.setTimeout(() => {
          const lost = pending;
          settle();
          onNotice('Сервер не ответил. Проверьте связь и повторите.');
          lost?.onRejected?.();
        }, REPLY_TIMEOUT_MS);
      }
      return true;
    },
    /** Выход или потеря сессии: возвращаемся к чистому состоянию до нового task_state. */
    reset() {
      settle();
      state = createInitialState();
      onState(state, { changed: false, done: false, feedback: '' });
    },
    dispose() {
      settle();
      off();
    },
  };
}

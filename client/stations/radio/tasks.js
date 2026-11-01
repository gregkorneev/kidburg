// Клиентское намерение отделено от состояния Radio, которое всегда приходит через task_state.
export const TASK_ID = 'radio_station_v1';

const validStage = new Set(['idle', 'choose_topic', 'ready', 'on_air', 'completed']);
const validActions = new Set(['open', 'generate_script', 'start_broadcast', 'complete_broadcast', 'new_broadcast']);

function cleanState(raw) {
  if (!raw || !validStage.has(raw.stage)) return null;
  const category = raw.category === 'weather' || raw.category === 'science' ? raw.category : null;
  const script = raw.script &&
    (raw.script.category === 'weather' || raw.script.category === 'science') &&
    typeof raw.script.title === 'string' && typeof raw.script.text === 'string'
    ? {
        category: raw.script.category,
        ...(typeof raw.script.topicId === 'string' ? { topicId: raw.script.topicId } : {}),
        title: raw.script.title,
        text: raw.script.text,
        source: raw.script.source === 'offline_fallback' ? 'offline_fallback' : 'ollama',
      }
    : null;
  return { stage: raw.stage, category, script };
}

/** Не ставит короткий timeout: локальная Ollama может готовить сценарий дольше. */
export function createRadioTaskSync({ api, onState = () => {}, onNotice = () => {}, onPending = () => {}, onConnection = () => {} }) {
  let state = null;
  let pending = null;
  let connected = api.net.status === 'open';
  let welcomed = false;
  const offs = [];

  offs.push(api.on('task_state', (message) => {
    if (message.taskId !== TASK_ID) return;
    const incoming = cleanState(message.state);
    const previousStage = state?.stage ?? null;
    if (pending) {
      pending = null;
      onPending(null);
    }
    if (!incoming) {
      if (message.state?.feedback) onNotice(message.state.feedback);
      else onNotice('Не удалось прочитать сохранённое состояние Radio. Переподключитесь и попробуйте снова.');
      return;
    }
    state = incoming;
    if (message.state?.feedback && (!message.state.changed || message.state.error)) onNotice(message.state.feedback);
    onState(state, {
      changed: message.state.changed === true,
      done: message.state.done === true,
      feedback: typeof message.state.feedback === 'string' ? message.state.feedback : '',
      previousStage,
    });
  }));

  offs.push(api.on('status', ({ status }) => {
    // На переподключении сокет открывается раньше hello/welcome; ждём серверный snapshot.
    if (status === 'open') {
      if (!welcomed) {
        connected = true;
        onConnection(true);
      }
      return;
    }
    const online = false;
    if (online === connected) return;
    connected = online;
    onConnection(connected);
    if (!connected && pending) {
      pending = null;
      onPending(null);
      onNotice('Связь потеряна. Radio восстановит экран по сохранённому состоянию после переподключения.');
    }
  }));

  offs.push(api.on('welcome', () => {
    welcomed = true;
    connected = true;
    onConnection(true);
  }));

  return {
    get state() { return state; },
    get pending() { return pending; },
    get connected() { return connected; },
    send(action) {
      if (pending || !connected || !validActions.has(action)) return false;
      if (!api.net.send({ t: 'task_answer', taskId: TASK_ID, payload: { action } })) {
        onNotice('Нет связи с сервером. Состояние не изменено.');
        return false;
      }
      pending = action;
      onPending(pending);
      return true;
    },
    dispose() {
      for (const off of offs) off();
      pending = null;
    },
  };
}

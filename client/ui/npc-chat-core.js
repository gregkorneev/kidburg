// Разговор с NPC: состояние и сетевая логика без DOM (отображение — npc-chat.js).
//
// Клиент только отправляет npc_talk и показывает то, что прислал сервер: agent_queue, agent_token,
// agent_done, agent_error. Ответ не имитируется, повторных попыток нет; отмена и сбой связи
// заканчивают запрос ошибкой, после которой можно отправить следующую реплику.

export const MAX_TEXT = 300; // совпадает с npcTalkMaxChars сервера по умолчанию
export const REPLY_TIMEOUT_MS = 90_000; // тишина от сервера дольше этого срока — ошибка
export const MAX_MESSAGES = 40; // длина показываемой переписки на собеседника

/** Названия по agentId: имени NPC в данных чанка нет (shared/chunk-format.md). */
export const NPC_TITLES = Object.freeze({
  therapist: 'Терапевт',
  nurse: 'Медсестра',
  marusya: 'Маруся Громова',
});

const TEXT_ERRORS = new Set(['too_far', 'rate_limit', 'bad_msg']);

/**
 * @param {object} deps
 * @param {{on(type: string, handler: Function): () => void, net: {send(msg: object): boolean, status: string},
 *   state?: {me: object|null}, ui?: {lockPointer?: Function, unlockPointer?: Function}}} deps.api
 * @param {{setTimeout: Function, clearTimeout: Function}} [deps.timers]
 * @param {number} [deps.replyTimeoutMs]
 */
export function createNpcChat({ api, timers = globalThis, replyTimeoutMs = REPLY_TIMEOUT_MS }) {
  const state = {
    open: false,
    npc: null, // {agentId, name}: собеседник открытой панели
    near: null, // ближайший NPC в зоне разговора (событие npc_near)
    online: Boolean(api.state?.me),
    messages: [], // [{id, from: 'me'|'npc', text, pending}]
    status: 'idle', // idle | waiting | queued | streaming
    queue: null, // позиция в очереди генераций
    error: '',
  };
  const histories = new Map(); // agentId -> сообщения, только в памяти страницы
  const listeners = new Set();
  const openListeners = new Set();
  let current = null; // {reqId, agentId, message, timer}
  let counter = 0;
  let nextId = 0;

  const emit = () => {
    for (const fn of [...listeners]) fn(state);
  };

  // Движок подставляет name = agentId, если в данных чанка имени нет: такое имя за настоящее не считаем.
  const nameOf = (npc) => {
    const own = npc?.name && npc.name !== npc.agentId ? npc.name : '';
    return own || NPC_TITLES[npc?.agentId] || npc?.agentId || 'Собеседник';
  };
  const person = (npc) => (npc ? { agentId: npc.agentId, name: nameOf(npc) } : null);

  function historyOf(agentId) {
    let list = histories.get(agentId);
    if (!list) histories.set(agentId, (list = []));
    return list;
  }

  function trim(list) {
    if (list.length > MAX_MESSAGES) list.splice(0, list.length - MAX_MESSAGES);
  }

  function arm() {
    if (!current) return;
    timers.clearTimeout(current.timer);
    current.timer = timers.setTimeout(() => finish({ error: 'Ответ не пришёл вовремя. Попробуйте ещё раз.' }), replyTimeoutMs);
  }

  /** Завершает текущий запрос: пустую «печатающую» реплику убирает, частичный ответ оставляет. */
  function finish({ error = '' } = {}) {
    if (!current) return;
    timers.clearTimeout(current.timer);
    const { message, agentId } = current;
    current = null;
    message.pending = false;
    if (!message.text) {
      const list = historyOf(agentId);
      const i = list.indexOf(message);
      if (i !== -1) list.splice(i, 1);
    }
    state.status = 'idle';
    state.queue = null;
    state.error = error;
    emit();
  }

  const isCurrent = (msg) => current && msg.reqId === current.reqId && msg.agentId === current.agentId;

  function setOpen(value) {
    if (state.open === value) return;
    state.open = value;
    try {
      if (value) api.ui?.unlockPointer?.();
      else api.ui?.lockPointer?.();
    } catch {
      // в сетевом режиме preview мышью управляет сцена
    }
    for (const fn of [...openListeners]) fn(value);
  }

  const offs = [
    api.on('npc_near', (npc) => {
      state.near = person(npc);
      emit();
    }),
    api.on('interact', (npc) => {
      if (!state.open && npc) controller.open(npc);
    }),
    api.on('welcome', () => {
      state.online = true;
      emit();
    }),
    api.on('status', ({ status }) => {
      if (status === 'open') return;
      if (current) finish({ error: 'Связь с сервером прервалась. Повторите реплику, когда она восстановится.' });
    }),
    api.on('auth', (info) => {
      if (info) return;
      if (current) timers.clearTimeout(current.timer);
      current = null;
      histories.clear();
      Object.assign(state, { npc: null, near: null, online: false, messages: [], status: 'idle', queue: null, error: '' });
      setOpen(false);
      emit();
    }),
    api.on('agent_queue', (msg) => {
      if (!isCurrent(msg)) return;
      state.status = 'queued';
      state.queue = msg.position;
      arm();
      emit();
    }),
    api.on('agent_token', (msg) => {
      if (!isCurrent(msg)) return;
      current.message.text += msg.token;
      state.status = 'streaming';
      state.queue = null;
      arm();
      emit();
    }),
    api.on('agent_done', (msg) => {
      if (isCurrent(msg)) finish();
    }),
    api.on('agent_error', (msg) => {
      if (isCurrent(msg)) finish({ error: msg.message || 'Собеседник не смог ответить.' });
    }),
    api.on('error', (msg) => {
      // too_far и rate_limit сервер дублирует agent_error, а bad_msg по npc_talk приходит одним error.
      if (current && TEXT_ERRORS.has(msg.code)) finish({ error: msg.message || 'Сообщение отклонено.' });
    }),
  ];

  const controller = {
    state,
    nameOf,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Вызывается при открытии/закрытии панели (preview блокирует управление сценой). */
    onOpenChange(fn) {
      openListeners.add(fn);
      return () => openListeners.delete(fn);
    },
    /** Открывает панель разговора. Возвращает false, если собеседник не указан. */
    open(npc) {
      if (!npc?.agentId) return false;
      state.npc = person(npc);
      state.messages = historyOf(npc.agentId);
      state.error = current && current.agentId !== npc.agentId ? 'Другой собеседник ещё отвечает.' : '';
      setOpen(true);
      emit();
      return true;
    },
    close() {
      if (!state.open) return;
      setOpen(false);
      emit();
    },
    /** Может ли игрок сейчас отправить реплику этому собеседнику. */
    get canSend() {
      return state.open && !current;
    },
    /** @returns {boolean} true, если npc_talk ушёл на сервер */
    send(text) {
      if (!state.open || !state.npc || current) return false;
      const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
      if (!clean) {
        state.error = 'Введите сообщение.';
        emit();
        return false;
      }
      if (clean.length > MAX_TEXT) {
        state.error = `Слишком длинное сообщение: не больше ${MAX_TEXT} символов.`;
        emit();
        return false;
      }
      if (api.net.status !== 'open') {
        state.error = 'Нет связи с сервером. Подождите, пока соединение восстановится.';
        emit();
        return false;
      }
      const { agentId } = state.npc;
      const reqId = `c${++counter}`;
      if (!api.net.send({ t: 'npc_talk', agentId, text: clean, reqId })) {
        state.error = 'Не удалось отправить сообщение. Повторите.';
        emit();
        return false;
      }
      const list = historyOf(agentId);
      list.push({ id: ++nextId, from: 'me', text: clean, pending: false });
      const reply = { id: ++nextId, from: 'npc', text: '', pending: true };
      list.push(reply);
      trim(list);
      current = { reqId, agentId, message: reply, timer: null };
      state.status = 'waiting';
      state.queue = null;
      state.error = '';
      arm();
      emit();
      return true;
    },
    dispose() {
      for (const off of offs) off();
      if (current) timers.clearTimeout(current.timer);
      current = null;
      listeners.clear();
      openListeners.clear();
    },
  };
  return controller;
}

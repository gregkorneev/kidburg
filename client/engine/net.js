// Транспорт WebSocket: тикет → сокет → hello → сообщения протокола.
// Все входящие сообщения уходят в шину событий по полю `t`; состояние соединения — событие 'status'.

import { PROTO, decode, encode, validate } from '../../shared/protocol.js';

// Коды закрытия, после которых переподключаться нельзя (server/net/game.js).
const CLOSE_REPLACED = 4000;
const CLOSE_NO_RETRY = new Set([4001, 4002]);

/**
 * Статусы: 'closed' | 'connecting' | 'open' | 'reconnecting' | 'denied'.
 * 'open' — сокет открыт и hello отправлен; готовность игры сообщает событие 'welcome'.
 *
 * @param {object} deps
 * @param {ReturnType<import('./http.js').createHttp>} deps.http
 * @param {ReturnType<import('./session.js').createSession>} deps.session
 * @param {ReturnType<import('./emitter.js').createEmitter>} deps.emitter
 */
export function createNet({
  http,
  session,
  emitter,
  WebSocketImpl = globalThis.WebSocket,
  location = globalThis.location,
  instance = 'city',
  retryMinMs = 1000,
  retryMaxMs = 5000,
}) {
  let status = 'closed';
  let wanted = false;
  let generation = 0; // номер попытки: события устаревших сокетов игнорируются
  let attempt = 0;
  let ws = null;
  let retryTimer = null;

  const setStatus = (next) => {
    if (next === status) return;
    status = next;
    emitter.emit('status', { status });
  };

  function wsUrl(ticket) {
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${scheme}//${location.host}/ws?ticket=${encodeURIComponent(ticket)}&instance=${encodeURIComponent(instance)}`;
  }

  function detach(socket) {
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
  }

  function scheduleReconnect() {
    if (!wanted) return;
    const delay = Math.min(retryMaxMs, retryMinMs * 2 ** attempt);
    attempt += 1;
    setStatus('reconnecting');
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void open();
    }, delay);
  }

  async function open() {
    const gen = ++generation;
    const token = session.token();
    if (!token) {
      wanted = false;
      setStatus('closed');
      return;
    }
    if (status !== 'reconnecting') setStatus('connecting');

    let ticket;
    try {
      ({ ticket } = await http.wsTicket(token));
    } catch (err) {
      if (gen !== generation) return;
      if (err.status === 401) {
        // Сессия закончилась: нужен новый вход.
        wanted = false;
        session.clear();
        setStatus('denied');
        emitter.emit('auth', null);
        return;
      }
      scheduleReconnect();
      return;
    }
    if (gen !== generation) return;

    const socket = new WebSocketImpl(wsUrl(ticket));
    socket.binaryType = 'arraybuffer';
    ws = socket;
    socket.onopen = () => {
      if (gen !== generation) return;
      socket.send(encode({ t: 'hello', ticket, proto: PROTO }));
      setStatus('open');
    };
    socket.onmessage = (ev) => {
      if (gen !== generation || typeof ev.data === 'string') return;
      let msg;
      try {
        msg = decode(new Uint8Array(ev.data));
      } catch {
        return;
      }
      if (msg && typeof msg.t === 'string') {
        if (msg.t === 'welcome') attempt = 0;
        emitter.emit(msg.t, msg);
      }
    };
    socket.onclose = (ev) => {
      detach(socket);
      if (gen !== generation) return;
      ws = null;
      if (ev.code === CLOSE_REPLACED) {
        wanted = false;
        setStatus('closed');
        emitter.emit('replaced', { code: ev.code });
      } else if (CLOSE_NO_RETRY.has(ev.code)) {
        wanted = false;
        setStatus('closed');
      } else {
        scheduleReconnect();
      }
    };
    // Ошибка всегда сопровождается close, отдельной обработки не нужно.
    socket.onerror = () => {};
  }

  function disconnect() {
    wanted = false;
    generation += 1;
    clearTimeout(retryTimer);
    retryTimer = null;
    if (ws) {
      detach(ws);
      ws.close(1000);
      ws = null;
    }
    attempt = 0;
    setStatus('closed');
  }

  return {
    get status() {
      return status;
    },
    /** Подключается с текущей сессией; повторный вызов при активном подключении ничего не делает. */
    connect() {
      if (wanted) return;
      wanted = true;
      attempt = 0;
      void open();
    },
    disconnect,
    /** Отправляет сообщение протокола. false — сообщение неверно или сокет не открыт. */
    send(msg) {
      if (!validate(msg, 'c2s').ok || !ws || ws.readyState !== 1) return false;
      ws.send(encode(msg));
      return true;
    },
  };
}

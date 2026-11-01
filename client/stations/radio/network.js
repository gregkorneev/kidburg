import { createEmitter } from '../../engine/emitter.js';
import { createHttp } from '../../engine/http.js';
import { createNet } from '../../engine/net.js';
import { createSession } from '../../engine/session.js';

/** Radio's network-only client: shared auth/HTTP/WebSocket helpers, with no city renderer imports. */
export function createRadioNetworkClient({
  http = createHttp(),
  session = createSession(),
  netFactory = createNet,
  location = globalThis.location,
  WebSocketImpl = globalThis.WebSocket,
  previewBootstrap = true,
  previewName = 'Radio Preview',
} = {}) {
  const emitter = createEmitter();
  const net = netFactory({ http, session, emitter, location, WebSocketImpl });
  const state = { me: null };
  let started = false;
  let stopped = false;

  const stateOffs = [
    emitter.on('welcome', (message) => {
      state.me = { id: message.playerId, name: message.name };
    }),
    emitter.on('auth', (info) => {
      state.me = info?.user ?? null;
    }),
  ];

  function start() {
    if (started || stopped) return;
    started = true;
    void restoreSession();
  }

  async function restoreSession() {
    const token = session.token();
    if (!token) {
      if (previewBootstrap) await bootstrapPreviewSession();
      else emitter.emit('auth', null);
      return;
    }
    try {
      const { user } = await http.me(token);
      if (stopped) return;
      session.save(token, user);
      emitter.emit('auth', { user });
      net.connect();
    } catch (error) {
      if (stopped) return;
      if (error.status === 401) {
        session.clear();
        if (previewBootstrap) await bootstrapPreviewSession();
        else emitter.emit('auth', null);
      } else {
        emitter.emit('auth', { user: session.user() });
        net.connect();
      }
    }
  }

  async function bootstrapPreviewSession() {
    if (stopped) return;
    try {
      const { room } = await http.localRoom();
      if (stopped) return;
      if (typeof room !== 'string' || !/^[A-Za-z]{4}$/.test(room)) {
        throw new Error('Preview-сессию можно создать в локальном Radio preview окружении.');
      }
      try {
        await api.auth.join(previewName, room.toUpperCase());
      } catch (error) {
        if (error.code !== 'name_taken') throw error;
        const suffix = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, '0');
        await api.auth.join(`${previewName} ${suffix}`, room.toUpperCase());
      }
    } catch (error) {
      if (stopped) return;
      emitter.emit('preview_error', {
        message: error?.message || 'Не удалось подключить Radio preview.',
      });
      emitter.emit('auth', null);
    }
  }

  function startSession(token, user) {
    if (stopped) throw new Error('Radio network client is stopped');
    net.disconnect();
    session.save(token, user);
    emitter.emit('auth', { user });
    net.connect();
    return user;
  }

  const api = {
    net: {
      send: (message) => net.send(message),
      on: (type, handler) => emitter.on(type, handler),
      disconnect: () => net.disconnect(),
      connect: () => net.connect(),
      get status() { return net.status; },
    },
    on: (type, handler) => emitter.on(type, handler),
    off: (type, handler) => emitter.off(type, handler),
    auth: {
      async join(name, room) {
        const { token, user } = await http.join(name, room);
        return startSession(token, user);
      },
      async localRoom() {
        try {
          const { room } = await http.localRoom();
          return typeof room === 'string' && /^[A-Za-z]{4}$/.test(room) ? room.toUpperCase() : null;
        } catch {
          return null;
        }
      },
      session() {
        const user = session.user();
        return user && session.token() ? { user } : null;
      },
      logout() {
        net.disconnect();
        session.clear();
        emitter.emit('auth', null);
      },
    },
    state: { get me() { return state.me; } },
  };

  function stop() {
    if (stopped) return;
    stopped = true;
    net.disconnect();
    for (const off of stateOffs) off();
    emitter.clear();
  }

  return { api, start, stop };
}

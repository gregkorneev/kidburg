// Сборка клиента: сеть и состояние создаются сразу (api доступен до start()),
// сцена, ввод и HUD — в start(). Всё, что создано, освобождается в stop().
// Описание api для интерфейса: client/engine/API.md.

import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { TALK_DISTANCE } from '../../shared/constants.js';
import { createHud } from '../hud/index.js';
import { createChunkManager, makeLabel } from './chunks.js';
import { createEmitter } from './emitter.js';
import { createHttp } from './http.js';
import { createInput } from './input.js';
import { createNet } from './net.js';
import { PLAYER, createPlayer, setPlayerPosition, stepPlayer } from './player.js';
import { createPool } from './pool.js';
import { createRemotePlayers } from './remote.js';
import { createSession } from './session.js';

const POS_INTERVAL_S = 1 / 15;
const POS_HEARTBEAT_S = 1;
const MIN_FRAME_MS = 1000 / 60 - 1; // потолок 60 FPS на экранах 120/144 Гц
const NPC_CHECK_MS = 100;
const PING_INTERVAL_MS = 2000;
const MOUSE_SENSITIVITY = 0.0025;
const MAX_PIXEL_RATIO = 1.5;

/** @param {{container: HTMLElement}} options */
export function createClient({ container, networkOnly = false }) {
  const emitter = createEmitter();
  const http = createHttp();
  const session = createSession();
  const net = createNet({ http, session, emitter });

  /** Состояние, видимое интерфейсу через api.state. */
  const state = { me: null, cache: null, npc: null, ping: null };
  let runtime = null;
  let stopped = false;

  // Состояние обновляется всегда (до start() тоже), раньше обработчиков интерфейса.
  const stateOffs = [
    emitter.on('welcome', (msg) => {
      state.me = { id: msg.playerId, name: msg.name };
      state.cache = null; // после (пере)подключения зеркало кеша на сервере новое
    }),
    emitter.on('cache_stats', ({ t, ...stats }) => {
      state.cache = stats;
    }),
    emitter.on('auth', (info) => {
      if (!info) {
        state.me = null;
        state.cache = null;
      }
    }),
  ];

  function startSession(token, user) {
    net.disconnect();
    session.save(token, user);
    emitter.emit('auth', { user });
    net.connect();
    return user;
  }

  const auth = {
    /** @returns {Promise<{id: number, name: string, appearance: object}>} бросает ApiError */
    async register(name, password) {
      const { token, user } = await http.register(name, password);
      return startSession(token, user);
    },
    async login(name, password) {
      const { token, user } = await http.login(name, password);
      return startSession(token, user);
    },
    logout() {
      net.disconnect();
      session.clear();
      emitter.emit('auth', null);
    },
    /** Текущая сессия окна или null. */
    session() {
      const user = session.user();
      return user && session.token() ? { user } : null;
    },
  };

  const api = {
    net: {
      send: (msg) => net.send(msg),
      on: (type, handler) => emitter.on(type, handler),
      off: (type, handler) => emitter.off(type, handler),
      connect: () => net.connect(),
      disconnect: () => net.disconnect(),
      get status() {
        return net.status;
      },
    },
    on: (type, handler) => emitter.on(type, handler),
    off: (type, handler) => emitter.off(type, handler),
    auth,
    state: {
      get me() {
        return state.me;
      },
      get cache() {
        return state.cache;
      },
      get npc() {
        return state.npc;
      },
      get ping() {
        return state.ping;
      },
    },
    ui: {
      lockPointer: () => runtime?.input.lockPointer(),
      unlockPointer: () => runtime?.input.unlockPointer(),
    },
  };

  /** Возвращает сессию из sessionStorage: проверяет токен и подключается. */
  async function restoreSession() {
    const token = session.token();
    if (!token) {
      emitter.emit('auth', null);
      return;
    }
    try {
      const { user } = await http.me(token);
      if (stopped) return;
      session.save(token, user);
      emitter.emit('auth', { user });
      net.connect();
    } catch (err) {
      if (stopped) return;
      if (err.status === 401) {
        session.clear();
        emitter.emit('auth', null);
      } else {
        // Сервер временно недоступен: транспорт сам будет пробовать подключиться.
        emitter.emit('auth', { user: session.user() });
        net.connect();
      }
    }
  }

  function start() {
    if (runtime || stopped) return;
    if (networkOnly) {
      runtime = { dispose() {} };
      void restoreSession();
      return;
    }
    const win = window;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (err) {
      container.textContent = 'WebGL недоступен в этом браузере';
      throw err;
    }
    renderer.setPixelRatio(Math.min(win.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    const labels = new CSS2DRenderer();
    Object.assign(labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    container.appendChild(labels.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xa9c4e0);
    scene.fog = new THREE.Fog(0xa9c4e0, 90, 260);
    scene.add(new THREE.HemisphereLight(0xdfeaff, 0x556644, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(60, 100, 30);
    scene.add(sun);

    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 400);
    camera.rotation.order = 'YXZ';

    const pool = createPool();
    const world = createChunkManager({ scene, pool });
    const remote = createRemotePlayers({ scene, pool, createLabel: makeLabel });
    const hud = createHud(container);
    const player = createPlayer();
    const input = createInput({
      target: renderer.domElement,
      document,
      window: win,
      onInteract: () => emitter.emit('interact', state.npc),
      onChat: () => emitter.emit('chat_key', null),
    });

    runtime = { input };
    hud.setStatus(net.status);
    hud.setCache(state.cache);

    let ready = false; // получен welcome на текущем соединении
    let seq = 0;
    let sinceSend = 0;
    let lastSent = null;
    let npcId = null;
    let npcClock = 0;

    function setNpc(npc) {
      const id = npc?.id ?? null;
      if (id === npcId) return;
      npcId = id;
      state.npc = npc ? { agentId: npc.agentId, name: npc.name } : null;
      emitter.emit('npc_near', state.npc);
    }

    function resetWorld() {
      ready = false;
      world.clear();
      remote.clear();
      setNpc(null);
    }

    const offs = [
      emitter.on('welcome', (msg) => {
        resetWorld(); // сервер начинает зеркало кеша и список игроков заново
        const s = msg.state;
        setPlayerPosition(player, s.x, s.y, s.z);
        player.yaw = s.ry ?? 0;
        player.pitch = 0;
        lastSent = null;
        sinceSend = 0;
        ready = true;
      }),
      emitter.on('chunk_unload', ({ cx, cz }) => world.unload(cx, cz)),
      emitter.on('chunk_load', ({ cx, cz, data }) => {
        try {
          world.load(cx, cz, data);
        } catch (err) {
          console.error(`не удалось построить чанк ${cx},${cz}:`, err);
        }
      }),
      emitter.on('cache_stats', () => hud.setCache(state.cache)),
      emitter.on('player_join', (msg) => remote.join(msg.id, msg.name, msg.appearance)),
      emitter.on('player_leave', (msg) => remote.leave(msg.id)),
      emitter.on('players', (msg) => remote.snapshot(msg.list, performance.now())),
      emitter.on('correct', (msg) => {
        setPlayerPosition(player, msg.x, msg.y, msg.z);
        lastSent = null;
      }),
      emitter.on('auth', (info) => {
        if (!info) resetWorld();
      }),
      emitter.on('status', ({ status }) => {
        hud.setStatus(status);
        if (status !== 'open') ready = false; // не шлём позиции в закрытый сокет
        if (status === 'open') measurePing();
      }),
    ];

    function measurePing() {
      if (net.status !== 'open') return;
      http.ping().then(
        (ms) => {
          state.ping = ms;
          hud.setPing(ms);
        },
        () => {
          state.ping = null;
          hud.setPing(null);
        },
      );
    }
    const pingTimer = win.setInterval(measurePing, PING_INTERVAL_MS);

    function resize() {
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      renderer.setSize(w, h);
      labels.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();
    win.addEventListener('resize', resize);

    let raf = 0;
    let last = performance.now();
    let frames = 0;
    let fpsSince = last;

    function frame(now) {
      raf = win.requestAnimationFrame(frame);
      const delta = now - last;
      if (delta < MIN_FRAME_MS) return;
      last = now;
      const dt = delta / 1000;

      const look = input.consumeLook();
      player.yaw -= look.dx * MOUSE_SENSITIVITY;
      player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - look.dy * MOUSE_SENSITIVITY));

      if (ready) {
        stepPlayer(player, input.keys(), dt, world);

        sinceSend += dt;
        if (sinceSend >= POS_INTERVAL_S) {
          const anim = player.moving ? (player.running ? 2 : 1) : 0;
          const changed =
            !lastSent ||
            lastSent.x !== player.x ||
            lastSent.y !== player.y ||
            lastSent.z !== player.z ||
            lastSent.ry !== player.yaw ||
            lastSent.anim !== anim;
          if (changed || sinceSend >= POS_HEARTBEAT_S) {
            seq += 1;
            net.send({ t: 'pos', x: player.x, y: player.y, z: player.z, ry: player.yaw, anim, seq });
            lastSent = { x: player.x, y: player.y, z: player.z, ry: player.yaw, anim };
            sinceSend = 0;
          }
        }

        npcClock += delta;
        if (npcClock >= NPC_CHECK_MS) {
          npcClock = 0;
          setNpc(world.nearestNpc(player.x, player.y, player.z, TALK_DISTANCE));
        }
      }

      remote.update(now);
      camera.position.set(player.x, player.y + PLAYER.eyeHeight, player.z);
      camera.rotation.set(player.pitch, player.yaw, 0);
      renderer.render(scene, camera);
      labels.render(scene, camera);

      frames += 1;
      if (now - fpsSince >= 500) {
        hud.setFps((frames * 1000) / (now - fpsSince));
        frames = 0;
        fpsSince = now;
      }
    }
    raf = win.requestAnimationFrame(frame);

    runtime.dispose = () => {
      win.cancelAnimationFrame(raf);
      win.clearInterval(pingTimer);
      win.removeEventListener('resize', resize);
      for (const off of offs) off();
      input.dispose();
      remote.dispose();
      world.dispose();
      pool.disposeAll();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      labels.domElement.remove();
      hud.dispose();
    };

    void restoreSession();
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    runtime?.dispose();
    runtime = null;
    net.disconnect();
    for (const off of stateOffs) off();
    emitter.clear();
  }

  return { api, start, stop };
}

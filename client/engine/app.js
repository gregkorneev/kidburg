// Сборка клиента: сеть и состояние создаются сразу (api доступен до start()),
// сцена, ввод и HUD — в start(). Всё, что создано, освобождается в stop().
// Описание api для интерфейса: client/engine/API.md.

import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { TALK_DISTANCE } from '../../shared/constants.js';
import { createHud } from '../hud/index.js';
import { CITY_CHARACTER_SCALE, animateCharacter, createCharacter, disposeCharacter } from './art/character.js';
import { applyStylizedLook } from './art/lighting.js';
import { readQuality } from './art/quality.js';
import { createChunkManager, makeLabel } from './chunks.js';
import { createDynamicObjects } from './dynamic-objects.js';
import { cityGateColliders, pickCityInteraction } from './city-interactions.js';
import { createMechanismSync } from './mechanism-sync.js';
import {
  FIRE_STATION_ENTRANCE,
  FLORIST_ENTRANCE,
} from './city-entrance.js';
import { createEmitter } from './emitter.js';
import { createHttp } from './http.js';
import { createInput } from './input.js';
import { createNet } from './net.js';
import { createPlayer, setPlayerPosition, stepPlayer } from './player.js';
import { createPool } from './pool.js';
import { createRemotePlayers } from './remote.js';
import { createSession } from './session.js';
import { startTelemetry } from './telemetry.js';
import { createPlayerAppearance } from './player-appearance.js';
import { createCitySkyline } from './skyline.js';
import { MIN_VISIBLE_ARM, createCameraArm, orbitCameraGoal } from './third-person-camera.js';

const POS_INTERVAL_S = 1 / 15;
const POS_HEARTBEAT_S = 1;
const MIN_FRAME_MS = 1000 / 60 - 1; // потолок 60 FPS на экранах 120/144 Гц
const NPC_CHECK_MS = 100;
const PING_INTERVAL_MS = 2000;
const MOUSE_SENSITIVITY = 0.0025;
const MAX_PIXEL_RATIO = 1.5;
// Вид от третьего лица: камера на орбите вокруг плеч персонажа; pitch — наклон взгляда (вниз < 0).
const CAMERA_DISTANCE = 4.6;
const CAMERA_FOCUS_HEIGHT = 1.45;
const CAMERA_PITCH_MIN = -0.95;
const CAMERA_PITCH_MAX = 0.3;
const CAMERA_PITCH_DEFAULT = -0.2;

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
    /** Вход по имени и коду комнаты. @returns {Promise<{id: number, name: string, appearance: object}>} бросает ApiError */
    async join(name, room) {
      const { token, user } = await http.join(name, room);
      return startSession(token, user);
    },
    /**
     * Код комнаты, если страница открыта на компьютере сервера; иначе null. Нигде не сохраняется.
     * @returns {Promise<string|null>}
     */
    async localRoom() {
      try {
        const { room } = await http.localRoom();
        return typeof room === 'string' && /^[A-Za-z]{4}$/.test(room) ? room.toUpperCase() : null;
      } catch {
        return null;
      }
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
      lockPointer: () => runtime?.input?.lockPointer(),
      unlockPointer: () => runtime?.input?.unlockPointer(),
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
    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 400);
    // Свет, небо и туман общие с пожарной частью (art/lighting.js).
    // Тени: карта следует за игроком (±30 м), на «Низкой» графике выключена (art/quality.js). Измерения — docs/graphics-overhaul.
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const stylized = applyStylizedLook({ renderer, scene, camera, fog: [90, 260], shadowExtent: 30, exposure: 1.0 });
    const quality = readQuality(win.location.search, win.localStorage);
    stylized.setQuality(quality);
    const skyline = createCitySkyline();
    scene.add(skyline.group);

    const pool = createPool();
    const world = createChunkManager({ scene, pool, quality });
    // Объекты, добавленные в Control Center: живут в тех же чанках, что и статика, но приходят отдельными сообщениями.
    const dynamic = createDynamicObjects({ scene, pool, createLabel: makeLabel, heightAt: (x, z) => world.heightAt(x, z) });
    // Игрок и камера видят статику и динамические объекты как один набор препятствий.
    const worldView = {
      collidersNear: (x, z) => {
        const extra = dynamic.collidersNear(x, z);
        const gates = cityGateColliders(world.mechanisms());
        return [...world.collidersNear(x, z), ...gates, ...extra];
      },
      heightAt: (x, z) => world.heightAt(x, z),
    };
    const remote = createRemotePlayers({ scene, pool, createLabel: makeLabel, quality });
    const hud = createHud(container);
    const player = createPlayer();
    player.pitch = CAMERA_PITCH_DEFAULT;
    const cameraArm = createCameraArm({ distance: CAMERA_DISTANCE });
    const cameraFocus = { x: 0, y: 0, z: 0 };
    const cameraGoal = { x: 0, y: 0, z: 0 };
    /** Модель локального игрока: тот же персонаж, что видят другие (по id и цвету из сессии). */
    let avatar = null;
    let interaction = null; // ближайшая цель клавиши E: вход в здание или ворота (city-interactions.js)
    const mechSync = createMechanismSync({ api: { on: emitter.on, net } });
    const input = createInput({
      target: renderer.domElement,
      document,
      window: win,
      onInteract: () => {
        if (interaction?.href) {
          win.location.assign(interaction.href);
          return;
        }
        if (interaction?.mechanism) {
          const { id, object } = interaction.mechanism;
          mechSync.request(id, !object.wantsOpen, (open) => (open ? object.open() : object.close()));
          return;
        }
        emitter.emit('interact', state.npc);
      },
      onChat: () => emitter.emit('chat_key', null),
    });

    runtime = { input };
    // Отладочный доступ для проверки графики: только при ?debug=1.
    if (new URLSearchParams(win.location.search).has('debug')) win.__cityDebug = { scene, camera, renderer, world, dynamic, remote, player, stylized, cameraArm, get avatar() { return avatar; }, setQuality: (level) => { stylized.setQuality(level); world.setQuality(level); } };
    hud.setStatus(net.status);
    hud.setCache(state.cache);

    let ready = false; // получен welcome на текущем соединении
    let seq = 0;
    let sinceSend = 0;
    let lastSent = null;
    let npcId = null;
    let npcClock = 0;
    let lastPrompt = '';

    function setNpc(npc) {
      const id = npc?.id ?? null;
      if (id === npcId) return;
      npcId = id;
      state.npc = npc ? { agentId: npc.agentId, name: npc.name } : null;
      emitter.emit('npc_near', state.npc);
    }

    function setAvatar(id) {
      clearAvatar();
      avatar = createCharacter({ appearance: createPlayerAppearance(session.user(), id), quality });
      avatar.scale.setScalar(CITY_CHARACTER_SCALE);
      scene.add(avatar);
    }

    function clearAvatar() {
      if (!avatar) return;
      scene.remove(avatar);
      disposeCharacter(avatar);
      avatar = null;
    }

    function resetWorld() {
      ready = false;
      clearAvatar();
      world.clear();
      dynamic.clear();
      remote.clear();
      setNpc(null);
    }

    const offs = [
      emitter.on('welcome', (msg) => {
        resetWorld(); // сервер начинает зеркало кеша и список игроков заново
        const s = msg.state;
        setPlayerPosition(player, s.x, s.y, s.z);
        hud.setPlayerPosition(player.x, player.z);
        player.yaw = s.ry ?? 0;
        player.pitch = CAMERA_PITCH_DEFAULT;
        cameraArm.reset();
        setAvatar(msg.playerId);
        lastSent = null;
        sinceSend = 0;
        ready = true;
      }),
      emitter.on('chunk_unload', ({ cx, cz }) => {
        dynamic.unloadChunk(cx, cz);
        world.unload(cx, cz);
      }),
      emitter.on('dyn_snapshot', ({ cx, cz, objects }) => dynamic.snapshot(cx, cz, objects)),
      emitter.on('dyn_upsert', ({ object }) => dynamic.upsert(object)),
      emitter.on('dyn_remove', ({ id, rev }) => dynamic.remove(id, rev)),
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
        hud.setPlayerPosition(player.x, player.z);
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

    /** Персонаж стоит на позиции игрока и смотрит по его yaw; камера сзади и выше, у стен и земли плечо короче. */
    function updateAvatarAndCamera(t, dt) {
      if (avatar) {
        avatar.position.set(player.x, player.y, player.z);
        avatar.rotation.y = player.yaw + Math.PI; // модель смотрит в +Z, а игрок при yaw = 0 — в −Z
        animateCharacter(avatar, dt, t, { speed: ready && player.moving ? (player.running ? 2 : 1) : 0 });
      }
      cameraFocus.x = player.x;
      cameraFocus.y = player.y + CAMERA_FOCUS_HEIGHT;
      cameraFocus.z = player.z;
      orbitCameraGoal(cameraFocus, player.yaw, player.pitch, CAMERA_DISTANCE, cameraGoal);
      const position = cameraArm.resolve(cameraFocus, cameraGoal, worldView.collidersNear(player.x, player.z), dt, worldView.heightAt);
      camera.position.set(position.x, position.y, position.z);
      camera.lookAt(cameraFocus.x, cameraFocus.y, cameraFocus.z);
      if (avatar) avatar.visible = cameraArm.length >= MIN_VISIBLE_ARM; // камера вплотную: не показываем изнанку модели
    }

    // Центральный мониторинг (Control Center): усреднённые FPS и ping раз в несколько секунд.
    const telemetry = startTelemetry({
      loc: 'city',
      externalFrames: true,
      getQuality: () => quality,
      getRenderInfo: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }),
      getChunks: () => (state.cache ? { loaded: state.cache.loaded, max: state.cache.max } : null),
      win,
      doc: document,
      session,
    });

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
      player.pitch = Math.max(CAMERA_PITCH_MIN, Math.min(CAMERA_PITCH_MAX, player.pitch - look.dy * MOUSE_SENSITIVITY));

      if (ready) {
        stepPlayer(player, input.keys(), dt, worldView);
        hud.setPlayerPosition(player.x, player.z);

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
          const nearbyNpc = world.nearestNpc(player.x, player.y, player.z, TALK_DISTANCE);
          const mechanisms = world.mechanisms();
          mechSync.reconcile(mechanisms);
          interaction = pickCityInteraction(player, { florist: FLORIST_ENTRANCE, fire: FIRE_STATION_ENTRANCE }, mechanisms, nearbyNpc ? { ...nearbyNpc, radius: TALK_DISTANCE } : null);
          setNpc(interaction?.npc ?? null);
        }
        // Подсказка обновляется на каждый кадр: подпись ворот меняется, пока они едут.
        if (ready) {
          const label = interaction ? (interaction.mechanism ? interaction.mechanism.object.label : interaction.label) : '';
          if (label !== lastPrompt) {
            lastPrompt = label;
            hud.setEntrancePrompt(label);
          }
        }
      }

      remote.update(now);
      world.update(dt, now / 1000, player);
      updateAvatarAndCamera(now / 1000, dt);
      stylized.update(player, now / 1000);
      renderer.render(scene, camera);
      labels.render(scene, camera);
      telemetry.markFrame();

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
      telemetry.stop();
      input.dispose();
      clearAvatar();
      remote.dispose();
      mechSync.dispose();
      dynamic.dispose();
      world.dispose();
      scene.remove(skyline.group);
      skyline.dispose();
      stylized.dispose();
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

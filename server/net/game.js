// Игровой WebSocket: проверка тикета до upgrade, hello, позиции, рассылка соседям.
// Обрабатываются hello, pos, task_answer и npc_talk (мост к агентам); chat приходит в S3.

import { WebSocketServer, WebSocket } from 'ws';
import {
  CHUNK_SIZE,
  CLIENT_CONSTS,
  MAX_SPEED,
  PROTO_VERSION,
  SPAWN,
  SPEED_TOLERANCE,
  TALK_DISTANCE,
  TICK_HZ,
  VIEW_RADIUS,
  WORLD_CHUNKS_X,
  WORLD_CHUNKS_Z,
  WORLD_SIZE_X,
  WORLD_SIZE_Z,
} from '../../shared/constants.js';
import { C2S, ERROR_CODES, LIMITS, S2C, decode, encode, validate } from '../../shared/protocol.js';
import { BALL, FIELD, INTERACT_CODES, INTERACT_LIMITS } from '../../shared/interaction-contracts.js';
import { reply as defaultReply } from '../agents/index.js';
import { createChunkMirror } from './chunks.js';
import { chooseSpawn } from './spawn.js';
import { FIREFIGHTER_TASK_ID } from '../tasks/index.js';

// Коды закрытия WebSocket (диапазон 4000–4999 отдан приложению).
export const CLOSE = Object.freeze({ REPLACED: 4000, UNAUTH: 4001, BAD_PROTO: 4002 });

const MAX_PAYLOAD = 64 * 1024;
const MAX_BUFFERED = 512 * 1024;
// task_answer: серия попаданий по окнам идёт примерно 8 раз в секунду.
const TASK_PER_SEC = 20;
const MECH_PER_SEC = 4;
// Мячи и предметы рассылаются игрокам не дальше этого расстояния от поля (мяч не уходит от поля дальше hardMargin).
const BALL_VIEW_M = FIELD.hardMargin + FIELD.halfW + 70;
const PHYSICS_DT = 1 / BALL.stepHz;
const SNAPSHOT_EVERY = Math.max(1, Math.round(BALL.stepHz / BALL.snapshotHz));
/** Ответ обработчика {state, done, feedback, changed, error?} -> плоское поле `state` сообщения task_state. */
const taskWire = (r) => ({ ...r.state, done: r.done, feedback: r.feedback, changed: r.changed, ...(r.error ? { error: r.error } : {}) });
const TASK_UNAVAILABLE = 'Сервер сейчас не может прочитать прогресс. Попробуйте позже.';
// Границы мира чуть внутри, чтобы чанк всегда лежал в 0..11.
const EDGE = 0.001;
// Расстояние проверяется за время между двумя pos: не меньше одного кадра лимита
// (иначе пачка пакетов давала бы ложные коррекции) и не больше MAX_DT_S
// (иначе можно «накопить» бесконечный запас скорости, простояв на месте).
const MIN_DT_S = 1 / LIMITS.POS_PER_SEC;
const MAX_DT_S = 2;
// agentId и reqId возвращаются клиенту в каждом сообщении потока, поэтому их длина ограничена.
const MAX_ID_CHARS = 64;
const GENERIC_AGENT_ERROR = 'Не удалось получить ответ. Попробуйте позже';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clampX = (x) => clamp(x, 0, WORLD_SIZE_X - EDGE);
const clampZ = (z) => clamp(z, 0, WORLD_SIZE_Z - EDGE);
const chunkIndex = (v, count) => clamp(Math.floor(v / CHUNK_SIZE), 0, count - 1);

/** Не более `max` событий за окно в одну секунду. */
function createLimiter(max) {
  let windowStart = -Infinity;
  let count = 0;
  let notifiedAt = -Infinity;
  return {
    hit(t) {
      if (t - windowStart >= 1000) {
        windowStart = t;
        count = 0;
      }
      return ++count <= max;
    },
    /** Предупреждать клиента не чаще раза в секунду. */
    shouldNotify(t) {
      if (t - notifiedAt < 1000) return false;
      notifiedAt = t;
      return true;
    },
  };
}

function reject(socket, status, text) {
  socket.on('error', () => {});
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/**
 * @param {object} deps
 * @param {import('fastify').FastifyInstance} deps.app
 * @param {ReturnType<import('../db/index.js').openDb>} deps.db
 * @param {ReturnType<import('./tickets.js').createTicketStore>} deps.tickets
 * @param {ReturnType<import('./world.js').loadWorld>} [deps.world] без мира чанки не передаются
 * @param {{taskIds: readonly string[], has(id: string): boolean, getState(userId: number, id: string): object,
 *   handle(userId: number, id: string, payload: unknown, context: object): object|Promise<object>, forget?(userId: number): void}} [deps.tasks]
 *   задания; прогресс принадлежит userId соединения, позиция берётся у сервера
 * @param {ReturnType<import('../world/dynamic-objects.js').createDynamicWorld>} [deps.dynamic] динамические объекты мира
 * @param {ReturnType<import('../mechanisms/index.js').createMechanisms>} [deps.mechanisms] механизмы города
 * @param {ReturnType<import('../world/interactive-state.js').createInteractive>} [deps.interactive] предметы и мячи
 * @param {typeof defaultReply} [deps.reply] мозг агента (shared/agent-api.md); подменяется в тестах
 * @param {number} [deps.npcTalkMaxChars] предел длины реплики игрока NPC
 * @param {number} [deps.npcTalkPerSec] предел npc_talk в секунду на игрока
 */
export function createGame({
  app,
  db,
  tickets,
  now = Date.now,
  world = null,
  dynamic = null,
  mechanisms = null,
  interactive = null,
  tasks = null,
  tickHz = TICK_HZ,
  pingMs = 10_000,
  helloTimeoutMs = 5_000,
  flushMs = 5_000,
  reply = defaultReply,
  npcTalkMaxChars = 300,
  npcTalkPerSec = LIMITS.NPC_TALK_PER_SEC,
}) {
  const log = app.log;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  /** Все открытые сокеты, в том числе ещё не сказавшие hello. */
  const conns = new Set();
  const connByUser = new Map();
  /** Игроки, прошедшие hello. */
  const players = new Map();
  let tickNo = 0;
  let physicsNo = 0; // счётчик шагов физики мячей: клиент отбрасывает снимки старше уже применённых

  const send = (conn, msg) => {
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(encode(msg));
  };
  const sendError = (conn, code, message) => send(conn, { t: S2C.ERROR, code, message });

  function savePlayers(list) {
    const rows = list.map((p) => ({ userId: p.id, x: p.x, y: p.y, z: p.z, ry: p.ry, updatedAt: now() }));
    if (rows.length === 0) return;
    try {
      db.savePlayerStates(rows);
      for (const p of list) p.dirty = false;
    } catch (err) {
      log.error({ err }, 'не удалось сохранить позиции игроков');
    }
  }

  const flushAll = () => savePlayers([...players.values()].filter((p) => p.dirty));

  function removePlayer(p) {
    if (p.dirty) savePlayers([p]);
    tasks?.forget?.(p.id);
    interactive?.release(p.id); // предмет из рук возвращается на безопасное место
    players.delete(p.id);
    for (const other of players.values()) {
      if (other.known.delete(p.id)) send(other.conn, { t: S2C.PLAYER_LEAVE, id: p.id });
    }
  }

  /** Идемпотентно закрывает соединение и убирает игрока из мира. */
  function dropConn(conn, code, reason) {
    if (conn.closed) return;
    conn.closed = true;
    clearTimeout(conn.helloTimer);
    conn.talk?.controller.abort(); // клиент ушёл: генерация NPC больше не нужна
    for (const controller of conn.taskControllers) controller.abort();
    conn.taskControllers.clear();
    conns.delete(conn);
    if (connByUser.get(conn.user.id) === conn) connByUser.delete(conn.user.id);
    if (conn.player) removePlayer(conn.player);
    if (code !== undefined && conn.ws.readyState <= WebSocket.OPEN) conn.ws.close(code, reason);
  }

  /**
   * Отправляет разницу зеркала: сначала chunk_unload, потом chunk_load (и dyn_snapshot с динамическими объектами
   * чанка, если они есть), затем cache_stats. `refresh` пересчитывает размеры после правки динамического слоя.
   */
  function streamChunks(p, { refresh = false } = {}) {
    if (!world) return;
    const diff = refresh ? p.mirror.refresh(p.x, p.z) : p.mirror.update(p.x, p.z);
    if (!diff) return;
    if (refresh && diff.unload.length === 0 && diff.load.length === 0 && diff.stats.bytes === p.statsBytes) return;
    for (const { cx, cz } of diff.unload) send(p.conn, { t: S2C.CHUNK_UNLOAD, cx, cz });
    for (const { cx, cz } of diff.load) {
      try {
        send(p.conn, { t: S2C.CHUNK_LOAD, cx, cz, data: world.readChunk(cx, cz) });
      } catch (err) {
        log.error({ err, cx, cz }, 'не удалось прочитать чанк');
        continue;
      }
      const objects = dynamic?.forChunk(cx, cz) ?? [];
      if (objects.length > 0) send(p.conn, { t: S2C.DYN_SNAPSHOT, cx, cz, objects });
    }
    p.statsBytes = diff.stats.bytes;
    send(p.conn, { t: S2C.CACHE_STATS, ...diff.stats });
    if (diff.stats.loaded > diff.stats.max) log.error(diff.stats, 'нарушен лимит кеша клиента');
  }

  /** Правка динамического слоя: доставляем только тем, у кого соответствующий чанк в кеше. */
  function onDynamicChange({ ops }) {
    for (const p of players.values()) {
      if (!p.mirror) continue;
      for (const op of ops) {
        if (op.op === 'upsert') {
          const { x, z } = op.object;
          const cx = chunkIndex(x, WORLD_CHUNKS_X);
          const cz = chunkIndex(z, WORLD_CHUNKS_Z);
          if (p.mirror.has(cx, cz)) send(p.conn, { t: S2C.DYN_UPSERT, object: op.object });
          else if (op.prev && p.mirror.has(op.prev.cx, op.prev.cz)) send(p.conn, { t: S2C.DYN_REMOVE, id: op.object.id, rev: op.object.rev });
        } else if (p.mirror.has(op.cx, op.cz)) {
          send(p.conn, { t: S2C.DYN_REMOVE, id: op.id, rev: op.rev });
        }
      }
      streamChunks(p, { refresh: true });
    }
  }

  function handleHello(conn, msg) {
    if (msg.proto !== PROTO_VERSION) {
      sendError(conn, ERROR_CODES.BAD_MSG, `Поддерживается протокол ${PROTO_VERSION}`);
      return dropConn(conn, CLOSE.BAD_PROTO, 'proto');
    }
    clearTimeout(conn.helloTimer);
    const { user } = conn;
    const saved = db.getPlayerState(user.id) ?? chooseSpawn([...players.values()]);
    const x = clampX(saved.x);
    const z = clampZ(saved.z);
    const player = {
      id: user.id,
      name: user.name,
      appearance: user.appearance,
      conn,
      x,
      y: saved.y,
      z,
      ry: saved.ry,
      anim: 0,
      seq: 0,
      cx: chunkIndex(x, WORLD_CHUNKS_X),
      cz: chunkIndex(z, WORLD_CHUNKS_Z),
      lastAt: now(),
      dirty: false,
      statsBytes: -1,
      known: new Set(),
      posLimit: createLimiter(LIMITS.POS_PER_SEC),
      taskLimit: createLimiter(TASK_PER_SEC),
      mechLimit: createLimiter(MECH_PER_SEC),
      interactLimit: createLimiter(INTERACT_LIMITS.PER_SEC),
      ballVer: new Map(),
      talkLimit: createLimiter(npcTalkPerSec),
      mirror: world && createChunkMirror(world, log),
    };
    conn.player = player;
    players.set(player.id, player);

    const progress = Object.fromEntries(db.listTaskProgress(user.id).map((r) => [r.taskId, r.done]));
    send(conn, {
      t: S2C.WELCOME,
      proto: PROTO_VERSION,
      playerId: player.id,
      name: player.name,
      state: { x, y: player.y, z, ry: player.ry, progress },
      consts: CLIENT_CONSTS,
    });
    streamChunks(player);
    sendTaskStates(player);
    if (mechanisms) send(player.conn, { t: S2C.MECH_SNAPSHOT, list: mechanisms.snapshot() });
    if (interactive) {
      send(player.conn, { t: S2C.PROP_SNAPSHOT, list: interactive.propRows() });
      sendBalls(player);
    }
  }

  const nearField = (p) => Math.hypot(p.x - FIELD.x, p.z - FIELD.z) <= BALL_VIEW_M;

  /** Мячи, о которых игрок ещё не знает или которые движутся; полный набор при подключении. */
  function sendBalls(p, tick = physicsNo) {
    if (!interactive || !nearField(p)) return;
    const rows = [];
    for (const ball of interactive.balls.list()) {
      if (ball.resting && p.ballVer.get(ball.id) === ball.version) continue;
      p.ballVer.set(ball.id, ball.version);
      rows.push(interactive.balls.wire(ball));
    }
    if (rows.length) send(p.conn, { t: S2C.BALL_SNAPSHOT, tick, ts: now(), list: rows });
  }

  /** Игровое действие над предметом или мячом. Дальность, владение и направление берутся из состояния сервера. */
  function handleInteract(player, msg) {
    const t = now();
    const reply = (r) =>
      send(player.conn, { t: S2C.INTERACT_RESULT, seq: msg.seq, id: msg.id, action: msg.action, ok: r.ok, code: r.code ?? INTERACT_CODES.OK, message: r.message ?? '' });
    if (!interactive) return reply({ ok: false, code: INTERACT_CODES.UNKNOWN, message: 'Взаимодействия отключены' });
    if (!player.interactLimit.hit(t)) {
      if (player.interactLimit.shouldNotify(t)) sendError(player.conn, ERROR_CODES.RATE_LIMIT, 'Слишком много interact');
      return reply({ ok: false, code: INTERACT_CODES.RATE_LIMIT, message: 'Слишком часто' });
    }
    const actor = { id: player.id, x: player.x, z: player.z, ry: player.ry };
    if (msg.action === 'take') return reply(interactive.take(actor, msg.id));
    if (msg.action === 'place' || msg.action === 'drop') return reply(interactive.place(actor, msg.id, msg.action));
    if (msg.action === 'kick') return reply(interactive.kick(actor, msg.id));
    return reply({ ok: false, code: INTERACT_CODES.UNKNOWN, message: 'Неизвестное действие' });
  }

  function handleMechanism(player, msg) {
    const t = now();
    if (!player.mechLimit.hit(t)) {
      if (player.mechLimit.shouldNotify(t)) sendError(player.conn, ERROR_CODES.RATE_LIMIT, 'Слишком много mech_set');
      return;
    }
    if (!mechanisms) return;
    const result = mechanisms.set(msg.id, msg.active, { x: player.x, z: player.z });
    if (!result.ok) {
      if (result.reason === 'too_far') sendError(player.conn, ERROR_CODES.TOO_FAR, 'Слишком далеко от механизма');
      else sendError(player.conn, ERROR_CODES.BAD_MSG, 'Неизвестный механизм');
    }
  }

  /** Фиксированный физический шаг мячей и рассылка снимков (реже, чем шаги). */
  function physicsTick() {
    if (!interactive) return;
    physicsNo += 1;
    const actors = [];
    for (const p of players.values()) {
      if (Math.hypot(p.x - FIELD.x, p.z - FIELD.z) < FIELD.halfW + 40) actors.push({ id: p.id, x: p.x, y: p.y, z: p.z });
    }
    const events = interactive.step(PHYSICS_DT, actors);
    for (const event of events) {
      for (const p of players.values()) if (nearField(p)) send(p.conn, { t: S2C.BALL_EVENT, ...event });
    }
    if (physicsNo % SNAPSHOT_EVERY === 0 || events.length > 0) {
      for (const p of players.values()) if (p.conn.ws.bufferedAmount < MAX_BUFFERED) sendBalls(p, physicsNo);
    }
  }

  /** Сохранённое состояние заданий: игрок видит прогресс после входа, перезагрузки и переподключения. */
  function sendTaskStates(player) {
    for (const taskId of tasks?.taskIds ?? []) {
      try {
        send(player.conn, { t: S2C.TASK_STATE, taskId, state: taskWire(tasks.getState(player.id, taskId)) });
      } catch (err) {
        log.error({ err, userId: player.id, taskId }, 'не удалось прочитать прогресс задания');
        send(player.conn, { t: S2C.TASK_STATE, taskId, state: { error: 'storage', feedback: TASK_UNAVAILABLE } });
      }
    }
  }

  async function handleTask(player, msg) {
    const t = now();
    if (!player.taskLimit.hit(t)) {
      if (player.taskLimit.shouldNotify(t)) sendError(player.conn, ERROR_CODES.RATE_LIMIT, 'Слишком много task_answer');
      return;
    }
    if (!tasks?.has(msg.taskId)) return sendError(player.conn, ERROR_CODES.BAD_MSG, 'Неизвестное задание');
    // Владелец — игрок соединения, позиция и взгляд — последние принятые сервером. Из payload берёт только action.
    const conn = player.conn;
    const controller = new AbortController();
    conn.taskControllers.add(controller);
    const context = { position: { x: player.x, y: player.y, z: player.z }, yaw: player.ry, signal: controller.signal };
    let state;
    try {
      state = taskWire(await tasks.handle(player.id, msg.taskId, msg.payload, context));
    } catch (err) {
      if (controller.signal.aborted || conn.closed) return;
      log.error({ err, userId: player.id, taskId: msg.taskId }, 'ошибка обработчика задания');
      state = { error: 'storage', feedback: TASK_UNAVAILABLE };
    } finally {
      conn.taskControllers.delete(controller);
    }
    if (controller.signal.aborted || conn.closed || conn.player !== player || conn.ws.readyState !== WebSocket.OPEN) return;
    send(conn, { t: S2C.TASK_STATE, taskId: msg.taskId, state });
    if (msg.taskId === FIREFIGHTER_TASK_ID && msg.payload?.action === 'equip' && state.changed && state.equipped) {
      const appearance = { ...player.appearance, firefighterEquipped: true };
      player.appearance = appearance;
      for (const other of players.values()) {
        if (other !== player && other.known.has(player.id)) {
          send(other.conn, { t: S2C.PLAYER_APPEARANCE, id: player.id, appearance });
        }
      }
    }
  }

  function handlePos(player, msg) {
    const t = now();
    if (!player.posLimit.hit(t)) {
      if (player.posLimit.shouldNotify(t)) sendError(player.conn, ERROR_CODES.RATE_LIMIT, 'Слишком много pos');
      return;
    }
    const x = clampX(msg.x);
    const z = clampZ(msg.z);
    const dt = clamp((t - player.lastAt) / 1000, MIN_DT_S, MAX_DT_S);
    // Полное расстояние, включая Y (lead-spec, S1, шаг 9).
    if (Math.hypot(x - player.x, msg.y - player.y, z - player.z) > MAX_SPEED * SPEED_TOLERANCE * dt) {
      send(player.conn, { t: S2C.CORRECT, x: player.x, y: player.y, z: player.z });
      return;
    }
    Object.assign(player, { x, y: msg.y, z, ry: msg.ry, anim: msg.anim, seq: msg.seq, lastAt: t, dirty: true });
    player.cx = chunkIndex(x, WORLD_CHUNKS_X);
    player.cz = chunkIndex(z, WORLD_CHUNKS_Z);
    if (x !== msg.x || z !== msg.z) send(player.conn, { t: S2C.CORRECT, x, y: player.y, z });
    streamChunks(player);
  }

  const agentError = (conn, agentId, reqId, message) =>
    send(conn, { t: S2C.AGENT_ERROR, agentId, reqId, message });

  /**
   * npc_talk: проверки по данным сервера (личность и позиция из соединения), затем поток reply().
   * Токены уходят только этому соединению. Любой отказ или сбой заканчивается agent_error с тем же reqId.
   */
  async function handleNpcTalk(player, msg) {
    const { conn } = player;
    const { agentId, reqId } = msg;
    if (agentId.length > MAX_ID_CHARS || (typeof reqId === 'string' && reqId.length > MAX_ID_CHARS)) {
      return sendError(conn, ERROR_CODES.BAD_MSG, 'Слишком длинный agentId или reqId');
    }
    const t = now();
    if (!player.talkLimit.hit(t)) {
      if (player.talkLimit.shouldNotify(t)) sendError(conn, ERROR_CODES.RATE_LIMIT, 'Слишком часто говорите с NPC');
      return agentError(conn, agentId, reqId, 'Слишком часто, подождите секунду');
    }
    if (msg.text.length > npcTalkMaxChars) {
      return agentError(conn, agentId, reqId, `Слишком длинная реплика (не больше ${npcTalkMaxChars} символов)`);
    }
    const text = msg.text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return agentError(conn, agentId, reqId, 'Пустая реплика');

    const npcs = (world?.npcs ?? []).filter((n) => n.agentId === agentId);
    if (npcs.length === 0) return agentError(conn, agentId, reqId, 'Неизвестный собеседник');
    if (!npcs.some((n) => Math.hypot(n.x - player.x, n.z - player.z) <= TALK_DISTANCE)) {
      sendError(conn, ERROR_CODES.TOO_FAR, 'Слишком далеко от собеседника');
      return agentError(conn, agentId, reqId, 'Подойдите ближе к собеседнику');
    }
    if (conn.talk) return agentError(conn, agentId, reqId, 'Дождитесь ответа на предыдущую реплику');

    // Ход задания NPC берётся из сохранённого состояния игрока на сервере, не из сообщения клиента.
    let situation = null;
    try {
      situation = tasks?.describeForAgent?.(player.id, agentId) ?? null;
    } catch (err) {
      log.warn({ err, agentId, userId: player.id }, 'не удалось описать ход задания для NPC');
    }

    const controller = new AbortController();
    const { signal } = controller;
    conn.talk = { controller, agentId, reqId };
    const startedAt = now();
    let tokens = 0;
    let chars = 0;
    try {
      const stream = reply({
        userId: player.id,
        agentId,
        text,
        context: { playerName: player.name, nearbyPlayers: player.known.size, ...(situation ? { situation } : {}) },
        signal,
        onQueue: (position) => {
          if (!signal.aborted) send(conn, { t: S2C.AGENT_QUEUE, agentId, reqId, position });
        },
      });
      for await (const token of stream) {
        if (signal.aborted) break;
        if (typeof token !== 'string' || token === '') continue;
        send(conn, { t: S2C.AGENT_TOKEN, agentId, reqId, token });
        tokens += 1;
        chars += token.length;
      }
      if (signal.aborted) return;
      if (tokens === 0) {
        log.warn({ agentId, userId: player.id }, 'агент вернул пустой ответ');
        return agentError(conn, agentId, reqId, 'Собеседник промолчал. Попробуйте переформулировать');
      }
      send(conn, { t: S2C.AGENT_DONE, agentId, reqId });
      log.info({ agentId, userId: player.id, tokens, chars, ms: now() - startedAt }, 'ответ NPC отправлен');
    } catch (err) {
      if (signal.aborted) return;
      log.warn({ agentId, userId: player.id, code: err?.code, err: err?.message, detail: err?.detail }, 'сбой ответа NPC');
      agentError(conn, agentId, reqId, err?.expose === true ? err.message : GENERIC_AGENT_ERROR);
    } finally {
      if (conn.talk?.controller === controller) conn.talk = null;
    }
  }

  function onMessage(conn, data, isBinary) {
    if (!isBinary) return sendError(conn, ERROR_CODES.BAD_MSG, 'Нужен бинарный кадр');
    let msg;
    try {
      msg = decode(data);
    } catch {
      return sendError(conn, ERROR_CODES.BAD_MSG, 'Не удалось разобрать сообщение');
    }
    const check = validate(msg, 'c2s');
    if (!check.ok) return sendError(conn, ERROR_CODES.BAD_MSG, check.error);

    if (!conn.player) {
      if (msg.t === C2S.HELLO) return handleHello(conn, msg);
      sendError(conn, ERROR_CODES.UNAUTH, 'Сначала hello');
      return dropConn(conn, CLOSE.UNAUTH, 'hello');
    }
    if (msg.t === C2S.POS) return handlePos(conn.player, msg);
    if (msg.t === C2S.HELLO) return sendError(conn, ERROR_CODES.BAD_MSG, 'hello уже было');
    if (msg.t === C2S.TASK_ANSWER) {
      return void handleTask(conn.player, msg).catch((err) => log.error({ err }, 'сбой обработки task_answer'));
    }
    if (msg.t === C2S.NPC_TALK) {
      return void handleNpcTalk(conn.player, msg).catch((err) => log.error({ err }, 'сбой моста npc_talk'));
    }
    if (msg.t === C2S.MECH_SET) return handleMechanism(conn.player, msg);
    if (msg.t === C2S.INTERACT) return handleInteract(conn.player, msg);
    // chat: мост появится в S3.
  }

  function onConnection(ws, user) {
    const previous = connByUser.get(user.id);
    if (previous) dropConn(previous, CLOSE.REPLACED, 'replaced');

    const conn = { ws, user, player: null, alive: true, closed: false, helloTimer: null, talk: null, pingAt: 0, rttMs: null, taskControllers: new Set() };
    conns.add(conn);
    connByUser.set(user.id, conn);
    conn.helloTimer = setTimeout(() => {
      sendError(conn, ERROR_CODES.UNAUTH, 'hello не получен');
      dropConn(conn, CLOSE.UNAUTH, 'hello timeout');
    }, helloTimeoutMs);

    ws.on('message', (data, isBinary) => onMessage(conn, data, isBinary));
    ws.on('pong', () => {
      conn.alive = true;
      if (conn.pingAt) conn.rttMs = Math.round(now() - conn.pingAt);
    });
    ws.on('error', (err) => log.debug({ err }, 'ошибка сокета'));
    ws.on('close', () => dropConn(conn));
  }

  function onUpgrade(req, socket, head) {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return reject(socket, 400, 'Bad Request');
    }
    if (url.pathname !== '/ws') return reject(socket, 404, 'Not Found');
    const userId = tickets.consume(url.searchParams.get('ticket') ?? '');
    const user = userId === null ? null : db.getUser(userId);
    if (!user) return reject(socket, 401, 'Unauthorized');
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, user));
  }

  function tick() {
    tickNo += 1;
    if (tickNo % tickHz === 0) mechanisms?.sweep?.(); // двери, оставленные открытыми, закрываются сами
    const byChunk = new Map();
    for (const p of players.values()) {
      const key = p.cx + p.cz * WORLD_CHUNKS_X;
      const cell = byChunk.get(key);
      if (cell) cell.push(p);
      else byChunk.set(key, [p]);
    }
    for (const p of players.values()) {
      const near = [];
      for (let dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz++) {
        for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++) {
          const cx = p.cx + dx;
          const cz = p.cz + dz;
          if (cx < 0 || cz < 0 || cx >= WORLD_CHUNKS_X || cz >= WORLD_CHUNKS_Z) continue;
          for (const q of byChunk.get(cx + cz * WORLD_CHUNKS_X) ?? []) if (q !== p) near.push(q);
        }
      }
      const seen = new Set(near.map((q) => q.id));
      for (const q of near) {
        if (!p.known.has(q.id)) {
          let firefighterEquipped = false;
          try {
            firefighterEquipped = tasks?.getState(q.id, FIREFIGHTER_TASK_ID)?.state?.equipped === true;
          } catch (err) {
            log.error({ err, userId: q.id, taskId: FIREFIGHTER_TASK_ID }, 'не удалось прочитать экипировку игрока');
          }
          send(p.conn, {
            t: S2C.PLAYER_JOIN,
            id: q.id,
            name: q.name,
            appearance: { ...q.appearance, firefighterEquipped },
          });
        }
      }
      for (const id of p.known) if (!seen.has(id)) send(p.conn, { t: S2C.PLAYER_LEAVE, id });
      p.known = seen;
      if (near.length > 0 && p.conn.ws.bufferedAmount < MAX_BUFFERED) {
        send(p.conn, {
          t: S2C.PLAYERS,
          tick: tickNo,
          list: near.map((q) => [q.id, q.x, q.y, q.z, q.ry, q.anim]),
        });
      }
    }
  }

  function ping() {
    for (const conn of conns) {
      if (!conn.alive) {
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      conn.pingAt = now();
      conn.ws.ping();
    }
  }

  app.server.on('upgrade', onUpgrade);
  const tickTimer = setInterval(tick, 1000 / tickHz).unref();
  const physicsTimer = setInterval(physicsTick, 1000 / BALL.stepHz).unref();
  const pingTimer = setInterval(ping, pingMs).unref();
  const flushTimer = setInterval(flushAll, flushMs).unref();
  const offDynamic = dynamic?.subscribe(onDynamicChange);
  const offMechanisms = mechanisms?.subscribe((state) => {
    for (const p of players.values()) send(p.conn, { t: S2C.MECH_STATE, ...state });
  });
  const offInteractive = interactive?.subscribe((prop) => {
    for (const p of players.values()) send(p.conn, { t: S2C.PROP_STATE, prop });
  });

  return {
    flushAll,
    /** Есть ли у пользователя открытое соединение (в том числе до hello). */
    isOnline: (userId) => connByUser.has(userId),
    get online() {
      return players.size;
    },
    /** Снимок подключённых игроков для Control Center: позиция, чанк, кеш и WebSocket-RTT (по ping/pong сервера). */
    listPlayers() {
      return [...players.values()].map((p) => ({
        userId: p.id,
        name: p.name,
        x: p.x,
        z: p.z,
        cx: p.cx,
        cz: p.cz,
        cache: p.mirror?.stats() ?? null,
        wsRttMs: p.conn.rttMs,
      }));
    },
    /** Сохраняет игроков и обрывает все сокеты (вызывается при остановке сервера). */
    close() {
      clearInterval(tickTimer);
      clearInterval(physicsTimer);
      clearInterval(pingTimer);
      clearInterval(flushTimer);
      offDynamic?.();
      offMechanisms?.();
      offInteractive?.();
      app.server.off('upgrade', onUpgrade);
      flushAll();
      for (const conn of [...conns]) {
        dropConn(conn);
        conn.ws.terminate();
      }
      wss.close();
    },
  };
}

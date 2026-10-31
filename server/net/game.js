// Игровой WebSocket: проверка тикета до upgrade, hello, позиции, рассылка соседям.
// В S1 обрабатываются hello и pos; chat, npc_talk и task_answer приходят в S3.

import { WebSocketServer, WebSocket } from 'ws';
import {
  CHUNK_SIZE,
  CLIENT_CONSTS,
  MAX_SPEED,
  PROTO_VERSION,
  SPAWN,
  SPEED_TOLERANCE,
  TICK_HZ,
  VIEW_RADIUS,
  WORLD_CHUNKS_X,
  WORLD_CHUNKS_Z,
  WORLD_SIZE_X,
  WORLD_SIZE_Z,
} from '../../shared/constants.js';
import { C2S, ERROR_CODES, LIMITS, S2C, decode, encode, validate } from '../../shared/protocol.js';

// Коды закрытия WebSocket (диапазон 4000–4999 отдан приложению).
export const CLOSE = Object.freeze({ REPLACED: 4000, UNAUTH: 4001, BAD_PROTO: 4002 });

const MAX_PAYLOAD = 64 * 1024;
const MAX_BUFFERED = 512 * 1024;
// Границы мира чуть внутри, чтобы чанк всегда лежал в 0..11.
const EDGE = 0.001;
// Расстояние проверяется за время между двумя pos: не меньше одного кадра лимита
// (иначе пачка пакетов давала бы ложные коррекции) и не больше MAX_DT_S
// (иначе можно «накопить» бесконечный запас скорости, простояв на месте).
const MIN_DT_S = 1 / LIMITS.POS_PER_SEC;
const MAX_DT_S = 2;

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
 */
export function createGame({
  app,
  db,
  tickets,
  now = Date.now,
  tickHz = TICK_HZ,
  pingMs = 10_000,
  helloTimeoutMs = 5_000,
}) {
  const log = app.log;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  /** Все открытые сокеты, в том числе ещё не сказавшие hello. */
  const conns = new Set();
  const connByUser = new Map();
  /** Игроки, прошедшие hello. */
  const players = new Map();
  let tickNo = 0;

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
    conns.delete(conn);
    if (connByUser.get(conn.user.id) === conn) connByUser.delete(conn.user.id);
    if (conn.player) removePlayer(conn.player);
    if (code !== undefined && conn.ws.readyState <= WebSocket.OPEN) conn.ws.close(code, reason);
  }

  function handleHello(conn, msg) {
    if (msg.proto !== PROTO_VERSION) {
      sendError(conn, ERROR_CODES.BAD_MSG, `Поддерживается протокол ${PROTO_VERSION}`);
      return dropConn(conn, CLOSE.BAD_PROTO, 'proto');
    }
    clearTimeout(conn.helloTimer);
    const { user } = conn;
    const saved = db.getPlayerState(user.id) ?? SPAWN;
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
      known: new Set(),
      posLimit: createLimiter(LIMITS.POS_PER_SEC),
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
    // chat, npc_talk, task_answer: мосты появятся в S3.
  }

  function onConnection(ws, user) {
    const previous = connByUser.get(user.id);
    if (previous) dropConn(previous, CLOSE.REPLACED, 'replaced');

    const conn = { ws, user, player: null, alive: true, closed: false, helloTimer: null };
    conns.add(conn);
    connByUser.set(user.id, conn);
    conn.helloTimer = setTimeout(() => {
      sendError(conn, ERROR_CODES.UNAUTH, 'hello не получен');
      dropConn(conn, CLOSE.UNAUTH, 'hello timeout');
    }, helloTimeoutMs);

    ws.on('message', (data, isBinary) => onMessage(conn, data, isBinary));
    ws.on('pong', () => {
      conn.alive = true;
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
          send(p.conn, { t: S2C.PLAYER_JOIN, id: q.id, name: q.name, appearance: q.appearance });
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
      conn.ws.ping();
    }
  }

  app.server.on('upgrade', onUpgrade);
  const tickTimer = setInterval(tick, 1000 / tickHz).unref();
  const pingTimer = setInterval(ping, pingMs).unref();

  return {
    flushAll,
    get online() {
      return players.size;
    },
    /** Сохраняет игроков и обрывает все сокеты (вызывается при остановке сервера). */
    close() {
      clearInterval(tickTimer);
      clearInterval(pingTimer);
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

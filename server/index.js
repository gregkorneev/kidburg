import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { registerAgents } from './agents/index.js';
import { registerTasks } from './tasks/index.js';
import { DEFAULT_DB_FILE, openDb } from './db/index.js';
import { registerAuthRoutes, resolveAuthSecrets } from './net/auth.js';
import { createGame } from './net/game.js';
import { createRoom } from './net/room.js';
import { createTicketStore } from './net/tickets.js';
import { loadWorld } from './net/world.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_CONFIG = Object.freeze({
  host: '0.0.0.0',
  port: 3000,
  distDir: path.join(ROOT, 'dist'),
  dbPath: DEFAULT_DB_FILE,
  worldDir: path.join(ROOT, 'generated'),
  passwordAuth: process.env.PASSWORD_AUTH === '1',
  authPepper: process.env.AUTH_PEPPER,
  authSessionSecret: process.env.AUTH_SESSION_SECRET,
  now: Date.now,
});

/** Собирает приложение, но не запускает прослушивание порта. */
export async function buildApp(overrides = {}) {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  // Проверяем ключ до открытия БД и очистки сессий: ошибочная конфигурация не должна менять данные.
  const authSecrets = resolveAuthSecrets({
    passwordAuth: config.passwordAuth,
    authPepper: config.authPepper,
    authSessionSecret: config.authSessionSecret,
  });
  const app = Fastify({ logger: { level: config.logLevel ?? process.env.LOG_LEVEL ?? 'info' } });
  const db = config.db ?? openDb(config.dbPath);
  const world = loadWorld(config.worldDir, app.log);
  const tickets = createTicketStore({ now: config.now });
  // Код комнаты живёт только в памяти этого запуска. Сессии прошлого запуска закрываем:
  // токен, выданный по старому коду, после перезапуска не должен пускать в игру.
  const room = createRoom({ code: config.roomCode });
  db.clearSessions();
  app.decorate('room', room);
  const ctx = { db, world, config, log: app.log, room };

  app.get('/health', async () => ({ ok: true }));

  if (existsSync(config.distDir)) {
    await app.register(fastifyStatic, { root: config.distDir });
  }

  let game = null;
  registerAuthRoutes(app, {
    db,
    tickets,
    room,
    isOnline: (userId) => game?.isOnline(userId) ?? false,
    passwordAuth: config.passwordAuth,
    authSecrets,
    limiter: config.joinLimiter,
    localAddresses: config.localAddresses,
    now: config.now,
  });
  // Задания до игры: createGame берёт готовые обработчики и передаёт им userId и позицию соединения.
  registerTasks(app, ctx);
  game = createGame({
    app,
    db,
    tickets,
    tasks: app.taskHandlers,
    now: config.now,
    world,
    tickHz: config.tickHz,
    pingMs: config.pingMs,
    helloTimeoutMs: config.helloTimeoutMs,
    flushMs: config.flushMs,
    reply: config.reply,
    npcTalkMaxChars: config.npcTalkMaxChars,
    npcTalkPerSec: config.npcTalkPerSec,
  });
  // Сначала сокеты и сохранение игроков, потом база.
  app.addHook('preClose', async () => game.close());
  app.addHook('onClose', async () => db.close());

  registerAgents(app, ctx);
  return app;
}

export async function startServer(overrides = {}) {
  const app = await buildApp(overrides);
  const { host, port } = { ...DEFAULT_CONFIG, ...overrides };
  await app.listen({ host, port });
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? DEFAULT_CONFIG.port);
  const positive = (v) => (Number(v) > 0 ? Number(v) : undefined);
  const app = await startServer({
    port,
    dbPath: process.env.DB_PATH ?? DEFAULT_CONFIG.dbPath,
    npcTalkMaxChars: positive(process.env.NPC_TALK_MAX_CHARS),
    npcTalkPerSec: positive(process.env.NPC_TALK_PER_SEC),
    agents: { probeOnStart: true },
  });
  console.log(`Сервер запущен: http://localhost:${port}`);
  console.log(`Код комнаты: ${app.room.code}`);

  const stop = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { createAdminAuth } from './admin/auth.js';
import { createAudit } from './admin/audit.js';
import { registerAdmin, registerAdminPageGuard } from './admin/routes.js';
import { registerAgents } from './agents/index.js';
import { registerTasks } from './tasks/index.js';
import { DEFAULT_DB_FILE, openDb } from './db/index.js';
import { registerAuthRoutes, resolveAuthSecrets } from './net/auth.js';
import { createGame } from './net/game.js';
import { createRoom } from './net/room.js';
import { createTicketStore } from './net/tickets.js';
import { createMechanisms } from './mechanisms/index.js';
import { createInteractive } from './world/interactive-state.js';
import { loadWorld } from './net/world.js';
import { createTelemetry } from './telemetry/index.js';
import { registerTelemetryRoutes } from './telemetry/routes.js';
import { createDynamicWorld } from './world/dynamic-objects.js';
import { createPlacement } from './world/placement.js';

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
  // Control Center: без ADMIN_PASSWORD панель закрыта; доступ с других компьютеров — только по ADMIN_ALLOW_REMOTE=1.
  adminPassword: process.env.ADMIN_PASSWORD,
  adminAllowRemote: process.env.ADMIN_ALLOW_REMOTE === '1',
  telemetryIntervalMs: Number(process.env.TELEMETRY_INTERVAL_MS) || undefined,
  now: Date.now,
});

/** Собирает приложение, но не запускает прослушивание порта. */
export async function buildApp(overrides = {}) {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  // Проверяем ключ до открытия БД: ошибочная конфигурация не должна менять данные.
  const authSecrets = resolveAuthSecrets({
    passwordAuth: config.passwordAuth,
    authPepper: config.authPepper,
    authSessionSecret: config.authSessionSecret,
  });
  const app = Fastify({ logger: { level: config.logLevel ?? process.env.LOG_LEVEL ?? 'info' } });
  const db = config.db ?? openDb(config.dbPath);
  const world = loadWorld(config.worldDir, app.log);
  const tickets = createTicketStore({ now: config.now });
  // Только сессии, выданные этим запуском, принимаются даже при общем файле БД.
  const sessions = new Map();
  const authDb = {
    ...db,
    createSession(hash, userId, expiresAt) {
      db.createSession(hash, userId, expiresAt);
      sessions.set(hash, expiresAt);
    },
    findSession(hash, now) {
      return sessions.has(hash) ? db.findSession(hash, now) : null;
    },
    purgeExpiredSessions(now) {
      for (const [hash, expiresAt] of sessions) if (expiresAt <= now) sessions.delete(hash);
      return db.purgeExpiredSessions(now);
    },
  };
  const room = createRoom({ code: config.roomCode });
  app.decorate('room', room);
  const ctx = { db, world, config, log: app.log, room };

  const adminAuth = createAdminAuth({
    password: config.adminPassword,
    allowRemote: config.adminAllowRemote,
    localAddresses: config.localAddresses,
    now: config.now,
    log: app.log,
  });
  app.decorate('adminAuth', adminAuth);
  // Хук доступа к /admin ставится до статики: вложенный плагин наследует только уже добавленные хуки.
  registerAdminPageGuard(app, { auth: adminAuth });

  app.get('/health', async () => ({ ok: true }));

  if (existsSync(config.distDir)) {
    await app.register(fastifyStatic, { root: config.distDir, redirect: true });
  }

  // Динамические объекты мира (редактор Control Center) живут поверх статичных чанков.
  const placement = createPlacement({ world });
  const dynamic = createDynamicWorld({ db, placement, world, now: config.now, log: app.log });
  const mechanisms = createMechanisms({ now: config.now });
  const interactive = createInteractive({ db, placement, dynamic, now: config.now, log: app.log });
  const gameWorld = dynamic.wrapWorld(world);
  app.decorate('dynamicWorld', dynamic);
  app.decorate('interactive', interactive);

  let game = null;
  registerAuthRoutes(app, {
    db: authDb,
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
    world: gameWorld,
    dynamic,
    mechanisms,
    interactive,
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

  const telemetry = createTelemetry({ intervalMs: config.telemetryIntervalMs, now: config.now });
  app.decorate('telemetry', telemetry);
  registerTelemetryRoutes(app, { db: authDb, telemetry, authSecrets, now: config.now });
  registerAdmin(app, {
    auth: adminAuth,
    audit: createAudit({ db, now: config.now }),
    telemetry,
    dynamic,
    placement,
    game,
    db,
    world,
    interactive,
    now: config.now,
  });
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

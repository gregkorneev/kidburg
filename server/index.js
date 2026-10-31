import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { registerAgents } from './agents/index.js';
import { registerTasks } from './tasks/index.js';
import { DEFAULT_DB_FILE, openDb } from './db/index.js';
import { registerAuthRoutes } from './net/auth.js';
import { createGame } from './net/game.js';
import { createTicketStore } from './net/tickets.js';
import { loadWorld } from './net/world.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_CONFIG = Object.freeze({
  host: '0.0.0.0',
  port: 3000,
  distDir: path.join(ROOT, 'dist'),
  dbPath: DEFAULT_DB_FILE,
  worldDir: path.join(ROOT, 'generated'),
  now: Date.now,
});

/** Собирает приложение, но не запускает прослушивание порта. */
export async function buildApp(overrides = {}) {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  const app = Fastify({ logger: { level: config.logLevel ?? process.env.LOG_LEVEL ?? 'info' } });
  const db = config.db ?? openDb(config.dbPath);
  const world = loadWorld(config.worldDir, app.log);
  const tickets = createTicketStore({ now: config.now });
  const ctx = { db, world, config, log: app.log };

  app.get('/health', async () => ({ ok: true }));

  if (existsSync(config.distDir)) {
    await app.register(fastifyStatic, { root: config.distDir });
  }

  registerAuthRoutes(app, { db, tickets, now: config.now });
  const game = createGame({
    app,
    db,
    tickets,
    now: config.now,
    world,
    tickHz: config.tickHz,
    pingMs: config.pingMs,
    helloTimeoutMs: config.helloTimeoutMs,
    flushMs: config.flushMs,
  });
  // Сначала сокеты и сохранение игроков, потом база.
  app.addHook('preClose', async () => game.close());
  app.addHook('onClose', async () => db.close());

  registerAgents(app, ctx);
  registerTasks(app, ctx);
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
  const app = await startServer({ port, dbPath: process.env.DB_PATH ?? DEFAULT_CONFIG.dbPath });
  console.log(`Сервер запущен: http://localhost:${port}`);

  const stop = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_CONFIG = Object.freeze({
  host: '0.0.0.0',
  port: 3000,
  distDir: path.join(ROOT, 'dist'),
  dbPath: DEFAULT_DB_FILE,
  now: Date.now,
});

/** Собирает приложение, но не запускает прослушивание порта. */
export async function buildApp(overrides = {}) {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  const app = Fastify({ logger: { level: config.logLevel ?? process.env.LOG_LEVEL ?? 'info' } });
  const db = openDb(config.dbPath);
  const tickets = createTicketStore({ now: config.now });
  const ctx = { db, config, log: app.log };

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
    tickHz: config.tickHz,
    pingMs: config.pingMs,
    helloTimeoutMs: config.helloTimeoutMs,
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
  const app = await startServer({ port });
  console.log(`Сервер запущен: http://localhost:${port}`);

  const stop = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

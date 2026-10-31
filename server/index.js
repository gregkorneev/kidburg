import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { registerAgents } from './agents/index.js';
import { registerTasks } from './tasks/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_CONFIG = Object.freeze({
  host: '0.0.0.0',
  port: 3000,
  distDir: path.join(ROOT, 'dist'),
});

/** Собирает приложение, но не запускает прослушивание порта. */
export async function buildApp(overrides = {}) {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  // db появится в S1 (server/db/index.js).
  const ctx = { db: null, config, log: app.log };

  app.get('/health', async () => ({ ok: true }));

  if (existsSync(config.distDir)) {
    await app.register(fastifyStatic, { root: config.distDir });
  }

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

// HTTP-API Control Center: /api/admin/*. Каждый маршрут защищён на сервере независимо от интерфейса:
// допустимый адрес клиента -> настроенный пароль -> сессия -> Origin и CSRF для изменяющих запросов.
// Контракты запросов и ответов описаны в docs/admin-control-center/architecture.md.

import { WORLD_OBJECT_LIMITS, describeObjectTypes } from '../../shared/world-objects.js';
import { SETTINGS_SCHEMA, SETTINGS_DEFAULTS, validateSettings } from '../agents/settings.js';
import { AI_SERVICES, STATIONS, stationNpcByAgent } from '../../shared/station-npcs.js';
import { originMatchesHost } from './auth.js';

const SSE_MAX_SUBSCRIBERS = 8;
const TEST_TIMEOUT_MS = 90_000;
const TEST_TEXT_MAX = 300;
const WORLD_ACTIONS = new Set(['world.create', 'world.update', 'world.delete', 'world.clear']);
const STATION_LABELS = { firefighter_station_v1: 'Пожарная часть' };
// Диалоговые наставники станций с локальными координатами: размещение берётся из реестра, а не из наличия файла персоны.
const stationPlacement = (agentId) => {
  const npc = stationNpcByAgent(agentId);
  return npc ? STATIONS[npc.stationId].label : null;
};

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};
export const ADMIN_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

const fail = (reply, status, error, message, extra = {}) => reply.code(status).send({ error, message, ...extra });
const worldFail = (reply, res) => fail(reply, res.status, res.code, res.message);

/** Публичный вид динамического объекта. */
const objectView = (o) => ({ id: o.id, type: o.type, x: o.x, z: o.z, ry: o.ry, scale: o.scale, params: o.params, rev: o.rev, createdAt: o.createdAt, updatedAt: o.updatedAt });
/** Состояние объекта для журнала и отката. */
const snapshotOf = (o) => (o ? { id: o.id, type: o.type, x: o.x, z: o.z, ry: o.ry, scale: o.scale, params: o.params, rev: o.rev } : null);

/**
 * Доступ к самой странице /admin: только с допустимого адреса, плюс заголовки безопасности.
 * Регистрируется до @fastify/static, иначе вложенный плагин статики не унаследует хук.
 */
export function registerAdminPageGuard(app, { auth }) {
  const isAdminPage = (url) => url === '/admin' || url.startsWith('/admin/') || url.startsWith('/admin?');
  app.addHook('onRequest', async (req, reply) => {
    if (!isAdminPage(req.url)) return;
    if (!auth.clientAllowed(req)) {
      return reply
        .code(403)
        .headers({ ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' })
        .send('Панель администратора доступна только с компьютера сервера. Удалённый доступ включается явно (ADMIN_ALLOW_REMOTE=1).');
    }
    reply.headers({ ...SECURITY_HEADERS, 'content-security-policy': ADMIN_CSP });
  });
}

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {object} deps
 */
export function registerAdmin(app, { auth, audit, telemetry, dynamic, placement, game, db, world, startedAt = Date.now(), now = Date.now }) {
  const log = app.log;
  const subscribers = new Set();
  let tickTimer = null;
  let lastOllama = null;

  const agentsApi = () => app.agents?.admin;
  const taskHandlers = () => app.taskHandlers;

  // ── Сводки ──────────────────────────────────────────────────────────────────────────────

  const playersByUser = () => new Map(game.listPlayers().map((p) => [p.userId, p]));

  function clientsView(history = false) {
    const byUser = playersByUser();
    return telemetry.clients({ resolve: (id) => byUser.get(id) ?? null, history });
  }

  function agentRows() {
    const api = agentsApi();
    if (!api) return [];
    const tasks = taskHandlers()?.agentTasks ?? {};
    const placedInCity = new Set((world?.npcs ?? []).map((n) => n.agentId));
    return api.listPersonas().map(({ id, persona, error }) => {
      const state = api.getSettings(id);
      const station = stationPlacement(id) ?? (tasks[id] ? STATION_LABELS[tasks[id]] ?? tasks[id] : null);
      const city = placedInCity.has(id);
      return {
        id,
        error,
        name: persona?.name ?? id,
        role: persona?.role ?? '',
        about: persona?.about ?? '',
        style: persona?.style ?? '',
        topics: persona?.topics ?? [],
        placement: {
          status: city || station ? 'placed' : 'not_placed',
          city,
          station,
          // Задания станций проходятся без Ollama: ИИ только отвечает на вопросы игрока.
          passableWithoutAi: city || Boolean(station),
        },
        settings: state.settings,
        revision: state.revision,
        customized: state.customized,
        updatedAt: state.updatedAt,
      };
    });
  }

  /** ИИ-сервисы, которые не являются собеседниками (радио-редактор): состояние берётся из реальных обработчиков и Ollama. */
  async function serviceRows() {
    const ollama = await refreshOllama();
    const tasks = taskHandlers();
    return AI_SERVICES.map((service) => ({
      id: service.id,
      name: service.name,
      kind: service.kind,
      station: service.stationLabel,
      description: service.description,
      placed: Boolean(tasks?.has(service.taskId)),
      usesSharedOllama: true,
      offlineFallback: service.offlineFallback,
      ollama: ollama ? { state: ollama.state, model: ollama.model, message: ollama.message } : null,
      // Без Ollama редактор не отключается: сценарий берётся из локального учебного набора.
      mode: ollama?.state === 'ready' ? 'ollama' : 'offline_fallback',
    }));
  }

  function agentsSummary(rows = agentRows()) {
    const busy = app.agents?.busy ?? { active: 0, queued: 0 };
    return {
      configured: rows.length,
      placed: rows.filter((a) => a.placement.status === 'placed').length,
      active: rows.filter((a) => a.placement.status === 'placed' && a.settings.enabled && !a.error).length,
      generating: busy.active,
      queued: busy.queued,
    };
  }

  function overview(clients = clientsView()) {
    return {
      serverTime: now(),
      startedAt,
      uptimeSec: Math.floor((now() - startedAt) / 1000),
      playersWs: game.online,
      summary: telemetry.summary(clients),
      world: { count: dynamic.count, limit: WORLD_OBJECT_LIMITS.MAX_TOTAL, revision: dynamic.revision, bytes: dynamic.bytes },
      agents: agentsSummary(),
      ollama: lastOllama,
      telemetry: { intervalMs: telemetry.config.intervalMs, sessions: telemetry.size },
    };
  }

  async function refreshOllama(force = false) {
    try {
      lastOllama = (await agentsApi()?.ollamaStatus({ force })) ?? null;
    } catch (err) {
      log.warn({ err }, 'не удалось проверить Ollama');
    }
    return lastOllama;
  }

  // ── Поток SSE ───────────────────────────────────────────────────────────────────────────

  const sseWrite = (sub, event, data) => {
    if (!auth.alive(sub.session)) return dropSub(sub); // сессия отозвана или истекла: данные больше не отдаём
    if (sub.res.writableLength > 1_000_000) return dropSub(sub); // клиент не читает — не копим память
    sub.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  function dropSub(sub) {
    if (!subscribers.delete(sub)) return;
    clearInterval(sub.heartbeat);
    try {
      sub.res.end();
    } catch {
      // уже закрыт
    }
    if (subscribers.size === 0) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }
  const broadcast = (event, data) => {
    for (const sub of [...subscribers]) sseWrite(sub, event, data);
  };

  function tick() {
    void refreshOllama(); // ответ кешируется на 5 секунд
    const clients = clientsView();
    broadcast('tick', { ...overview(clients), clients });
  }
  const unsubscribeWorld = dynamic.subscribe(({ ops, revision, count }) => {
    if (subscribers.size) broadcast('world', { revision, count, ops });
  });
  const unsubscribeAudit = audit.subscribe((entry) => {
    if (subscribers.size) broadcast('audit', entry);
  });
  app.addHook('preClose', async () => {
    unsubscribeWorld();
    unsubscribeAudit();
    for (const sub of [...subscribers]) {
      dropSub(sub);
      sub.req.socket?.destroy();
    }
  });

  // ── Доступ: /admin и /api/admin ────────────────────────────────────────────────────────

  app.register(
    async (scope) => {
      scope.addHook('onRequest', async (req, reply) => {
        reply.headers({ ...SECURITY_HEADERS });
        if (!auth.clientAllowed(req)) {
          return fail(reply, 403, 'admin_remote_disabled', 'Панель администратора доступна только с компьютера сервера');
        }
        if (!auth.enabled) {
          return fail(reply, 503, 'admin_disabled', 'Административный пароль не задан: задайте ADMIN_PASSWORD (не короче 8 символов) и перезапустите сервер');
        }
        const route = req.routeOptions?.config ?? {};
        const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
        // Origin: изменяющие запросы и поток обязаны приходить со страницы этого же хоста.
        if (mutating && !originMatchesHost(req)) return fail(reply, 403, 'bad_origin', 'Запрос с недопустимым Origin');
        if (!mutating && req.headers.origin !== undefined && !originMatchesHost(req)) {
          return fail(reply, 403, 'bad_origin', 'Запрос с недопустимым Origin');
        }
        if (route.public) return;
        const session = auth.session(req);
        if (!session) return fail(reply, 401, 'unauth', 'Нужен вход администратора');
        req.admin = session;
        if (mutating) {
          if (!auth.csrfOk(session, req)) return fail(reply, 403, 'bad_csrf', 'Неверный CSRF-токен');
          if (!auth.rateOk(session)) return fail(reply, 429, 'rate_limit', 'Слишком много действий, подождите несколько секунд');
        }
      });

      // ── Вход и сессия ───────────────────────────────────────────────────────────────────
      scope.get('/status', { config: { public: true } }, async (req) => {
        const session = auth.session(req);
        return { enabled: true, authenticated: Boolean(session), csrf: session?.csrf ?? null, remoteAllowed: auth.allowRemote };
      });

      scope.post('/login', { config: { public: true }, bodyLimit: 2048 }, async (req, reply) => {
        if (auth.loginBlocked(req)) return fail(reply, 429, 'too_many', 'Слишком много неверных попыток. Подождите несколько минут.');
        if (!auth.passwordMatches(req.body?.password)) {
          auth.loginFailed(req);
          audit.record({ sessionId: 'anonymous', action: 'admin.login', entityType: 'session', result: 'rejected', detail: 'неверный пароль' });
          return fail(reply, 401, 'bad_credentials', 'Неверный пароль');
        }
        auth.loginSucceeded(req);
        const { session, cookie } = auth.open();
        reply.header('set-cookie', cookie);
        audit.record({ sessionId: session.id, action: 'admin.login', entityType: 'session', entityId: session.id });
        return { authenticated: true, csrf: session.csrf };
      });

      scope.post('/logout', async (req, reply) => {
        audit.record({ sessionId: req.admin.id, action: 'admin.logout', entityType: 'session', entityId: req.admin.id });
        reply.header('set-cookie', auth.close(req));
        for (const sub of [...subscribers]) if (sub.session === req.admin) dropSub(sub); // потоки этой сессии закрываются сразу
        return { authenticated: false };
      });

      // ── Обзор, клиенты, поток ───────────────────────────────────────────────────────────
      scope.get('/overview', async () => {
        if (!lastOllama) await refreshOllama();
        return overview();
      });

      scope.get('/clients', async () => {
        const clients = clientsView(true);
        return { clients, summary: telemetry.summary(clients), thresholds: telemetry.summary([]).thresholds, intervalMs: telemetry.config.intervalMs };
      });

      scope.get('/stream', async (req, reply) => {
        if (subscribers.size >= SSE_MAX_SUBSCRIBERS) return fail(reply, 429, 'too_many_streams', 'Слишком много открытых потоков панели');
        if (!lastOllama) await refreshOllama();
        reply.hijack();
        const res = reply.raw;
        res.writeHead(200, {
          ...SECURITY_HEADERS,
          'content-type': 'text/event-stream; charset=utf-8',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        res.write('retry: 3000\n\n');
        const sub = { res, req: req.raw, session: req.admin, heartbeat: null };
        sub.heartbeat = setInterval(() => (auth.alive(sub.session) ? res.write(': ping\n\n') : dropSub(sub)), 15_000).unref();
        subscribers.add(sub);
        req.raw.on('close', () => dropSub(sub));
        res.on('close', () => dropSub(sub));
        res.on('error', () => dropSub(sub));
        const clients = clientsView(true);
        sseWrite(sub, 'snapshot', { ...overview(clients), clients, intervalMs: telemetry.config.intervalMs });
        if (!tickTimer) {
          tickTimer = setInterval(tick, 1000);
          tickTimer.unref();
        }
      });

      // ── Мир ──────────────────────────────────────────────────────────────────────────────
      scope.get('/world', async () => ({
        revision: dynamic.revision,
        count: dynamic.count,
        limits: { total: WORLD_OBJECT_LIMITS.MAX_TOTAL, perChunk: WORLD_OBJECT_LIMITS.MAX_PER_CHUNK },
        types: describeObjectTypes(),
        objects: dynamic.list().map(objectView),
        zones: placement.zones(),
        cache: { dynamicBytes: dynamic.bytes },
      }));

      scope.post('/world/validate', { bodyLimit: 4096 }, async (req) => {
        const b = req.body ?? {};
        const res = dynamic.check({ type: b.type, x: b.x, z: b.z, ry: b.ry, scale: b.scale, params: b.params }, { ignoreId: typeof b.id === 'string' ? b.id : null });
        return res.ok ? { ok: true } : { ok: false, code: res.code, message: res.message };
      });

      scope.post('/world/objects', { bodyLimit: 4096 }, async (req, reply) => {
        const b = req.body ?? {};
        const res = dynamic.create({ type: b.type, x: b.x, z: b.z, ry: b.ry, scale: b.scale, params: b.params });
        if (!res.ok) {
          audit.record({ sessionId: req.admin.id, action: 'world.create', entityType: 'world_object', result: 'rejected', after: { type: b.type, x: b.x, z: b.z }, detail: res.message });
          return worldFail(reply, res);
        }
        audit.record({ sessionId: req.admin.id, action: 'world.create', entityType: 'world_object', entityId: res.object.id, after: snapshotOf(res.object) });
        return reply.code(201).send({ object: objectView(res.object), revision: dynamic.revision });
      });

      scope.patch('/world/objects/:id', { bodyLimit: 4096 }, async (req, reply) => {
        const b = req.body ?? {};
        const patch = {};
        for (const key of ['x', 'z', 'ry', 'scale', 'params']) if (b[key] !== undefined) patch[key] = b[key];
        if (b.type !== undefined) patch.type = b.type;
        const res = dynamic.update(req.params.id, patch, { expectedRev: Number.isInteger(b.rev) ? b.rev : null });
        if (!res.ok) {
          audit.record({ sessionId: req.admin.id, action: 'world.update', entityType: 'world_object', entityId: req.params.id, result: 'rejected', detail: res.message });
          return worldFail(reply, res);
        }
        audit.record({ sessionId: req.admin.id, action: 'world.update', entityType: 'world_object', entityId: res.object.id, before: snapshotOf(res.before), after: snapshotOf(res.object) });
        return { object: objectView(res.object), revision: dynamic.revision };
      });

      scope.delete('/world/objects/:id', async (req, reply) => {
        const rev = req.query?.rev;
        const res = dynamic.remove(req.params.id, { expectedRev: rev !== undefined && Number.isInteger(Number(rev)) ? Number(rev) : null });
        if (!res.ok) return worldFail(reply, res);
        audit.record({ sessionId: req.admin.id, action: 'world.delete', entityType: 'world_object', entityId: res.object.id, before: snapshotOf(res.object) });
        return { removed: res.object.id, revision: dynamic.revision };
      });

      scope.post('/world/clear', { bodyLimit: 1024 }, async (req, reply) => {
        if (req.body?.confirm !== true) return fail(reply, 400, 'confirm_required', 'Нужно подтверждение confirm: true');
        const res = dynamic.clear();
        audit.record({ sessionId: req.admin.id, action: 'world.clear', entityType: 'world', before: res.before.map(snapshotOf), after: [], detail: `Удалено объектов: ${res.before.length}` });
        return { removed: res.before.length, revision: dynamic.revision };
      });

      scope.post('/world/undo', async (req, reply) => {
        const entry = audit.list({ limit: 200 }).find((e) => WORLD_ACTIONS.has(e.action) && e.result === 'ok' && !e.undone);
        if (!entry) return fail(reply, 404, 'nothing_to_undo', 'Нет изменений мира, которые можно отменить');
        let res;
        if (entry.action === 'world.create') {
          const current = dynamic.get(entry.entityId);
          if (!current) return fail(reply, 409, 'conflict', 'Объект уже удалён');
          res = dynamic.remove(entry.entityId, { expectedRev: entry.after.rev });
        } else if (entry.action === 'world.update') {
          const b = entry.before;
          res = dynamic.update(entry.entityId, { x: b.x, z: b.z, ry: b.ry, scale: b.scale, params: b.params }, { expectedRev: entry.after.rev });
        } else if (entry.action === 'world.delete') {
          const b = entry.before;
          res = dynamic.create({ type: b.type, x: b.x, z: b.z, ry: b.ry, scale: b.scale, params: b.params }, { id: b.id });
        } else {
          if (dynamic.list().some((o) => entry.before.some((b) => b.id === o.id))) return fail(reply, 409, 'conflict', 'Часть объектов уже восстановлена');
          res = dynamic.restore(entry.before);
        }
        if (!res.ok) return worldFail(reply, res);
        // Объект после отката получил новую ревизию: более ранние записи о нём должны на неё ссылаться, иначе цепочка отмен оборвётся.
        const rebase = (id, oldRev, newRev) => {
          for (const prev of audit.list({ limit: 200, beforeId: entry.id })) {
            if (prev.entityId === id && WORLD_ACTIONS.has(prev.action) && prev.result === 'ok' && !prev.undone && prev.after?.rev === oldRev) {
              audit.rebaseRev(prev.id, newRev);
              return;
            }
          }
        };
        if (entry.action === 'world.update' || entry.action === 'world.delete') rebase(entry.entityId, entry.before.rev, res.object.rev);
        if (entry.action === 'world.clear') for (const o of res.objects) rebase(o.id, entry.before.find((b) => b.id === o.id)?.rev, o.rev);
        audit.markUndone(entry.id);
        audit.record({
          sessionId: req.admin.id,
          action: 'world.undo',
          entityType: entry.entityType,
          entityId: entry.entityId,
          before: entry.after,
          after: entry.before,
          detail: `Отменена запись №${entry.id}: ${entry.action}`,
        });
        return { undone: { id: entry.id, action: entry.action, entityId: entry.entityId }, revision: dynamic.revision };
      });

      // ── Агенты ──────────────────────────────────────────────────────────────────────────
      const findAgent = (id) => agentRows().find((a) => a.id === id);

      scope.get('/agents', async () => {
        const rows = agentRows();
        return { agents: rows, services: await serviceRows(), summary: agentsSummary(rows), schema: SETTINGS_SCHEMA, defaults: SETTINGS_DEFAULTS, ollama: await refreshOllama() };
      });

      scope.get('/agents/:id', async (req, reply) => {
        const agent = findAgent(req.params.id);
        if (!agent) return fail(reply, 404, 'not_found', 'Агент не найден');
        return { agent };
      });

      scope.put('/agents/:id', { bodyLimit: 8192 }, async (req, reply) => {
        const agent = findAgent(req.params.id);
        if (!agent || agent.error) return fail(reply, 404, 'not_found', 'Агент не найден');
        const checked = validateSettings(req.body?.settings);
        if (!checked.ok) return fail(reply, 422, 'invalid_settings', 'Настройки не прошли проверку', { fields: checked.errors });
        if (Number.isInteger(req.body?.revision) && req.body.revision !== agent.revision) {
          return fail(reply, 409, 'conflict', 'Настройки уже изменены (версия устарела), обновите страницу');
        }
        const saved = agentsApi().saveSettings(agent.id, checked.settings, now());
        audit.record({ sessionId: req.admin.id, action: 'agent.update', entityType: 'agent', entityId: agent.id, before: agent.settings, after: saved.settings });
        if (subscribers.size) broadcast('agents', { id: agent.id });
        return { agent: findAgent(agent.id) };
      });

      scope.delete('/agents/:id/settings', async (req, reply) => {
        const agent = findAgent(req.params.id);
        if (!agent || agent.error) return fail(reply, 404, 'not_found', 'Агент не найден');
        agentsApi().resetSettings(agent.id);
        audit.record({ sessionId: req.admin.id, action: 'agent.reset', entityType: 'agent', entityId: agent.id, before: agent.settings, after: SETTINGS_DEFAULTS });
        if (subscribers.size) broadcast('agents', { id: agent.id });
        return { agent: findAgent(agent.id) };
      });

      // Проверка без модели: итоговый промпт и параметры генерации из текущих (или черновых) настроек.
      scope.post('/agents/:id/preview', { bodyLimit: 8192 }, async (req, reply) => {
        const agent = findAgent(req.params.id);
        if (!agent || agent.error) return fail(reply, 404, 'not_found', 'Агент не найден');
        let draft;
        if (req.body?.settings !== undefined) {
          const checked = validateSettings(req.body.settings);
          if (!checked.ok) return fail(reply, 422, 'invalid_settings', 'Настройки не прошли проверку', { fields: checked.errors });
          draft = checked.settings;
        }
        return { preview: agentsApi().preview(agent.id, draft) };
      });

      const testing = new Set();
      scope.post('/agents/:id/test', { bodyLimit: 8192 }, async (req, reply) => {
        const agent = findAgent(req.params.id);
        if (!agent || agent.error) return fail(reply, 404, 'not_found', 'Агент не найден');
        const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
        if (!text || text.length > TEST_TEXT_MAX) return fail(reply, 400, 'bad_text', `Реплика: от 1 до ${TEST_TEXT_MAX} символов`);
        let draft;
        if (req.body?.settings !== undefined) {
          const checked = validateSettings(req.body.settings);
          if (!checked.ok) return fail(reply, 422, 'invalid_settings', 'Настройки не прошли проверку', { fields: checked.errors });
          draft = checked.settings;
        }
        if (testing.has(agent.id)) return fail(reply, 429, 'busy', 'Проверка этого агента уже выполняется');
        testing.add(agent.id);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
        reply.raw.on('close', () => {
          if (!reply.raw.writableEnded) controller.abort();
        });
        const startedAt2 = now();
        let answer = '';
        try {
          // ephemeral: реплика не читает и не пишет память игроков; userId 0 не принадлежит ни одному игроку.
          const stream = app.agents.reply({
            userId: 0,
            agentId: agent.id,
            text,
            ephemeral: true,
            settingsOverride: draft,
            context: { playerName: 'Администратор' },
            signal: controller.signal,
          });
          for await (const token of stream) answer += token;
          audit.record({ sessionId: req.admin.id, action: 'agent.test', entityType: 'agent', entityId: agent.id, detail: `Проверка (${text.length} символов), ответ ${answer.length} символов`, after: { draft: Boolean(draft) } });
          return { ok: true, text: answer.trim(), durationMs: now() - startedAt2, usedDraft: Boolean(draft) };
        } catch (err) {
          const code = err?.code ?? 'error';
          audit.record({ sessionId: req.admin.id, action: 'agent.test', entityType: 'agent', entityId: agent.id, result: 'error', detail: `${code}` });
          return { ok: false, error: { code, message: err?.expose ? err.message : 'Не удалось получить ответ модели' }, durationMs: now() - startedAt2, usedDraft: Boolean(draft) };
        } finally {
          clearTimeout(timer);
          testing.delete(agent.id);
        }
      });

      // ── Журнал ───────────────────────────────────────────────────────────────────────────
      scope.get('/audit', async (req) => {
        const limit = Math.min(Math.max(Number.parseInt(req.query?.limit ?? '50', 10) || 50, 1), 200);
        const before = Number.parseInt(req.query?.before ?? '', 10);
        const entries = audit.list({ limit, beforeId: Number.isInteger(before) && before > 0 ? before : undefined });
        return { entries, nextBefore: entries.length === limit ? entries[entries.length - 1].id : null };
      });
    },
    { prefix: '/api/admin' },
  );
}

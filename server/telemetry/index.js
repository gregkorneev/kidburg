// Центральная телеметрия клиентов: FPS, ping и состояние каждой клиентской сессии (вкладки).
// Клиенты шлют усреднённые измерения раз в несколько секунд по HTTP (POST /api/telemetry), потому что станции
// (пожарная часть, цветочная лавка) открываются отдельными страницами и не все держат общий WebSocket.
// Всё хранится только в памяти: текущее состояние + короткая история ограниченного размера; в SQLite ничего не пишется.

export const TELEMETRY_DEFAULTS = Object.freeze({
  intervalMs: 3000, // как часто клиент должен присылать отчёт
  historySize: 120, // точек на сессию (при 3 с — около 6 минут)
  maxSessions: 200, // предел сессий в памяти
  maxSessionsPerUser: 8,
  staleFactor: 3, // отчётов подряд без новостей до статуса «отключён»
  retainOfflineMs: 120_000, // сколько отключённая сессия остаётся в списке
  minGapMs: 400, // чаще этого отчёты от одной сессии отбрасываются
  avgWindow: 10, // точек для скользящего среднего
  lowFps: 30, // ниже — предупреждение (используется интерфейсом через thresholds)
  highPingMs: 150,
});

export const LOCATIONS = Object.freeze(['city', 'firefighter', 'florist', 'bakery', 'other']);
const QUALITIES = new Set(['low', 'medium', 'high']);
const STATES = new Set(['active', 'hidden', 'paused']);

const isNum = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isCount = (v) => Number.isInteger(v) && v >= 0 && v <= 1e9;
const round1 = (v) => Math.round(v * 10) / 10;

/** Разбор тела отчёта. Неизвестные поля игнорируются, неверные значения — ошибка, а не молчаливое «0». */
export function parseReport(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'нужен объект' };
  if (typeof body.sid !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(body.sid)) return { ok: false, error: 'sid: 8–64 символа [A-Za-z0-9_-]' };
  if (body.bye === true) return { ok: true, report: { sid: body.sid, bye: true } };
  const state = body.state ?? 'active';
  if (!STATES.has(state)) return { ok: false, error: 'state: active | hidden | paused' };
  const loc = body.loc ?? 'other';
  if (typeof loc !== 'string' || !/^[a-z_]{1,24}$/.test(loc)) return { ok: false, error: 'loc: строчные буквы и _' };
  const quality = body.quality ?? null;
  if (quality !== null && !QUALITIES.has(quality)) return { ok: false, error: 'quality: low | medium | high' };

  const optional = (name, check) => {
    const v = body[name];
    if (v === undefined || v === null) return null;
    return check(v) ? v : undefined;
  };
  const fps = optional('fps', (v) => isNum(v, 0, 1000));
  const frameMs = optional('frameMs', (v) => isNum(v, 0, 60_000));
  const ping = optional('ping', (v) => isNum(v, 0, 60_000));
  if (fps === undefined || frameMs === undefined || ping === undefined) return { ok: false, error: 'fps, frameMs, ping: числа в допустимых пределах' };

  let render = null;
  if (body.render !== undefined && body.render !== null) {
    const r = body.render;
    if (typeof r !== 'object' || !['calls', 'triangles', 'geometries', 'textures'].every((k) => isCount(r[k] ?? 0))) {
      return { ok: false, error: 'render: calls, triangles, geometries, textures — целые ≥ 0' };
    }
    render = { calls: r.calls ?? 0, triangles: r.triangles ?? 0, geometries: r.geometries ?? 0, textures: r.textures ?? 0 };
  }
  let chunks = null;
  if (body.chunks !== undefined && body.chunks !== null) {
    if (typeof body.chunks !== 'object' || !isCount(body.chunks.loaded) || !isCount(body.chunks.max)) return { ok: false, error: 'chunks: loaded и max — целые' };
    chunks = { loaded: body.chunks.loaded, max: body.chunks.max };
  }
  return {
    ok: true,
    report: {
      sid: body.sid,
      bye: false,
      state,
      loc,
      quality,
      // Скрытая вкладка не рисует кадры: FPS в этом состоянии не принимается, чтобы не показывать ложное значение.
      fps: state === 'active' ? fps : null,
      frameMs: state === 'active' ? frameMs : null,
      ping,
      render,
      chunks,
    },
  };
}

/**
 * @param {Partial<typeof TELEMETRY_DEFAULTS> & {now?: () => number}} [options]
 */
export function createTelemetry(options = {}) {
  const cfg = { ...TELEMETRY_DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)) };
  const now = options.now ?? Date.now;
  /** @type {Map<string, object>} */
  const sessions = new Map();

  function sweep() {
    const t = now();
    for (const [sid, s] of sessions) {
      if (statusOf(s, t) === 'offline' && t - s.offlineSince() > cfg.retainOfflineMs) sessions.delete(sid);
    }
  }

  function statusOf(s, t = now()) {
    if (s.closed) return 'offline';
    if (t - s.lastSeen > cfg.intervalMs * cfg.staleFactor) return 'offline';
    return s.state === 'active' ? 'online' : 'inactive';
  }

  function makeSession(sid, user, t) {
    return {
      sid,
      userId: user.id,
      name: user.name,
      firstSeen: t,
      lastSeen: t,
      closed: false,
      closedAt: 0,
      state: 'active',
      loc: 'other',
      quality: null,
      fps: null,
      frameMs: null,
      ping: null,
      pingAt: null,
      render: null,
      chunks: null,
      reports: 0,
      history: [],
      // Когда сессия стала «отключённой»: по закрытию или по таймауту тишины.
      offlineSince() {
        return this.closed ? this.closedAt : this.lastSeen + cfg.intervalMs * cfg.staleFactor;
      },
    };
  }

  const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

  function view(s, t, extras = {}, withHistory = false) {
    const recent = s.history.slice(-cfg.avgWindow);
    const fpsVals = recent.map((p) => p.fps).filter((v) => v !== null);
    const pingVals = recent.map((p) => p.ping).filter((v) => v !== null);
    const status = statusOf(s, t);
    return {
      sid: s.sid,
      userId: s.userId,
      name: s.name,
      status, // online | inactive | offline
      state: s.state, // active | hidden | paused
      loc: s.loc,
      quality: s.quality,
      fps: status === 'offline' ? null : s.fps,
      fpsAvg: fpsVals.length ? round1(mean(fpsVals)) : null,
      frameMs: status === 'offline' ? null : s.frameMs,
      ping: status === 'offline' ? null : s.ping,
      pingAvg: pingVals.length ? round1(mean(pingVals)) : null,
      pingKind: 'http', // время ответа GET /health, как в HUD игры
      pingAt: s.pingAt,
      wsRttMs: extras.wsRttMs ?? null,
      wsConnected: extras.wsConnected ?? false,
      render: s.render,
      chunks: extras.cache ?? s.chunks,
      chunksSource: extras.cache ? 'server' : s.chunks ? 'client' : null,
      firstSeen: s.firstSeen,
      lastSeen: s.lastSeen,
      reports: s.reports,
      ...(withHistory ? { history: s.history.map((p) => ({ t: p.t, fps: p.fps, ping: p.ping })) } : {}),
    };
  }

  const api = {
    config: cfg,
    get size() {
      return sessions.size;
    },
    /**
     * Принимает разобранный отчёт от аутентифицированного пользователя.
     * @returns {{ok: true, intervalMs: number} | {ok: false, status: number, code: string, message: string}}
     */
    report(user, report) {
      const t = now();
      sweep();
      let s = sessions.get(report.sid);
      if (s && s.userId !== user.id) return { ok: false, status: 403, code: 'foreign_session', message: 'sid принадлежит другому игроку' };
      if (report.bye) {
        if (s && !s.closed) {
          s.closed = true;
          s.closedAt = t;
        }
        return { ok: true, intervalMs: cfg.intervalMs };
      }
      if (!s) {
        const mine = [...sessions.values()].filter((x) => x.userId === user.id && statusOf(x, t) !== 'offline').length;
        if (mine >= cfg.maxSessionsPerUser) return { ok: false, status: 429, code: 'too_many_sessions', message: 'Слишком много вкладок' };
        if (sessions.size >= cfg.maxSessions) return { ok: false, status: 503, code: 'full', message: 'Телеметрия переполнена' };
        s = makeSession(report.sid, user, t);
        sessions.set(report.sid, s);
      } else if (!s.closed && t - s.lastSeen < cfg.minGapMs) {
        return { ok: false, status: 429, code: 'too_fast', message: 'Отчёты приходят слишком часто' };
      }
      s.closed = false;
      s.lastSeen = t;
      s.name = user.name;
      s.reports += 1;
      s.state = report.state;
      s.loc = report.loc;
      s.quality = report.quality;
      s.fps = report.fps;
      s.frameMs = report.frameMs;
      s.render = report.render;
      s.chunks = report.chunks;
      if (report.ping !== null) {
        s.ping = report.ping;
        s.pingAt = t;
      }
      s.history.push({ t, fps: report.fps, ping: report.ping });
      if (s.history.length > cfg.historySize) s.history.splice(0, s.history.length - cfg.historySize);
      return { ok: true, intervalMs: cfg.intervalMs };
    },

    /**
     * Текущие клиенты. `resolve(userId)` добавляет данные игрового сервера (WebSocket-RTT, кеш чанков).
     * @param {{resolve?: (userId: number) => object|null, history?: boolean}} [opts]
     */
    clients({ resolve = () => null, history = false } = {}) {
      sweep();
      const t = now();
      return [...sessions.values()].map((s) => {
        const info = resolve(s.userId);
        return view(s, t, { wsConnected: Boolean(info), wsRttMs: info?.wsRttMs ?? null, cache: info?.cache ?? null }, history);
      });
    },

    /** Сводные показатели по клиентам; null означает «нет данных», а не ноль. */
    summary(clients) {
      const live = clients.filter((c) => c.status !== 'offline');
      const active = live.filter((c) => c.status === 'online');
      const fpsList = active.map((c) => c.fps).filter((v) => v !== null);
      const pingList = live.map((c) => c.ping).filter((v) => v !== null);
      const stat = (list, fn) => (list.length ? round1(fn(list)) : null);
      return {
        sessionsOnline: active.length,
        sessionsInactive: live.length - active.length,
        sessionsOffline: clients.length - live.length,
        playersOnline: new Set(live.map((c) => c.userId)).size,
        fpsAvg: stat(fpsList, (l) => l.reduce((a, b) => a + b, 0) / l.length),
        fpsMin: stat(fpsList, (l) => Math.min(...l)),
        pingAvg: stat(pingList, (l) => l.reduce((a, b) => a + b, 0) / l.length),
        pingMax: stat(pingList, (l) => Math.max(...l)),
        chunksLoaded: live.reduce((sum, c) => sum + (c.chunks?.loaded ?? 0), 0),
        chunksReporting: live.filter((c) => c.chunks).length,
        thresholds: { lowFps: cfg.lowFps, highPingMs: cfg.highPingMs },
      };
    },
  };
  return api;
}

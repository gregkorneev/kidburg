// Отчёты о FPS и ping для Control Center. Работает на любой странице игры (город, пожарная часть, цветочная лавка,
// пекарня) по обычному HTTP с токеном из sessionStorage: станции открываются отдельными страницами и не все
// держат игровой WebSocket. Раз в несколько секунд шлёт УСРЕДНЁННЫЕ значения, а не каждый кадр.
// Если страница скрыта или кадры не рисуются, отчёт честно помечается состоянием hidden/paused без FPS.

import { createSession } from './session.js';

export const DEFAULT_INTERVAL_MS = 3000;
const FIRST_REPORT_MS = 1500;
// Сервер отбрасывает отчёты одной вкладки чаще, чем раз в 400 мс (429): внеочередной отчёт ждёт этот зазор.
const MIN_GAP_MS = 450;
const MIN_INTERVAL_MS = 1000;
const MAX_INTERVAL_MS = 30_000;
// Меньше стольких кадров за интервал при видимой вкладке — считаем, что рендеринг приостановлен.
const MIN_FRAMES_ACTIVE = 2;

/** Случайный идентификатор вкладки на время жизни страницы (не личность игрока). */
export function makeSessionId(cryptoImpl = globalThis.crypto) {
  const bytes = new Uint8Array(12);
  if (cryptoImpl?.getRandomValues) cryptoImpl.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return `s${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

function sessionIdForTab(storage) {
  const key = 'kidburg.telemetry.sid';
  try {
    const existing = storage?.getItem(key);
    if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
    const sid = makeSessionId();
    storage?.setItem(key, sid);
    return sid;
  } catch {
    return makeSessionId();
  }
}

/** Счётчик кадров: fps и среднее время кадра за окно между двумя снятиями. */
export function createFrameMeter(now, getFrameCount = null) {
  let frames = 0;
  let since = now();
  // Счётчик отрисованных кадров самой сцены (renderer.info.render.frame): кадры считаются по фактическим вызовам render.
  let lastCount = getFrameCount?.() ?? 0;
  const counted = () => {
    const total = getFrameCount();
    const delta = Number.isFinite(total) ? Math.max(0, total - lastCount) : 0;
    if (Number.isFinite(total)) lastCount = total;
    return delta;
  };
  return {
    mark() {
      frames += 1;
    },
    /** Снимает показания и начинает новое окно. fps = null, если окно слишком короткое. */
    take() {
      const t = now();
      const elapsed = t - since;
      const count = getFrameCount ? counted() : frames;
      frames = 0;
      since = t;
      if (elapsed < 200) return { frames: count, fps: null, frameMs: null };
      return { frames: count, fps: (count * 1000) / elapsed, frameMs: count > 0 ? elapsed / count : null };
    },
    reset() {
      frames = 0;
      since = now();
      if (getFrameCount) lastCount = getFrameCount() ?? lastCount;
    },
  };
}

const round1 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

/**
 * @param {object} options
 * @param {string} options.loc city | firefighter | florist | bakery
 * @param {() => string} [options.getQuality] low | medium | high
 * @param {() => ({calls: number, triangles: number, geometries: number, textures: number}|null)} [options.getRenderInfo]
 * @param {() => ({loaded: number, max: number}|null)} [options.getChunks]
 * @param {boolean} [options.externalFrames] страница сама вызывает markFrame() после каждого отрисованного кадра
 * @param {() => number} [options.getFrameCount] накопительный счётчик реально отрисованных кадров сцены
 *   (renderer.info.render.frame). Кадры считаются по его приращению, отдельного цикла requestAnimationFrame нет.
 *   Если не задан ни он, ни externalFrames, кадры считает собственный requestAnimationFrame страницы.
 */
export function startTelemetry({
  loc,
  getQuality = () => null,
  getRenderInfo = () => null,
  getChunks = () => null,
  externalFrames = false,
  getFrameCount = null,
  intervalMs = DEFAULT_INTERVAL_MS,
  win = globalThis.window,
  doc = globalThis.document,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  session = createSession(),
  now = () => performance.now(),
  sid = null,
} = {}) {
  if (!win || !doc || !fetchImpl) return { markFrame() {}, stop() {}, sid: null };
  sid ??= sessionIdForTab(win.sessionStorage);
  const meter = createFrameMeter(now, getFrameCount);
  let interval = Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, intervalMs));
  let timer = null;
  let raf = 0;
  let stopped = false;
  let sending = false;
  let lastReportAt = -Infinity;

  if (!externalFrames && !getFrameCount && win.requestAnimationFrame) {
    const loop = () => {
      meter.mark();
      raf = win.requestAnimationFrame(loop);
    };
    raf = win.requestAnimationFrame(loop);
  }

  const authHeaders = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

  async function measurePing() {
    const start = now();
    try {
      const res = await fetchImpl('/health', { cache: 'no-store' });
      return res.ok ? now() - start : null;
    } catch {
      return null;
    }
  }

  function snapshotState(sample) {
    if (doc.visibilityState === 'hidden') return 'hidden';
    return sample.frames < MIN_FRAMES_ACTIVE ? 'paused' : 'active';
  }

  async function report() {
    timer = null;
    if (stopped) return;
    lastReportAt = now();
    const token = session.token();
    const sample = meter.take();
    if (token && !sending) {
      sending = true;
      try {
        const state = snapshotState(sample);
        const ping = await measurePing();
        const body = {
          sid,
          loc,
          state,
          quality: getQuality() ?? null,
          fps: state === 'active' ? round1(sample.fps) : null,
          frameMs: state === 'active' ? round1(sample.frameMs) : null,
          ping: round1(ping),
        };
        const render = getRenderInfo();
        if (render) body.render = { calls: render.calls | 0, triangles: render.triangles | 0, geometries: render.geometries | 0, textures: render.textures | 0 };
        const chunks = getChunks();
        if (chunks) body.chunks = { loaded: chunks.loaded | 0, max: chunks.max | 0 };
        const res = await fetchImpl('/api/telemetry', { method: 'POST', headers: authHeaders(token), body: JSON.stringify(body), cache: 'no-store' });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (Number.isFinite(data.intervalMs)) interval = Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, data.intervalMs));
        }
      } catch {
        // сервер недоступен или вкладка закрывается: следующая попытка по таймеру
      } finally {
        sending = false;
      }
    }
    schedule(interval);
  }

  function schedule(delay) {
    if (stopped) return;
    win.clearTimeout(timer);
    timer = win.setTimeout(report, delay);
  }

  function sayBye() {
    const token = session.token();
    if (!token) return;
    try {
      // keepalive: запрос доживает до закрытия страницы
      Promise.resolve(fetchImpl('/api/telemetry', { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ sid, bye: true }), keepalive: true })).catch(() => {});
    } catch {
      // не критично: сервер сам отметит вкладку как отключённую по тишине
    }
  }

  // Скрытие и возврат на вкладку: отражаем сразу, не дожидаясь таймера.
  const onVisibility = () => {
    meter.reset();
    schedule(doc.visibilityState === 'hidden' ? Math.max(0, MIN_GAP_MS - (now() - lastReportAt)) : FIRST_REPORT_MS);
  };
  const onPageHide = (e) => {
    if (e?.persisted) return;
    sayBye();
  };
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('pagehide', onPageHide);
  schedule(FIRST_REPORT_MS);

  return {
    sid,
    /** Страница с externalFrames вызывает после каждого отрисованного кадра. */
    markFrame: () => meter.mark(),
    stop() {
      if (stopped) return;
      stopped = true;
      win.clearTimeout(timer);
      if (raf && win.cancelAnimationFrame) win.cancelAnimationFrame(raf);
      doc.removeEventListener('visibilitychange', onVisibility);
      win.removeEventListener('pagehide', onPageHide);
      sayBye();
    },
  };
}

// Состояние приложения и действия: вход, поток SSE, мир, журнал. Компоненты читают срезы через useStore.

import { api, ApiError, errorText } from './lib/api.js';
import { openStream } from './lib/sse.js';
import { createStore, loadPrefs, savePrefs } from './lib/store.js';
import { appendSeries, mergeTick, reuseClients, seedHistories } from './lib/clients.js';
import { applyWorldEvent, emptyWorld, needsReload, typeIndex, worldFromSnapshot } from './lib/world.js';
import { mergeEntries } from './lib/audit.js';

// ── Сессия ───────────────────────────────────────────────────────────────────────────────────

/** phase: loading | login | ready | disabled | remote | unreachable */
export const session = createStore({ phase: 'loading', message: '', busy: false });

export const prefs = createStore(loadPrefs());
prefs.subscribe((p) => savePrefs(p));
export const setPref = (patch) => prefs.set(patch);

// ── Живые данные (SSE) ───────────────────────────────────────────────────────────────────────

const initialLive = () => ({
  conn: 'idle', // idle | connecting | online | reconnecting
  overview: null,
  receivedAt: 0,
  clients: [],
  thresholds: null, // стабильная ссылка: не меняется, пока значения те же (для мемоизации строк)
  histories: {},
  series: [],
  intervalMs: 3000,
  snapshots: 0, // растёт при каждом snapshot (после подключения и переподключения)
  agentsStamp: 0, // растёт при событии `agents`
});
export const live = createStore(initialLive());

export const worldStore = createStore({ status: 'idle', error: '', types: [], typeById: new Map(), zones: null, limits: { total: 150, perChunk: 30 }, world: emptyWorld(), serverCount: 0 });
export const auditStore = createStore({ status: 'idle', error: '', entries: [], nextBefore: null, loadingMore: false });

let stream = null;

function pushSeries(prevSeries, overview) {
  const s = overview?.summary;
  if (!s) return prevSeries;
  return appendSeries(prevSeries, { t: overview.serverTime ?? Date.now(), fps: s.fpsAvg ?? null, ping: s.pingAvg ?? null });
}

const keepThresholds = (prev, overview) => {
  const next = overview?.summary?.thresholds ?? null;
  return prev && next && prev.lowFps === next.lowFps && prev.highPingMs === next.highPingMs ? prev : next;
};

function onSnapshot(data) {
  const { clients = [], intervalMs, ...overview } = data;
  live.set((s) => ({
    ...s,
    overview,
    thresholds: keepThresholds(s.thresholds, overview),
    receivedAt: Date.now(),
    clients: clients.map(({ history, ...c }) => c),
    histories: seedHistories(clients),
    series: pushSeries(s.series, overview),
    intervalMs: intervalMs ?? s.intervalMs,
    snapshots: s.snapshots + 1,
  }));
  // после (пере)подключения данные могли измениться, пока потока не было
  if (worldStore.get().status !== 'idle') void loadWorld({ silent: true });
  if (auditStore.get().status !== 'idle') void loadAudit({ silent: true });
}

function onTick(data) {
  const { clients = [], ...overview } = data;
  live.set((s) => {
    const next = reuseClients(s.clients, clients);
    return {
      ...s,
      overview,
      thresholds: keepThresholds(s.thresholds, overview),
      receivedAt: Date.now(),
      clients: next.length === s.clients.length && next.every((c, i) => c === s.clients[i]) ? s.clients : next,
      histories: mergeTick(s.histories, clients),
      series: pushSeries(s.series, overview),
    };
  });
}

function onWorldEvent(event) {
  const ws = worldStore.get();
  const world = applyWorldEvent(ws.world, event);
  if (world !== ws.world) worldStore.set({ world, serverCount: event.count ?? ws.serverCount });
  if (needsReload(world, event.count)) void loadWorld({ silent: true });
}

function onAuditEvent(entry) {
  auditStore.set((s) => {
    let entries = s.entries;
    // отмена помечает исходную запись: «Отменена запись №N»
    const m = entry.action === 'world.undo' ? /№(\d+)/.exec(entry.detail ?? '') : null;
    if (m) entries = entries.map((e) => (e.id === Number(m[1]) ? { ...e, undone: true } : e));
    return { ...s, entries: mergeEntries(entries, [entry]) };
  });
}

export function startStream() {
  stopStream();
  stream = openStream({
    url: '/api/admin/stream',
    handlers: {
      snapshot: onSnapshot,
      tick: onTick,
      world: onWorldEvent,
      agents: () => live.set((s) => ({ ...s, agentsStamp: s.agentsStamp + 1 })),
      audit: onAuditEvent,
    },
    onState: (conn) => live.set({ conn }),
    // поток закрыт окончательно: возможно, сессия истекла — проверим статус
    onClosed: () => void checkSession(),
  });
}

export function stopStream() {
  stream?.close();
  stream = null;
}

async function checkSession() {
  try {
    const st = await api.get('/status');
    if (!st.authenticated) handleUnauth();
    else api.setCsrf(st.csrf);
  } catch {
    // сервер недоступен — поток сам повторит попытку
  }
}

// ── Вход и выход ─────────────────────────────────────────────────────────────────────────────

function resetData() {
  stopStream();
  live.set(initialLive());
  worldStore.set({ status: 'idle', error: '', types: [], typeById: new Map(), zones: null, limits: { total: 150, perChunk: 30 }, world: emptyWorld(), serverCount: 0 });
  auditStore.set({ status: 'idle', error: '', entries: [], nextBefore: null, loadingMore: false });
}

export function handleUnauth() {
  if (session.get().phase === 'login') return;
  api.setCsrf(null);
  resetData();
  session.set({ phase: 'login', message: 'Сессия завершена, войдите снова.', busy: false });
}

api.setUnauthHandler(handleUnauth);

function enterReady(csrf) {
  api.setCsrf(csrf);
  session.set({ phase: 'ready', message: '', busy: false });
  startStream();
  void loadAudit();
}

function phaseForError(err) {
  if (err.code === 'admin_disabled') return 'disabled';
  if (err.code === 'admin_remote_disabled') return 'remote';
  return 'unreachable';
}

export async function boot() {
  session.set({ phase: 'loading', message: '', busy: false });
  try {
    const st = await api.get('/status');
    if (st.authenticated && st.csrf) enterReady(st.csrf);
    else session.set({ phase: 'login', message: '', busy: false });
  } catch (err) {
    if (err instanceof ApiError) session.set({ phase: phaseForError(err), message: errorText(err), busy: false });
  }
}

export async function login(password) {
  session.set({ busy: true, message: '' });
  try {
    const res = await api.post('/login', { password });
    enterReady(res.csrf);
  } catch (err) {
    if (err instanceof ApiError && (err.code === 'admin_disabled' || err.code === 'admin_remote_disabled')) {
      session.set({ phase: phaseForError(err), message: errorText(err), busy: false });
    } else {
      const text = err.code === 'bad_credentials' ? 'Неверный пароль.' : err.code === 'too_many' ? 'Слишком много неверных попыток. Подождите несколько минут и попробуйте снова.' : errorText(err);
      session.set({ busy: false, message: text });
    }
  }
}

export async function logout() {
  try {
    await api.post('/logout');
  } catch {
    // всё равно выходим локально
  }
  api.setCsrf(null);
  resetData();
  session.set({ phase: 'login', message: '', busy: false });
}

// ── Мир ──────────────────────────────────────────────────────────────────────────────────────

let worldLoading = null;
export function loadWorld({ silent = false } = {}) {
  if (worldLoading) return worldLoading;
  if (!silent || worldStore.get().status === 'idle') worldStore.set({ status: 'loading', error: '' });
  worldLoading = api
    .get('/world')
    .then((data) => {
      worldStore.set({
        status: 'ready',
        error: '',
        types: data.types,
        typeById: typeIndex(data.types),
        zones: data.zones,
        limits: data.limits,
        world: worldFromSnapshot(data.objects, data.revision),
        serverCount: data.count,
      });
    })
    .catch((err) => {
      if (err.status !== 401) worldStore.set({ status: worldStore.get().zones ? 'ready' : 'error', error: errorText(err) });
    })
    .finally(() => {
      worldLoading = null;
    });
  return worldLoading;
}

/** Ответ POST/PATCH/DELETE применяется так же, как событие потока (идемпотентно). */
export function applyWorldResponse(ops, revision) {
  const ws = worldStore.get();
  const world = applyWorldEvent(ws.world, { revision, ops });
  if (world !== ws.world) worldStore.set({ world });
}

// ── Журнал ───────────────────────────────────────────────────────────────────────────────────

export async function loadAudit({ silent = false } = {}) {
  if (!silent) auditStore.set({ status: 'loading', error: '' });
  try {
    const data = await api.get('/audit', { query: { limit: 50 } });
    auditStore.set((s) => ({
      ...s,
      status: 'ready',
      error: '',
      entries: mergeEntries(s.entries, data.entries),
      // если уже догружены старые страницы, продолжаем с прежней позиции
      nextBefore: s.entries.length > data.entries.length ? s.nextBefore : data.nextBefore,
    }));
  } catch (err) {
    if (err.status !== 401) auditStore.set({ status: auditStore.get().entries.length ? 'ready' : 'error', error: errorText(err) });
  }
}

export async function loadMoreAudit() {
  const { nextBefore, loadingMore } = auditStore.get();
  if (!nextBefore || loadingMore) return;
  auditStore.set({ loadingMore: true, error: '' });
  try {
    const data = await api.get('/audit', { query: { limit: 50, before: nextBefore } });
    auditStore.set((s) => ({ ...s, loadingMore: false, entries: mergeEntries(s.entries, data.entries), nextBefore: data.nextBefore }));
  } catch (err) {
    auditStore.set({ loadingMore: false, error: errorText(err) });
  }
}

/** Отмена последнего изменения мира (используется на вкладках «Мир» и «Журнал»). */
export async function undoWorld() {
  const res = await api.post('/world/undo');
  void loadAudit({ silent: true });
  return res;
}

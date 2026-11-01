// Состояние раздела «Агенты»: данные сервера, черновики (переживают переключение вкладок), сохранение и сброс.

import { api, errorText } from './lib/api.js';
import { createStore } from './lib/store.js';
import { cloneSettings, isDirty, normalizeDraft } from './lib/settings.js';

export const agentsStore = createStore({
  status: 'idle', // idle | loading | ready | error
  error: '',
  agents: [],
  schema: [],
  defaults: {},
  services: [],
  summary: null,
  ollama: null,
  selectedId: null,
  drafts: {}, // id -> { values, baseRevision }
});

let loading = null;

export function loadAgents({ silent = false } = {}) {
  if (loading) return loading;
  if (!silent && agentsStore.get().status !== 'ready') agentsStore.set({ status: 'loading', error: '' });
  loading = api
    .get('/agents')
    .then((data) => {
      agentsStore.set((s) => {
        const drafts = { ...s.drafts };
        // черновик без правок (и черновик исчезнувшего агента) заменяется серверным состоянием
        for (const a of data.agents) {
          const d = drafts[a.id];
          if (d && !isDirty(d.values, a.settings, data.schema)) delete drafts[a.id];
        }
        for (const id of Object.keys(drafts)) if (!data.agents.some((a) => a.id === id)) delete drafts[id];
        const selectedId = data.agents.some((a) => a.id === s.selectedId) ? s.selectedId : data.agents[0]?.id ?? null;
        return { ...s, status: 'ready', error: '', agents: data.agents, schema: data.schema, defaults: data.defaults, services: data.services ?? [], summary: data.summary, ollama: data.ollama, selectedId, drafts };
      });
    })
    .catch((err) => {
      if (err.status !== 401) agentsStore.set((s) => ({ ...s, status: s.agents.length ? 'ready' : 'error', error: errorText(err) }));
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

export const selectAgent = (id) => agentsStore.set({ selectedId: id });

/** Текущие значения формы: черновик либо сохранённые настройки. */
export function valuesFor(state, agent) {
  return state.drafts[agent.id]?.values ?? agent.settings;
}

export function editDraft(agent, patch) {
  agentsStore.set((s) => {
    const cur = s.drafts[agent.id] ?? { values: cloneSettings(agent.settings), baseRevision: agent.revision };
    return { ...s, drafts: { ...s.drafts, [agent.id]: { ...cur, values: { ...cur.values, ...patch } } } };
  });
}

export function discardDraft(id) {
  agentsStore.set((s) => {
    const drafts = { ...s.drafts };
    delete drafts[id];
    return { ...s, drafts };
  });
}

function replaceAgent(agent) {
  agentsStore.set((s) => {
    const drafts = { ...s.drafts };
    delete drafts[agent.id];
    return { ...s, agents: s.agents.map((a) => (a.id === agent.id ? agent : a)) };
  });
}

/** Сохранить настройки. Возвращает { ok, error?, fields? }. */
export async function saveAgent(agent) {
  const { drafts, schema } = agentsStore.get();
  const draft = drafts[agent.id];
  if (!draft) return { ok: true };
  try {
    const res = await api.put(`/agents/${encodeURIComponent(agent.id)}`, { settings: normalizeDraft(draft.values, schema), revision: draft.baseRevision });
    replaceAgent(res.agent);
    void loadAgents({ silent: true }); // обновит сводку
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorText(err), fields: err.fields ?? null, conflict: err.code === 'conflict' };
  }
}

export async function resetAgent(agent) {
  try {
    const res = await api.del(`/agents/${encodeURIComponent(agent.id)}/settings`);
    replaceAgent(res.agent);
    void loadAgents({ silent: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}

export async function previewAgent(agent, settings) {
  try {
    const res = await api.post(`/agents/${encodeURIComponent(agent.id)}/preview`, settings ? { settings } : {});
    return { ok: true, preview: res.preview };
  } catch (err) {
    return { ok: false, error: errorText(err), fields: err.fields ?? null };
  }
}

export async function testAgent(agent, text, settings, signal) {
  try {
    const body = settings ? { text, settings } : { text };
    return await api.post(`/agents/${encodeURIComponent(agent.id)}/test`, body, { signal });
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, aborted: true };
    return { ok: false, error: { code: err.code ?? 'error', message: errorText(err) }, fields: err.fields ?? null };
  }
}

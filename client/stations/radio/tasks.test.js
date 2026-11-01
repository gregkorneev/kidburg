import test from 'node:test';
import assert from 'node:assert/strict';
import { createRadioTaskSync, TASK_ID } from './tasks.js';

function makeApi() {
  const listeners = new Map();
  const sent = [];
  const api = {
    net: { status: 'open', send(message) { sent.push(message); return true; } },
    on(type, handler) {
      const group = listeners.get(type) ?? new Set();
      group.add(handler);
      listeners.set(type, group);
      return () => group.delete(handler);
    },
    emit(type, message) { for (const handler of listeners.get(type) ?? []) handler(message); },
  };
  return { api, sent };
}

const serverState = (stage, extra = {}) => ({ stage, category: null, script: null, changed: false, ...extra });
const taskReply = (api, state) => api.emit('task_state', { taskId: TASK_ID, state });

test('opening Radio requests autonomous server preparation without a client-selected category', () => {
  const { api, sent } = makeApi();
  const sync = createRadioTaskSync({ api });
  taskReply(api, serverState('idle'));
  assert.equal(sync.send('open'), true);
  assert.deepEqual(sent.at(-1), { t: 'task_answer', taskId: TASK_ID, payload: { action: 'open' } });
  sync.dispose();
});

test('generate_script is sent once, exposes waiting action, and stays pending without an artificial timeout', () => {
  const { api, sent } = makeApi();
  const pendingChanges = [];
  const sync = createRadioTaskSync({ api, onPending: (value) => pendingChanges.push(value) });
  taskReply(api, serverState('choose_topic', { category: 'weather' }));
  assert.equal(sync.send('generate_script'), true);
  assert.equal(sync.pending, 'generate_script');
  assert.equal(sync.send('generate_script'), false);
  assert.equal(sent.filter((message) => message.payload.action === 'generate_script').length, 1);
  assert.deepEqual(pendingChanges, ['generate_script']);
  assert.equal(sync.pending, 'generate_script');
});

test('server busy response clears waiting, reports feedback, and keeps confirmed category state', () => {
  const { api } = makeApi();
  const notices = [];
  let latest;
  const sync = createRadioTaskSync({ api, onNotice: (value) => notices.push(value), onState: (value) => { latest = value; } });
  taskReply(api, serverState('choose_topic', { category: 'science' }));
  sync.send('generate_script');
  taskReply(api, serverState('choose_topic', { category: 'science', feedback: 'Сценарий уже готовится. Подождите ответ.' }));
  assert.equal(sync.pending, null);
  assert.equal(latest.category, 'science');
  assert.match(notices.at(-1), /готовится/);
});

test('ready script is taken from task_state with server title and complete text', () => {
  const { api } = makeApi();
  let latest;
  const sync = createRadioTaskSync({ api, onState: (value) => { latest = value; } });
  const text = 'Это готовый текст выпуска с учебным дисклеймером.';
  taskReply(api, serverState('ready', { category: 'weather', script: { category: 'weather', topicId: 'weather-topic-1', title: 'Прогноз дня', text, source: 'offline_fallback' } }));
  assert.equal(latest.script.title, 'Прогноз дня');
  assert.equal(latest.script.text, text);
  assert.equal(latest.script.topicId, 'weather-topic-1');
  assert.equal(latest.script.source, 'offline_fallback');
});

test('start, completed, and new broadcast are server-confirmed state changes', () => {
  const { api, sent } = makeApi();
  const observed = [];
  const sync = createRadioTaskSync({ api, onState: (state) => observed.push(state.stage) });
  taskReply(api, serverState('ready', { category: 'science', script: { category: 'science', title: 'Факт', text: 'Научный сценарий.', source: 'ollama' } }));
  sync.send('start_broadcast');
  taskReply(api, serverState('on_air', { category: 'science', script: { category: 'science', title: 'Факт', text: 'Научный сценарий.', source: 'ollama' }, changed: true }));
  sync.send('complete_broadcast');
  taskReply(api, serverState('completed', { category: 'science', script: { category: 'science', title: 'Факт', text: 'Научный сценарий.', source: 'ollama' }, changed: true, done: true }));
  sync.send('new_broadcast');
  taskReply(api, serverState('choose_topic', { changed: true }));
  assert.deepEqual(sent.map((message) => message.payload.action), ['start_broadcast', 'complete_broadcast', 'new_broadcast']);
  assert.deepEqual(observed, ['ready', 'on_air', 'completed', 'choose_topic']);
  assert.equal(sync.state.stage, 'choose_topic');
});

test('UI state restores ready and completed views from reconnect task_state', () => {
  const { api } = makeApi();
  const seen = [];
  createRadioTaskSync({ api, onState: (state, meta) => seen.push({ state, meta }) });
  api.emit('welcome', {});
  taskReply(api, serverState('ready', { script: { category: 'science', title: 'Сохранённый выпуск', text: 'Текст', source: 'ollama' } }));
  taskReply(api, serverState('completed', { script: { category: 'science', title: 'Сохранённый выпуск', text: 'Текст', source: 'ollama' } }));
  assert.equal(seen[0].state.stage, 'ready');
  assert.equal(seen[0].meta.previousStage, null);
  assert.equal(seen[1].state.stage, 'completed');
});

test('disconnect releases local pending action and reconnect server state remains authoritative', () => {
  const { api } = makeApi();
  const notices = [];
  const sync = createRadioTaskSync({ api, onNotice: (value) => notices.push(value) });
  api.emit('welcome', {});
  taskReply(api, serverState('choose_topic'));
  sync.send('generate_script');
  api.emit('status', { status: 'closed' });
  assert.equal(sync.pending, null);
  assert.equal(sync.connected, false);
  assert.equal(sync.send('generate_script'), false);
  api.emit('status', { status: 'open' });
  assert.equal(sync.connected, false, 'reconnected socket waits for welcome before enabling task actions');
  assert.equal(sync.send('generate_script'), false);
  api.emit('welcome', {});
  taskReply(api, serverState('ready', { script: { category: 'weather', title: 'После переподключения', text: 'Сценарий', source: 'ollama' } }));
  assert.equal(sync.state.stage, 'ready');
  assert.equal(sync.connected, true);
  assert.match(notices[0], /Связь потеряна/);
});

test('Radio sync rejects unrelated task_state and recovers an idle state through open', () => {
  const { api, sent } = makeApi();
  const sync = createRadioTaskSync({ api });
  api.emit('task_state', { taskId: 'firefighter_station_v1', state: serverState('completed') });
  assert.equal(sync.state, null);
  taskReply(api, serverState('idle'));
  assert.equal(sync.state.stage, 'idle');
  assert.equal(sync.send('open'), true);
  assert.deepEqual(sent[0].payload, { action: 'open' });
});

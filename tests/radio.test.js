import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgents, resolveAgentConfig } from '../server/agents/index.js';
import { openDb } from '../server/db/index.js';
import { RADIO_TASK_ID, createRadioTask } from '../server/tasks/radio_station_v1.js';
import { SCIENCE_FACTS } from '../content/radio/science-facts.js';
import { RADIO_FALLBACKS } from '../content/radio/fallback-scripts.js';
import { listen, join, getTicket, TestClient, tempDb } from './helpers.js';
import { closedPort, fakeOllama, hangingHandler, tokensHandler } from './ollama-fake.js';

const quietLog = { warn() {}, error() {} };
const WEATHER_DISCLAIMER = 'Это учебный вымышленный прогноз для тренировки радиоведущего.';
const wordCount = (text) => text.trim().split(/\s+/u).filter(Boolean).length;
const weatherScriptText = 'Над городским парком плывут мягкие облака, а лёгкий ветерок качает деревья. На дорожках спокойно и свежо, и жители могут выбрать неспешную прогулку. Позже в нашем вымышленном сюжете небо станет яснее. Это только учебная история для радиовыпуска.';
const scienceScriptText = 'Луна не светит сама, как звезда. Мы видим её, потому что солнечный свет отражается от её поверхности и летит к Земле. Иначе говоря, мы видим лунную поверхность благодаря отражённому солнечному свету, а не собственному сиянию Луны. В этом и состоит проверенный факт.';
const weatherJson = JSON.stringify({ category: 'weather', title: 'Облака над парком', text: weatherScriptText });
const scienceJson = JSON.stringify({ category: 'science', title: 'Луна отражает свет', text: scienceScriptText });

function memoryDb() {
  const progress = new Map();
  return {
    progress,
    getTaskProgress(userId, taskId) { return progress.get(`${userId}:${taskId}`) ?? null; },
    saveTaskProgress(userId, taskId, value) { progress.set(`${userId}:${taskId}`, structuredClone({ userId, taskId, state: value.state, done: value.done })); },
  };
}

async function radioAction(task, userId, action, extra = {}, context = {}) {
  return task.handle(userId, { action, ...extra }, context);
}

async function makeAgents(ollama, overrides = {}) {
  return createAgents({
    db: { getAgentMemory() { throw new Error('Radio must not read agent_memory'); }, saveAgentMemory() { throw new Error('Radio must not write agent_memory'); } },
    config: { agents: { baseUrl: ollama.url, model: 'test-model', idleTimeoutMs: 3000, totalTimeoutMs: 5000, ...overrides } },
    env: {},
    log: quietLog,
  });
}

test('generateRadioScript returns a complete Weather JSON result and uses the shared Ollama format', async (t) => {
  const ollama = await fakeOllama(tokensHandler([weatherJson]));
  t.after(() => ollama.close());
  const agents = await makeAgents(ollama);
  const result = await agents.generateRadioScript({ userId: 1, category: 'weather' });
  assert.equal(result.category, 'weather');
  assert.match(result.topicId, /^radio-[0-9a-f]{20}$/);
  assert.equal(result.title, 'Облака над парком');
  assert.equal(result.source, 'ollama');
  assert.equal(result.text, weatherScriptText);
  assert.ok(result.text.split(/\s+/u).length >= 35 && result.text.split(/\s+/u).length <= 60);
  assert.equal(ollama.requests.length, 1);
  assert.equal(ollama.requests[0].url, '/api/chat');
  assert.equal(ollama.requests[0].body.format, 'json');
  assert.match(ollama.requests[0].body.messages[0].content, /вымышленный прогноз/);
});

test('Science sends one selected local fact and preserves its stable topicId', async (t) => {
  let systemPrompt = '';
  const ollama = await fakeOllama(async (req, res, record) => {
    systemPrompt = record.body.messages[0].content;
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    res.end(`${JSON.stringify({ message: { content: scienceJson }, done: false })}\n${JSON.stringify({ message: { content: '' }, done: true })}\n`);
  });
  t.after(() => ollama.close());
  const agents = await makeAgents(ollama);
  const fact = SCIENCE_FACTS[0];
  const result = await agents.generateRadioScript({ userId: 2, category: 'science', fact });
  assert.equal(result.topicId, fact.topicId);
  assert.equal(result.title, fact.title);
  assert.equal(result.source, 'ollama');
  assert.match(systemPrompt, /не добавляй новые факты, числа или причинно-следственные утверждения/i);
  assert.match(systemPrompt, /примерно 45 слов/);
  assert.match(systemPrompt, /3–4 коротких предложения/);
  assert.ok(systemPrompt.includes(fact.text));
  assert.ok(result.text.split(/\s+/u).length >= 35 && result.text.split(/\s+/u).length <= 60);
  assert.equal(ollama.requests.length, 1);
});

test('NPC reply and Radio share the same bounded Ollama generation slots', async (t) => {
  let releaseNpc;
  const npcGate = new Promise((resolve) => { releaseNpc = resolve; });
  const ollama = await fakeOllama(async (req, res, record) => {
    if (ollama.requests.length === 1) await npcGate;
    const content = record.body.messages[0].content.includes('radio') || record.body.messages.at(-1).content.includes('сценарий')
      ? JSON.stringify({ category: 'weather', title: 'Учебный прогноз: парк', text: `${WEATHER_DISCLAIMER} ${weatherScriptText}` })
      : 'Здравствуйте! Давайте поговорим о работе пожарного. Я помогу узнать о ней больше.';
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    res.end(`${JSON.stringify({ message: { content }, done: false })}\n${JSON.stringify({ message: { content: '' }, done: true })}\n`);
  });
  t.after(() => ollama.close());
  const agents = createAgents({
    db: { getAgentMemory() { return null; }, saveAgentMemory() {} },
    config: { agents: { baseUrl: ollama.url, model: 'test-model', maxConcurrent: 1, maxQueue: 2 } }, env: {}, log: quietLog,
  });
  const npcReply = (async () => {
    const tokens = [];
    for await (const token of agents.reply({ userId: 10, agentId: 'marusya', text: 'Расскажи о своей работе' })) tokens.push(token);
    return tokens.join('');
  })();
  for (let i = 0; i < 30 && ollama.requests.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(ollama.requests.length, 1);
  const radioScript = agents.generateRadioScript({ userId: 10, category: 'weather' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(ollama.requests.length, 1, 'Radio waits for the slot already used by reply()');
  releaseNpc();
  const [npcText, script] = await Promise.all([npcReply, radioScript]);
  assert.match(npcText, /пожарного/);
  assert.equal(script.source, 'ollama');
  assert.equal(ollama.requests.length, 2);
});

test('Science task skips a recently used topicId before asking Ollama', async () => {
  const db = memoryDb();
  const old = SCIENCE_FACTS[0];
  db.saveTaskProgress(9, RADIO_TASK_ID, { state: {
    version: 1, stage: 'completed', category: 'weather', script: { category: 'weather', topicId: 'weather-old', title: 'Выпуск', text: 'Текст', source: 'ollama' },
    recentTopicIds: [old.topicId], recentTopics: [{ topicId: old.topicId, title: old.title }], completedBroadcasts: 1,
  } });
  let selected;
  const task = createRadioTask({ db, log: quietLog, generateRadioScript: async (req) => {
    selected = req.fact;
    return { category: 'science', topicId: req.fact.topicId, title: req.fact.title, text: req.fact.text, source: 'ollama' };
  } });
  const result = await radioAction(task, 9, 'new_broadcast');
  assert.equal(result.state.category, 'science', 'категория выбирается сервером с чередованием');
  assert.notEqual(selected.topicId, old.topicId);
  assert.equal(result.state.script.topicId, selected.topicId);
});

test('Ollama unavailable falls back to a local Weather script without agent memory access', async (t) => {
  const port = await closedPort();
  const agents = createAgents({
    db: { getAgentMemory() { throw new Error('must not read NPC memory'); }, saveAgentMemory() { throw new Error('must not write NPC memory'); } },
    config: { agents: { baseUrl: `http://127.0.0.1:${port}`, model: 'test-model', totalTimeoutMs: 100 } }, env: {}, log: quietLog,
  });
  const db = memoryDb();
  const task = createRadioTask({ db, generateRadioScript: agents.generateRadioScript, log: quietLog });
  const result = await radioAction(task, 5, 'open');
  assert.equal(result.state.stage, 'ready');
  assert.equal(result.state.script.source, 'offline_fallback');
  assert.ok(result.state.script.text.startsWith(WEATHER_DISCLAIMER));
  assert.match(result.state.script.text, /вымышлен|учебн/);
  assert.ok(wordCount(result.state.script.text) >= 35 && wordCount(result.state.script.text) <= 60);
});

test('weather fallback scripts are three-sentence stories with the disclaimer and target length', () => {
  for (const fallback of RADIO_FALLBACKS.weather) {
    const text = `${WEATHER_DISCLAIMER} ${fallback.text.split(WEATHER_DISCLAIMER).join('').trim()}`;
    assert.ok(wordCount(text) >= 35 && wordCount(text) <= 60, fallback.topicId);
    assert.equal((text.match(/[.!?](?:\s|$)/gu) ?? []).length, 4, fallback.topicId);
  }
});

test('model missing, timeout and invalid JSON become typed AI errors for task fallback', async (t) => {
  const missing = await fakeOllama((req, res) => {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'model not found' }));
  });
  const timeout = await fakeOllama(hangingHandler(''));
  const malformed = await fakeOllama(tokensHandler(['not json']));
  const empty = await fakeOllama(tokensHandler(['']));
  const tooShort = await fakeOllama(tokensHandler([JSON.stringify({ category: 'weather', title: 'Короткий прогноз', text: 'Сегодня будет солнечно и спокойно.' })]));
  t.after(async () => { await missing.close(); await timeout.close(); await malformed.close(); await empty.close(); await tooShort.close(); });
  const scenarios = [
    [missing, {}, 'model_missing'],
    [timeout, { idleTimeoutMs: 20, totalTimeoutMs: 100 }, 'timeout'],
    [malformed, {}, 'bad_output'],
    [empty, {}, 'bad_output'],
    [tooShort, {}, 'bad_output'],
  ];
  for (const [server, overrides, code] of scenarios) {
    const agents = await makeAgents(server, overrides);
    await assert.rejects(agents.generateRadioScript({ userId: 1, category: 'weather' }), (err) => err.code === code);
    const taskDb = memoryDb();
    const task = createRadioTask({ db: taskDb, generateRadioScript: agents.generateRadioScript, log: quietLog });
    const result = await radioAction(task, 1, 'open');
    assert.equal(result.state.script.source, 'offline_fallback', code);
    assert.ok(wordCount(result.state.script.text) >= 35 && wordCount(result.state.script.text) <= 60, code);
  }
  const unconfigured = await makeAgents(empty, { model: '' });
  await assert.rejects(unconfigured.generateRadioScript({ userId: 1, category: 'weather' }), (err) => err.code === 'not_configured');
});

test('Science fallback scripts expand only an unused verified fact to the target length', async () => {
  const db = memoryDb();
  const task = createRadioTask({ db, log: quietLog, generateRadioScript: async () => { throw new Error('offline'); } });
  for (const [index, expectedFact] of SCIENCE_FACTS.entries()) {
    const userId = 40 + index;
    const recentTopicIds = SCIENCE_FACTS.filter((fact) => fact.topicId !== expectedFact.topicId).map((fact) => fact.topicId);
    db.saveTaskProgress(userId, RADIO_TASK_ID, { state: {
      version: 1, stage: 'choose_topic', category: 'science', script: null,
      recentTopicIds, recentTopics: [], completedBroadcasts: 0,
    } });
    const result = await radioAction(task, userId, 'generate_script');
    assert.equal(result.state.script.source, 'offline_fallback');
    assert.equal(result.state.script.topicId, expectedFact.topicId);
    assert.ok(result.state.script.text.includes(expectedFact.text), 'fallback содержит выбранный проверенный факт');
    assert.ok(wordCount(result.state.script.text) >= 35 && wordCount(result.state.script.text) <= 60, expectedFact.topicId);
    assert.equal((result.state.script.text.match(/[.!?](?:\s|$)/gu) ?? []).length, 4, expectedFact.topicId);
  }
});

test('Radio rejects invalid state transitions and completes idempotently while saving per-player history', async () => {
  const db = memoryDb();
  const task = createRadioTask({ db, log: quietLog, generateRadioScript: async ({ category }) => ({
    category, topicId: category === 'weather' ? 'weather-test-1' : SCIENCE_FACTS[0].topicId,
    title: 'Тестовый сценарий', text: 'Это достаточно длинный готовый сценарий для чтения в учебном эфире.', source: 'ollama',
  }) });
  assert.match((await radioAction(task, 1, 'start_broadcast')).feedback, /сначала подготовьте/i);
  await radioAction(task, 1, 'open');
  await radioAction(task, 1, 'start_broadcast');
  const first = await radioAction(task, 1, 'complete_broadcast');
  const repeated = await radioAction(task, 1, 'complete_broadcast');
  assert.equal(first.state.completedBroadcasts, 1);
  assert.equal(repeated.state.completedBroadcasts, 1);
  assert.equal(db.getTaskProgress(1, RADIO_TASK_ID).done, true);
  assert.equal(task.getState(2).state.completedBroadcasts, 0);
  assert.deepEqual(task.getState(2).state.recentTopicIds, []);
});

test('Radio category is selected by the server and alternates after a completed broadcast', async () => {
  const db = memoryDb();
  const generatedCategories = [];
  const task = createRadioTask({ db, log: quietLog, generateRadioScript: async ({ category }) => {
    generatedCategories.push(category);
    return { category, topicId: category === 'weather' ? 'weather-auto' : SCIENCE_FACTS[0].topicId,
      title: 'Автоматический выпуск', text: 'Подготовленный текст выпуска для проверки автоматического выбора темы.', source: 'ollama' };
  } });

  const first = await radioAction(task, 30, 'open');
  assert.equal(first.state.category, 'weather', 'первый выпуск автоматически готовится как учебный прогноз');
  const rejectedChoice = await radioAction(task, 30, 'select_category', { category: 'science' });
  assert.match(rejectedChoice.feedback, /автоматически/);
  assert.equal(task.getState(30).state.category, 'weather', 'ввод пользователя не меняет категорию');
  await radioAction(task, 30, 'start_broadcast');
  await radioAction(task, 30, 'complete_broadcast');
  const second = await radioAction(task, 30, 'new_broadcast');
  assert.equal(second.state.category, 'science', 'следующий выпуск чередует категорию');
  assert.deepEqual(generatedCategories, ['weather', 'science']);
  assert.equal(second.state.stage, 'ready', 'новый выпуск сразу готовится до готового сценария');
  assert.notEqual(second.state.stage, 'choose_topic');
  await radioAction(task, 30, 'start_broadcast');
  await radioAction(task, 30, 'complete_broadcast');
  const third = await radioAction(task, 30, 'new_broadcast');
  assert.equal(third.state.category, 'weather', 'после Science чередование возвращается к Weather');
  assert.equal(third.state.stage, 'ready');
  assert.deepEqual(generatedCategories, ['weather', 'science', 'weather']);
});

test('legacy choose_topic progress normalizes and resumes automatic preparation on open', async () => {
  const db = memoryDb();
  const userId = 29;
  const recentFact = SCIENCE_FACTS[0];
  db.saveTaskProgress(userId, RADIO_TASK_ID, { state: {
    version: 1, stage: 'choose_topic', category: 'science', script: null,
    recentTopicIds: [recentFact.topicId], recentTopics: [{ topicId: recentFact.topicId, title: recentFact.title }],
    completedBroadcasts: 1,
  } });
  let generated;
  const task = createRadioTask({ db, log: quietLog, generateRadioScript: async ({ category, fact }) => {
    generated = { category, fact };
    return { category, topicId: fact.topicId, title: fact.title, text: fact.text, source: 'ollama' };
  } });

  const restored = task.getState(userId).state;
  assert.equal(restored.stage, 'idle');
  assert.equal(restored.category, 'science');
  assert.equal(restored.script, null);
  assert.equal(db.getTaskProgress(userId, RADIO_TASK_ID).state.stage, 'idle');

  const resumed = await radioAction(task, userId, 'open');
  assert.equal(resumed.state.stage, 'ready');
  assert.equal(resumed.state.category, 'science');
  assert.notEqual(generated.fact.topicId, recentFact.topicId);
  assert.equal(resumed.state.script.topicId, generated.fact.topicId);
  assert.equal(db.getTaskProgress(userId, RADIO_TASK_ID).state.stage, 'ready');
});

test('Radio task prepends a fixed server-owned Weather disclaimer to generated content', async () => {
  const db = memoryDb();
  const task = createRadioTask({ db, log: quietLog, generateRadioScript: async () => ({
    category: 'weather', topicId: 'weather-disclaimer-test', title: 'Облака',
    text: 'Над городским парком плывут облака и шелестят деревья.', source: 'ollama',
  }) });
  await radioAction(task, 32, 'open');
  const ready = task.getState(32);
  assert.ok(ready.state.script.text.startsWith(WEATHER_DISCLAIMER));
  assert.ok(ready.state.script.text.includes('Над городским парком'));
});

test('a second generate_script is rejected while one generation is in flight', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const db = memoryDb();
  const task = createRadioTask({ db, log: quietLog, generateRadioScript: async () => {
    calls += 1;
    await gate;
    return { category: 'weather', topicId: 'weather-unique-1', title: 'Тема', text: 'Готовый текст достаточно длинный для чтения в эфире.', source: 'ollama' };
  } });
  const pending = radioAction(task, 3, 'open');
  await Promise.resolve();
  const duplicate = await radioAction(task, 3, 'generate_script');
  assert.equal(calls, 1);
  assert.match(duplicate.feedback, /уже готовится/i);
  release();
  assert.equal((await pending).state.stage, 'ready');
});

test('disconnect abort does not save fallback or a late generated script', async () => {
  const db = memoryDb();
  let calls = 0;
  const task = createRadioTask({ db, log: quietLog, generateRadioScript: ({ signal }) => {
    calls += 1;
    if (calls > 1) return Promise.resolve({
      category: 'weather', topicId: 'weather-after-abort', title: 'Новый выпуск',
      text: 'Над парком светит солнце, а ветер тихо шевелит листья.', source: 'ollama',
    });
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    });
  } });
  const controller = new AbortController();
  const pending = radioAction(task, 7, 'open', {}, { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  task.forget(7);
  const result = await pending;
  assert.equal(result.state.stage, 'idle');
  assert.equal(result.state.category, 'weather');
  assert.equal(result.state.script, null, 'abort не сохраняет частичный или fallback сценарий');
  assert.equal(db.getTaskProgress(7, RADIO_TASK_ID).state.stage, 'idle');
  assert.equal(db.getTaskProgress(7, RADIO_TASK_ID).state.script, null);
  assert.equal((await radioAction(task, 7, 'open')).state.stage, 'ready', 'после abort физический lock освобождён');
  assert.equal(calls, 2);
});

test('shared agent configuration remains loopback-only and rejects external URLs', () => {
  assert.equal(resolveAgentConfig({}, { OLLAMA_MODEL: 'test-model' }).baseUrl, 'http://127.0.0.1:11434');
  assert.throws(() => resolveAgentConfig({ baseUrl: 'https://example.com' }, {}), /127\.0\.0\.1/);
});

test('WebSocket awaits Radio generation without blocking other task messages and disconnect aborts Ollama', async (t) => {
  let finishRequest;
  const gate = new Promise((resolve) => { finishRequest = resolve; });
  const ollama = await fakeOllama(async (req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    await gate;
    if (!res.destroyed) res.end(`${JSON.stringify({ message: { content: weatherJson }, done: false })}\n${JSON.stringify({ message: { content: '' }, done: true })}\n`);
  });
  const temp = tempDb();
  const { app, port } = await listen({
    dbPath: temp.dbPath,
    agents: { baseUrl: ollama.url, model: 'test-model', idleTimeoutMs: 5000, totalTimeoutMs: 6000 },
  });
  t.after(async () => { finishRequest(); await app.close(); temp.cleanup(); await ollama.close(); });

  const session = await join(app, 'Radio Player');
  const client = await TestClient.connect(port, await getTicket(app, session.token));
  t.after(() => client.ws.terminate());
  client.send({ t: 'hello', ticket: 'x', proto: 1 });
  await client.nextOfType('welcome');
  const initial = await client.next((m) => m.t === 'task_state' && m.taskId === RADIO_TASK_ID);
  assert.equal(initial.state.stage, 'idle');
  const sendAction = async (action, extra = {}) => {
    client.send({ t: 'task_answer', taskId: RADIO_TASK_ID, payload: { action, ...extra } });
    return (await client.next((m) => m.t === 'task_state' && m.taskId === RADIO_TASK_ID)).state;
  };
  client.send({ t: 'task_answer', taskId: RADIO_TASK_ID, payload: { action: 'open' } });
  for (let i = 0; i < 30 && ollama.requests.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(ollama.requests.length, 1);
  client.send({ t: 'task_answer', taskId: 'firefighter_station_v1', payload: { action: 'resume' } });
  const firefighter = await client.next((m) => m.t === 'task_state' && m.taskId === 'firefighter_station_v1');
  assert.equal(firefighter.state.stage, 'not_started');
  client.ws.terminate();
  const closedRequest = await ollama.requests[0].finished;
  assert.equal(closedRequest.aborted, true);
  finishRequest();

  const verifyDb = openDb(temp.dbPath);
  const saved = verifyDb.getTaskProgress(session.user.id, RADIO_TASK_ID);
  verifyDb.close();
  assert.equal(saved.state.stage, 'idle');
  assert.equal(saved.state.category, 'weather');
  assert.equal(saved.state.script, null, 'disconnect не сохраняет поздний результат или fallback');
});

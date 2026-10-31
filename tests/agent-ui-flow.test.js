// Полный путь: вход по коду комнаты → тикет → WebSocket → разговор с NPC через клиентский UI-слой
// (createNpcChat поверх настоящих createHttp/createNet) → подменная локальная Ollama. Браузер не нужен.

import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { WORLD_POINTS } from '../client/stations/firefighter/layout.js';
import { TASK_ID, createTaskSync } from '../client/stations/firefighter/tasks.js';
import { createEmitter } from '../client/engine/emitter.js';
import { ApiError, createHttp } from '../client/engine/http.js';
import { createNet } from '../client/engine/net.js';
import { createSession } from '../client/engine/session.js';
import { createNpcChat } from '../client/ui/npc-chat-core.js';
import { listen, seedPlayerState, tempDb, tempWorld } from './helpers.js';
import { closedPort, fakeOllama, hangingHandler, ndjsonLine, tokensHandler } from './ollama-fake.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const THERAPIST = { agentId: 'therapist', name: 'therapist' };
const MARUSYA = { agentId: 'marusya', name: 'marusya' };

function fakeStorage() {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, String(v)), removeItem: (k) => void map.delete(k) };
}

/** «Вкладка браузера»: те же http, session и net, что в client/engine/app.js, и разговор с NPC. */
function browser(port, room) {
  const emitter = createEmitter();
  const http = createHttp({ baseUrl: `http://127.0.0.1:${port}` });
  const session = createSession(fakeStorage());
  const sockets = [];
  class TrackedSocket extends WebSocket {
    constructor(url) {
      super(url);
      sockets.push(this);
    }
  }
  const net = createNet({
    http, session, emitter, WebSocketImpl: TrackedSocket,
    location: { protocol: 'http:', host: `127.0.0.1:${port}` }, retryMinMs: 20, retryMaxMs: 50,
  });
  const api = {
    on: (type, handler) => emitter.on(type, handler),
    state: { me: null },
    ui: { lockPointer() {}, unlockPointer() {} },
    net: { send: (msg) => net.send(msg), get status() { return net.status; } },
  };
  emitter.on('welcome', (msg) => { api.state.me = { id: msg.playerId, name: msg.name }; });
  const events = [];
  for (const t of ['task_state', 'agent_queue', 'agent_token', 'agent_done', 'agent_error']) emitter.on(t, (m) => events.push(m));
  const chat = createNpcChat({ api });
  const waitFor = (type, ms = 3000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`событие ${type} не пришло`)), ms);
    const off = emitter.on(type, (m) => { clearTimeout(timer); off(); resolve(m); });
  });
  return {
    emitter, http, session, net, api, chat, events, waitFor,
    /** Как api.auth.join: вход по имени и коду, затем сокет. Позицию можно задать до hello. */
    async join(name, { beforeConnect } = {}) {
      const { token, user } = await http.join(name, room);
      session.save(token, user);
      await beforeConnect?.();
      const welcome = waitFor('welcome');
      net.connect();
      await welcome;
      return user;
    },
    /** Ждёт, пока состояние чата удовлетворит условию. */
    until(predicate, ms = 3000) {
      return new Promise((resolve, reject) => {
        if (predicate(chat.state)) return resolve(chat.state);
        const timer = setTimeout(() => { off(); reject(new Error(`состояние чата не наступило: ${JSON.stringify(chat.state)}`)); }, ms);
        const off = chat.subscribe((s) => { if (predicate(s)) { clearTimeout(timer); off(); resolve(s); } });
      });
    },
    close() {
      chat.dispose();
      net.disconnect();
      for (const socket of sockets) socket.terminate(); // не ждать рукопожатия закрытия (30 с в ws)
    },
  };
}

async function setup({ ollama, agents = {}, withDb = false } = {}) {
  const world = tempWorld();
  const db = withDb ? tempDb() : null;
  const { app, port } = await listen({
    worldDir: world.worldDir, ...(db && { dbPath: db.dbPath }), npcTalkPerSec: 100,
    agents: { baseUrl: ollama?.url ?? 'http://127.0.0.1:1', model: 'test-model', ...agents },
  });
  const tabs = [];
  return {
    app, port, dbPath: db?.dbPath,
    tab() { const t = browser(port, app.room.code); tabs.push(t); return t; },
    async stop() {
      for (const t of tabs) t.close();
      await app.close();
      world.cleanup();
      db?.cleanup();
      await ollama?.close();
    },
  };
}

/** Ответ-эхо: модель повторяет последнюю реплику игрока, по слову за токен. */
const echoHandler = () => (req, res, rec) => {
  const last = rec.body.messages.at(-1).content;
  res.writeHead(200);
  for (const word of `Эхо: ${last}`.split(' ')) res.write(ndjsonLine(`${word} `));
  res.end(ndjsonLine('', true));
};

test('вход по коду комнаты, затем разговор: токены доходят потоком, следующая реплика уходит после done', async () => {
  const ollama = await fakeOllama(tokensHandler(['Здрав', 'ствуйте', '!']));
  const s = await setup({ ollama });
  try {
    const t = s.tab();
    await assert.rejects(t.http.join('Аня', 'ZZZZ'), (e) => e instanceof ApiError && e.code === 'bad_room');
    assert.equal(t.net.status, 'closed', 'без верного кода сокет не открывается');

    await t.join('Аня');
    assert.equal(t.net.status, 'open');
    t.chat.open(THERAPIST);
    assert.equal(t.chat.send('Расскажите о своей работе'), true);
    const done = await t.until((st) => st.status === 'idle' && st.messages.at(-1)?.text);
    assert.equal(done.messages.at(-1).text, 'Здравствуйте!');
    assert.equal(done.messages.at(-1).pending, false);
    assert.equal(done.error, '');
    assert.equal(t.events.filter((m) => m.t === 'agent_token').length, 3, 'ответ пришёл тремя токенами');

    assert.equal(t.chat.send('А что нужно, чтобы стать врачом?'), true);
    await t.until((st) => st.status === 'idle' && st.messages.length === 4);
    assert.equal(ollama.requests.length, 2);
    // Память сервера: вторая реплика уходит в модель вместе с первой.
    assert.ok(JSON.stringify(ollama.requests[1].body.messages).includes('Расскажите о своей работе'));
  } finally {
    await s.stop();
  }
});

test('очередь: ждущий игрок видит позицию, затем получает ответ; другой игрок позицию не видит', async () => {
  const gate = Promise.withResolvers();
  const ollama = await fakeOllama(async (req, res, rec) => {
    res.writeHead(200);
    if (ollama.requests.length === 1) await gate.promise;
    res.write(ndjsonLine('Готово'));
    res.end(ndjsonLine('', true));
  });
  const s = await setup({ ollama, agents: { maxConcurrent: 1 } });
  try {
    const [alice, bob] = [s.tab(), s.tab()];
    await alice.join('Аня');
    await bob.join('Борис');
    alice.chat.open(THERAPIST);
    bob.chat.open(THERAPIST);
    alice.chat.send('Первый');
    await sleep(60);
    bob.chat.send('Второй');
    const queued = await bob.until((st) => st.status === 'queued');
    assert.equal(queued.queue, 1);
    assert.equal(alice.events.filter((m) => m.t === 'agent_queue').length, 0);
    gate.resolve();
    await bob.until((st) => st.status === 'idle' && st.messages.at(-1)?.text === 'Готово');
    await alice.until((st) => st.status === 'idle' && st.messages.at(-1)?.text === 'Готово');
  } finally {
    await s.stop();
  }
});

test('разговоры разных игроков не смешиваются: каждый видит только своё эхо и свою память', async () => {
  const ollama = await fakeOllama(echoHandler());
  const s = await setup({ ollama });
  try {
    const [alice, bob] = [s.tab(), s.tab()];
    await alice.join('Аня');
    await bob.join('Борис');
    alice.chat.open(THERAPIST);
    bob.chat.open(THERAPIST);
    alice.chat.send('секрет ананас');
    bob.chat.send('тайна яблоко');
    await alice.until((st) => st.status === 'idle' && st.messages.length === 2);
    await bob.until((st) => st.status === 'idle' && st.messages.length === 2);
    assert.equal(alice.chat.state.messages[1].text.trim(), 'Эхо: секрет ананас');
    assert.equal(bob.chat.state.messages[1].text.trim(), 'Эхо: тайна яблоко');

    alice.chat.send('что я говорил');
    await alice.until((st) => st.status === 'idle' && st.messages.length === 4);
    const aliceRequest = ollama.requests.find((r) => r.body.messages.at(-1).content === 'что я говорил').body;
    assert.ok(JSON.stringify(aliceRequest).includes('ананас'));
    assert.ok(!JSON.stringify(aliceRequest).includes('яблоко'), 'история Бориса не попала к Ане');
    assert.ok(!JSON.stringify(alice.chat.state.messages).includes('яблоко'));
  } finally {
    await s.stop();
  }
});

test('обрыв посреди ответа: UI показывает ошибку, Ollama получает отмену, после переподключения можно писать снова', async () => {
  let mode = 'hang';
  const ollama = await fakeOllama((req, res, rec) => (mode === 'hang' ? hangingHandler('Начало')(req, res, rec) : tokensHandler(['Снова на связи'])(req, res)));
  const s = await setup({ ollama });
  try {
    const t = s.tab();
    await t.join('Аня');
    t.chat.open(THERAPIST);
    t.chat.send('Привет');
    await t.until((st) => st.status === 'streaming');
    t.net.disconnect();
    await t.until((st) => st.status === 'idle');
    assert.match(t.chat.state.error, /Связь с сервером прервалась/);
    assert.equal(t.chat.state.messages.at(-1).text, 'Начало', 'полученное остаётся');
    assert.equal((await ollama.requests[0].finished).aborted, true, 'генерация прекращена');
    assert.equal(t.chat.send('Пока нет связи'), false);

    mode = 'ok';
    const welcome = t.waitFor('welcome');
    t.net.connect();
    await welcome;
    assert.equal(t.chat.send('Я вернулся'), true);
    await t.until((st) => st.status === 'idle' && st.messages.at(-1)?.text === 'Снова на связи');
    assert.equal(t.chat.state.error, '');
  } finally {
    await s.stop();
  }
});

test('Ollama недоступна или модели нет: игрок видит понятную причину, сервер продолжает работать', async () => {
  const port = await closedPort();
  const s = await setup({ agents: { baseUrl: `http://127.0.0.1:${port}` } });
  try {
    const t = s.tab();
    await t.join('Аня');
    t.chat.open(THERAPIST);
    t.chat.send('Привет');
    await t.until((st) => st.status === 'idle' && st.error);
    assert.match(t.chat.state.error, /недоступна/);
    assert.deepEqual(t.chat.state.messages.map((m) => m.from), ['me']);
    assert.equal(t.chat.canSend, true);
    assert.equal((await s.app.inject({ method: 'GET', url: '/health' })).statusCode, 200);
  } finally {
    await s.stop();
  }

  const ollama = await fakeOllama((req, res) => {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"error":"model \'test-model\' not found"}');
  });
  const missing = await setup({ ollama });
  try {
    const t = missing.tab();
    await t.join('Борис');
    t.chat.open(THERAPIST);
    t.chat.send('Привет');
    await t.until((st) => st.status === 'idle' && st.error);
    assert.match(t.chat.state.error, /test-model.*не загружена/);
  } finally {
    await missing.stop();
  }

  const unset = await setup({ agents: { model: '' } });
  try {
    const t = unset.tab();
    await t.join('Вера');
    t.chat.open(THERAPIST);
    t.chat.send('Привет');
    await t.until((st) => st.status === 'idle' && st.error);
    assert.match(t.chat.state.error, /OLLAMA_MODEL/);
  } finally {
    await unset.stop();
  }
});

test('вне радиуса NPC: UI получает too_far и остаётся рабочим', async () => {
  const ollama = await fakeOllama(tokensHandler(['ок']));
  const s = await setup({ ollama });
  try {
    const t = s.tab();
    await t.join('Аня'); // точка возрождения далеко от Маруси (≈11,5 м), но рядом с терапевтом
    t.chat.open(MARUSYA);
    t.chat.send('Привет');
    await t.until((st) => st.status === 'idle' && st.error);
    assert.match(t.chat.state.error, /далеко/);
    assert.equal(ollama.requests.length, 0);
    t.chat.close();
    t.chat.open(THERAPIST);
    t.chat.send('Привет');
    await t.until((st) => st.status === 'idle' && st.messages.at(-1)?.text === 'ок');
  } finally {
    await s.stop();
  }
});

test('Маруся: разговор у наставницы и прогресс станции переживает повторный вход; прогресс игроков раздельный', async () => {
  const ollama = await fakeOllama(echoHandler());
  const s = await setup({ ollama, withDb: true });
  const nearMarusya = { x: WORLD_POINTS.npc.x + 1, y: 0, z: WORLD_POINTS.npc.z, ry: 0 };
  const lastState = (t) => t.events.filter((m) => m.t === 'task_state' && m.taskId === TASK_ID).at(-1)?.state;
  try {
    const alice = s.tab();
    await alice.join('Аня', { beforeConnect: () => seedPlayerState(s.dbPath, 'Аня', nearMarusya) });
    const bob = s.tab();
    await bob.join('Борис');
    await sleep(100);
    assert.equal(lastState(alice).stage, 'not_started');

    // Начинаем смену так, как это делает preview: клиент просит действие, состояние подтверждает сервер.
    const sync = createTaskSync({ api: alice.api, onState: () => {}, onNotice: () => {} });
    const confirmed = new Promise((resolve) => sync.send('start', { onConfirmed: resolve }));
    assert.equal((await confirmed).stage, 'briefing');

    alice.chat.open(MARUSYA);
    alice.chat.send('Зачем нужна экипировка');
    await alice.until((st) => st.status === 'idle' && st.messages.length === 2);
    assert.match(alice.chat.state.messages[1].text, /Эхо: Зачем нужна экипировка/);
    assert.match(ollama.requests[0].body.messages[0].content, /Маруся Громова/);
    assert.equal(lastState(bob).stage, 'not_started', 'прогресс Бориса не изменился');

    // «Перезагрузка страницы»: новая вкладка, то же имя, сервер присылает сохранённое состояние.
    sync.dispose();
    alice.close();
    const reloaded = s.tab();
    let user;
    for (let attempt = 0; !user; attempt++) {
      try {
        user = await reloaded.join('Аня');
      } catch (err) {
        if (attempt > 40 || err.code !== 'name_taken') throw err;
        await sleep(25);
      }
    }
    await sleep(100);
    assert.equal(lastState(reloaded).stage, 'briefing', 'прогресс станции восстановлен');
    assert.deepEqual(reloaded.chat.state.messages, [], 'на новой странице переписка пуста, память хранит сервер');
    reloaded.chat.open(MARUSYA);
    reloaded.chat.send('Что мы обсуждали?');
    await reloaded.until((st) => st.status === 'idle' && st.messages.length === 2);
    const request = ollama.requests.at(-1).body.messages;
    assert.ok(JSON.stringify(request).includes('Зачем нужна экипировка'), 'память разговора восстановлена на сервере');
  } finally {
    await s.stop();
  }
});

// Полный путь: вход по коду комнаты → тикет → WebSocket → разговор с NPC через клиентский UI-слой
// (createNpcChat поверх настоящих createHttp/createNet) → подменная локальная Ollama. Браузер не нужен.

import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { WORLD_POINTS } from '../client/stations/firefighter/layout.js';
import { SAY, createMarusyaChat } from '../client/stations/firefighter/chat-flow.js';
import { TASK_ID, createTaskSync } from '../client/stations/firefighter/tasks.js';
import { createEmitter } from '../client/engine/emitter.js';
import { ApiError, createHttp } from '../client/engine/http.js';
import { createNet } from '../client/engine/net.js';
import { createSession } from '../client/engine/session.js';
import { createNpcChat } from '../client/ui/npc-chat-core.js';
import { openDb } from '../server/db/index.js';
import { listen, seedPlayerState, tempDb, tempWorld } from './helpers.js';
import { FIRST_SENTENCE, closedPort, fakeOllama, hangingHandler, ndjsonLine, tokensHandler } from './ollama-fake.js';

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
      const { token, user } = await http.join(name, room, { avatar: { skin: 0, clothes: 0, hair: 0, hairColor: 0, shoes: 0 } });
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
  // Второй ответ другой: одинаковые подряд защита от повторов не пропустит.
  const ollama = await fakeOllama((req, res, rec) =>
    tokensHandler(ollama.requests.length === 1
      ? ['Здрав', 'ствуйте, дорогой коллега. ', 'Рад ', 'знакомству']
      : ['Чтобы стать врачом, нужно долго учиться в университете и практиковаться.'])(req, res, rec));
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
    assert.equal(done.messages.at(-1).text, 'Здравствуйте, дорогой коллега. Рад знакомству');
    assert.equal(done.messages.at(-1).pending, false);
    assert.equal(done.error, '');
    assert.equal(t.events.filter((m) => m.t === 'agent_token').length, 3, 'начало одним куском, затем поток');

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
  const ollama = await fakeOllama((req, res, rec) => (mode === 'hang' ? hangingHandler()(req, res, rec) : tokensHandler(['Снова на связи'])(req, res)));
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
    assert.equal(t.chat.state.messages.at(-1).text, FIRST_SENTENCE, 'полученное остаётся');
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

// ---- Маруся: ИИ-диалог поверх станции (чат-сценарий preview против настоящего сервера) ----

const nearMarusya = { x: WORLD_POINTS.npc.x + 1, y: 0, z: WORLD_POINTS.npc.z, ry: 0 };
const DONE = { stage: 'completed', equipped: true, windows: [12, 12, 12, 12], carryingMannequin: false, mannequinDelivered: true };
const DRILL = { stage: 'fire_drill', equipped: true, windows: [12, 5, 0, 0], carryingMannequin: false, mannequinDelivered: false };

/** Записывает состояние задания напрямую в базу, как если бы игрок дошёл до него раньше. */
function seedTask(dbPath, name, state) {
  const db = openDb(dbPath);
  db.saveTaskProgress(db.findUserByName(name).id, TASK_ID, { state, done: state.stage === 'completed' });
  db.close();
}

function readTask(dbPath, name) {
  const db = openDb(dbPath);
  const saved = db.getTaskProgress(db.findUserByName(name).id, TASK_ID);
  db.close();
  return saved;
}

function readMemory(dbPath, name) {
  const db = openDb(dbPath);
  const memory = db.getAgentMemory(db.findUserByName(name).id, 'marusya');
  db.close();
  return memory;
}

/** Ответы подменной модели по очереди: i-й запрос получает replies[i] (последний повторяется). */
const scripted = (replies) => (req, res) => {
  const n = Math.min(scriptedCount.get(req.socket.server) ?? 0, replies.length - 1);
  scriptedCount.set(req.socket.server, (scriptedCount.get(req.socket.server) ?? 0) + 1);
  res.writeHead(200);
  for (const word of replies[n].split(' ')) res.write(ndjsonLine(`${word} `));
  res.end(ndjsonLine('', true));
};
const scriptedCount = new WeakMap();

/** Сценарий preview для вкладки: те же createTaskSync и createMarusyaChat, что в client/stations/firefighter/preview.js. */
function station(tab, storage = fakeStorage()) {
  const flow = { current: null, storage };
  const sync = createTaskSync({ api: tab.api, onState: () => {}, onNotice: (text) => { flow.notice = text; } });
  Object.assign(flow, {
    sync,
    notice: '',
    marusya: createMarusyaChat({
      chat: tab.chat,
      getState: () => sync.state,
      dispatch: (action, handlers) => sync.send(action, handlers),
      isOnline: () => true,
      getNotice: () => flow.notice,
      storage, // память вкладки: общая у «перезагруженной» страницы, пустая у новой вкладки
    }),
    button: (label) => tab.chat.state.assist.actions.find((a) => a.label === label),
    /** Нажатие на кнопку панели и ожидание подтверждения сервера. */
    async press(label) {
      const before = sync.state.stage;
      const action = flow.button(label);
      assert.ok(action, `кнопки «${label}» нет: ${tab.chat.state.assist.actions.map((a) => a.label)}`);
      tab.chat.choose(action);
      await tab.until(() => sync.state.stage !== before || flow.notice, 2000).catch(() => {});
    },
  });
  return flow;
}

const systemOf = (request) => request.body.messages[0].content;
const settled = (n) => (st) => st.status === 'idle' && st.messages.length >= n && st.messages.at(-1).from === 'npc' && !st.messages.at(-1).pending;

test('Маруся: первая реплика приходит от ИИ-провайдера и несёт ход задания с сервера', async () => {
  const ollama = await fakeOllama(scripted(['Привет, я Маруся! Рада видеть тебя на станции.']));
  const s = await setup({ ollama, withDb: true });
  try {
    const t = s.tab();
    await t.join('Аня', { beforeConnect: () => seedPlayerState(s.dbPath, 'Аня', nearMarusya) });
    await sleep(100);
    const st = station(t);
    assert.equal(st.marusya.open(), true);
    assert.equal(t.chat.state.open, true);

    await t.until(settled(2));
    const [me, npc] = t.chat.state.messages;
    assert.equal(me.text, SAY.hello, 'игрок сам здоровается');
    assert.equal(npc.text.trim(), 'Привет, я Маруся! Рада видеть тебя на станции.', 'текст ответа — из подменной модели, не из клиента');
    assert.equal(ollama.requests.length, 1, 'ровно один запрос npc_talk к модели');
    const system = systemOf(ollama.requests[0]);
    assert.match(system, /Маруся Громова/);
    assert.match(system, /Этап: знакомство\./);
    assert.match(system, /ещё не начата/);
    assert.match(system, /первая встреча/);
    assert.match(system, /выполняет только игрок/);
    assert.equal(ollama.requests[0].body.messages.at(-1).content, SAY.hello);
  } finally {
    await s.stop();
  }
});

test('Маруся: контекст следует за подтверждённым сервером прогрессом; подделка в task_answer на него не влияет', async () => {
  const ollama = await fakeOllama(scripted(['Привет, я Маруся! Рада видеть тебя на станции.', 'Отлично, начинаем. Сначала внимательно выслушай инструктаж.', 'Хороший вопрос про экипировку.']));
  const s = await setup({ ollama, withDb: true });
  try {
    const t = s.tab();
    await t.join('Аня', { beforeConnect: () => seedPlayerState(s.dbPath, 'Аня', nearMarusya) });
    await sleep(100);
    const st = station(t);
    st.marusya.open();
    await t.until(settled(2));

    await st.press('Начать тренировку');
    assert.equal(st.sync.state.stage, 'briefing', 'этап подтвердил сервер');
    await t.until(settled(4)); // после подтверждения игрок просит рассказать о тренировке
    assert.equal(t.chat.state.messages[2].text, SAY.afterStart);
    const second = ollama.requests[1];
    assert.match(systemOf(second), /Этап: инструктаж\./);
    assert.match(systemOf(second), /слушает твой инструктаж/);
    assert.match(systemOf(second), /уже разговаривали/);
    assert.doesNotMatch(systemOf(second), /первая встреча/);
    assert.match(systemOf(second), /Ты уже рассказывала: Привет, я Маруся! Рада видеть тебя/);
    assert.match(systemOf(second), /тогда был этап «знакомство», теперь «инструктаж»/);

    // Клиент пытается «подарить» себе завершённую смену: сервер игнорирует и состояние, и этап.
    t.net.send({ t: 'task_answer', taskId: TASK_ID, payload: { action: 'resume', state: DONE, stage: 'completed' } });
    await sleep(80);
    t.chat.send('Зачем нужна экипировка?');
    await t.until(settled(6));
    const third = systemOf(ollama.requests[2]);
    assert.match(third, /Этап: инструктаж\./);
    assert.doesNotMatch(third, /полностью завершена/);
    assert.equal(readTask(s.dbPath, 'Аня').state.stage, 'briefing');
  } finally {
    await s.stop();
  }
});

test('Маруся: после перезагрузки страницы разговор продолжается с памятью, а не начинается заново', async () => {
  const ollama = await fakeOllama(scripted(['Привет, я Маруся! Рада видеть тебя на станции.', 'Экипировка защищает пожарного от жара и осколков, поэтому её проверяют до смены.', 'Продолжим с того места, где остановились.']));
  const s = await setup({ ollama, withDb: true });
  try {
    const first = s.tab();
    await first.join('Аня', { beforeConnect: () => seedPlayerState(s.dbPath, 'Аня', nearMarusya) });
    await sleep(100);
    const st = station(first);
    st.marusya.open();
    await first.until(settled(2));
    first.chat.send('Зачем нужна экипировка?');
    await first.until(settled(4));
    st.sync.dispose();
    first.close();

    const reloaded = s.tab();
    let attempt = 0;
    for (;;) {
      try {
        await reloaded.join('Аня');
        break;
      } catch (err) {
        if (++attempt > 40 || err.code !== 'name_taken') throw err;
        await sleep(25);
      }
    }
    await sleep(100);
    const again = station(reloaded);
    assert.deepEqual(reloaded.chat.state.messages, []);
    again.marusya.open(); // новая страница: игрок снова подошёл к Марусе
    await reloaded.until(settled(2));

    const system = systemOf(ollama.requests.at(-1));
    assert.doesNotMatch(system, /первая встреча/, 'встреча не первая');
    assert.match(system, /не представляйся заново/);
    assert.match(system, /можно коротко ответить на приветствие/);
    assert.match(system, /Ты уже рассказывала: Привет, я Маруся! Рада видеть тебя на станции\. Экипировка защищает пожарного от жара/);
    const sentMessages = ollama.requests.at(-1).body.messages;
    assert.ok(sentMessages.some((m) => m.role === 'user' && m.content === 'Зачем нужна экипировка?'), 'прошлые реплики на месте');
    assert.ok(sentMessages.some((m) => m.role === 'assistant' && m.content.includes('защищает пожарного')));
    assert.equal(reloaded.chat.state.messages[1].text.trim(), 'Продолжим с того места, где остановились.');
  } finally {
    await s.stop();
  }
});

test('Маруся: память и запрос к модели ограничены по размеру при долгом разговоре', async () => {
  // Ответы разные по словам (одинаковые защита от повторов отклонила бы), но длинные: по 17 предложений из 6 слов.
  const alphabet = 'абвгдежзиклмнопрстуфхцчшэюя';
  const letter = (n) => alphabet[n % alphabet.length];
  const word = (i, j) => [i, j, i + j, i * 3 + j, j * 5 + i].map(letter).join('');
  const long = Array.from({ length: 20 }, (_, i) =>
    Array.from({ length: 17 }, (_, s) => `${Array.from({ length: 6 }, (_, w) => word(i + 1, s * 6 + w + 1)).join(' ')}.`).join(' '));
  const ollama = await fakeOllama(scripted(long));
  const s = await setup({ ollama, withDb: true });
  try {
    const t = s.tab();
    await t.join('Аня', { beforeConnect: () => seedPlayerState(s.dbPath, 'Аня', nearMarusya) });
    await sleep(100);
    for (let i = 0; i < 20; i++) {
      assert.equal(t.chat.send(`Вопрос номер ${i}`) || (t.chat.open(MARUSYA), t.chat.send(`Вопрос номер ${i}`)), true);
      await t.until((st) => st.status === 'idle');
    }
    const memory = readMemory(s.dbPath, 'Аня');
    assert.ok(memory.turns.length <= 12, `реплик в памяти: ${memory.turns.length}`);
    assert.ok(memory.topics.dialogue.notes.length <= 8);
    assert.ok(memory.topics.dialogue.notes.every((n) => n.length <= 110));
    assert.equal(memory.topics.dialogue.exchanges, 20);
    const last = ollama.requests.at(-1).body.messages;
    const chars = last.reduce((sum, m) => sum + m.content.length, 0);
    assert.ok(last.length <= 10, `сообщений в запросе: ${last.length}`);
    assert.ok(chars < 7000, `символов в запросе: ${chars}`);
  } finally {
    await s.stop();
  }
});

test('Маруся: после завершения предлагаются подробности и повтор; повтор идёт только по нажатию и после подтверждения сервера', async () => {
  const ollama = await fakeOllama(scripted(['Поздравляю, ты прошёл всю смену. Хочешь узнать больше о профессии или повторить тренировку?', 'Тогда начнём заново: сначала короткий инструктаж.']));
  const s = await setup({ ollama, withDb: true });
  try {
    const t = s.tab();
    const st = station(t); // как в preview: слушатель task_state создаётся до входа
    await t.join('Аня', { beforeConnect: () => { seedPlayerState(s.dbPath, 'Аня', nearMarusya); seedTask(s.dbPath, 'Аня', DONE); } });
    await sleep(100);
    assert.equal(st.sync.state.stage, 'completed');
    st.marusya.open();
    await t.until(settled(2));
    assert.match(systemOf(ollama.requests[0]), /полностью завершена/);
    assert.match(systemOf(ollama.requests[0]), /Повторить смену/);
    assert.deepEqual(t.chat.state.assist.actions.map((a) => a.label), ['Узнать больше о профессии', 'Повторить учебную смену']);

    // Модель предложила повтор, но сама ничего не запускает: этап остаётся прежним.
    await sleep(150);
    assert.equal(readTask(s.dbPath, 'Аня').state.stage, 'completed');
    assert.equal(readTask(s.dbPath, 'Аня').done, true);

    await st.press('Повторить учебную смену');
    assert.equal(st.sync.state.stage, 'briefing', 'сервер подтвердил новую смену');
    assert.deepEqual(readTask(s.dbPath, 'Аня').state, { stage: 'briefing', equipped: false, windows: [0, 0, 0, 0], carryingMannequin: false, mannequinDelivered: false });
    assert.equal(readTask(s.dbPath, 'Аня').done, false);
    await t.until(settled(4));
    assert.equal(t.chat.state.messages[2].text, SAY.afterRepeat);
    const second = systemOf(ollama.requests[1]);
    assert.match(second, /Этап: инструктаж\./);
    assert.match(second, /тогда был этап «смена завершена», теперь «инструктаж»/);
    assert.match(second, /Ты уже рассказывала: Поздравляю, ты прошёл всю смену/);
  } finally {
    await s.stop();
  }
});

test('Маруся: незавершённую смену повторным запросом сбросить нельзя', async () => {
  const ollama = await fakeOllama(scripted(['Ты на полигоне, продолжай.']));
  const s = await setup({ ollama, withDb: true });
  try {
    const t = s.tab();
    const st = station(t);
    await t.join('Борис', { beforeConnect: () => { seedPlayerState(s.dbPath, 'Борис', nearMarusya); seedTask(s.dbPath, 'Борис', DRILL); } });
    await sleep(100);
    assert.equal(st.sync.state.stage, 'fire_drill');
    assert.equal(st.button?.('Повторить учебную смену'), undefined);

    // Даже если клиент пошлёт repeat напрямую, сервер откажет и не тронет прогресс.
    const rejected = new Promise((resolve) => st.sync.send('repeat', { onRejected: resolve, onConfirmed: () => resolve('confirmed') }));
    assert.notEqual(await rejected, 'confirmed');
    assert.equal(st.sync.state.stage, 'fire_drill');
    assert.match(st.notice, /только после её завершения/);
    assert.deepEqual(readTask(s.dbPath, 'Борис').state, DRILL);
    assert.equal(readTask(s.dbPath, 'Борис').done, false);
  } finally {
    await s.stop();
  }
});

test('Маруся: ошибка Ollama видна игроку, ответ не подменяется готовым текстом, игра идёт дальше и реплику можно повторить', async () => {
  let down = true;
  const ollama = await fakeOllama((req, res, rec) => {
    if (down) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end('{"error":"boom"}');
      return;
    }
    return tokensHandler(['Теперь я на связи. Начинаем инструктаж.'])(req, res, rec);
  });
  const s = await setup({ ollama, withDb: true });
  try {
    const t = s.tab();
    await t.join('Аня', { beforeConnect: () => seedPlayerState(s.dbPath, 'Аня', nearMarusya) });
    await sleep(100);
    const st = station(t);
    st.marusya.open();
    await t.until((state) => state.status === 'idle' && state.error);
    assert.ok(t.chat.state.error.length > 0, 'причина показана игроку');
    assert.deepEqual(t.chat.state.messages.map((m) => m.from), ['me'], 'ответа Маруси нет: ни от ИИ, ни заготовленного');
    assert.equal(t.chat.canSend, true);

    // Игровое действие работает без ИИ: его подтверждает сервер, а не модель.
    await st.press('Начать тренировку');
    assert.equal(st.sync.state.stage, 'briefing');
    await t.until((state) => state.status === 'idle' && state.messages.length === 2);
    assert.deepEqual(t.chat.state.messages.map((m) => m.from), ['me', 'me'], 'ошибка и на втором запросе: ответов нет');
    assert.ok(t.chat.state.error);

    down = false;
    assert.equal(t.chat.send('Попробуем ещё раз'), true);
    await t.until(settled(3));
    assert.equal(t.chat.state.error, '');
    assert.equal(t.chat.state.messages.at(-1).text.trim(), 'Теперь я на связи. Начинаем инструктаж.');
    assert.equal(readMemory(s.dbPath, 'Аня').topics.dialogue.exchanges, 1, 'неудачные обмены в память не попали');
  } finally {
    await s.stop();
  }
});

// ---- защита от повторов: путь от модели до панели игрока ----

const GREETING = 'Привет, Аня! Рада видеть тебя на станции.';
const tokensOf = (tab) => tab.events.filter((m) => m.t === 'agent_token').map((m) => m.token).join('');

test('Маруся: повторное приветствие модели не доходит до игрока при новом подходе, на новом этапе, после перезагрузки и в новой вкладке', async () => {
  // Модель упорно начинает с приветствия; без приветствия отвечает только после просьбы ответить иначе.
  const plain = ['Сегодня говорим про порядок тренировки: сначала экипировка, потом окна.', 'Теперь про рукав: держи его двумя руками и не заходи за линию.', 'Ещё напомню про линию безопасности перед стеной.'];
  let plainIndex = 0;
  const ollama = await fakeOllama((req, res, rec) => {
    const retry = /повторял то, что ты уже говорила/.test(rec.body.messages[0].content);
    const text = retry ? plain[Math.min(plainIndex++, plain.length - 1)] : `${GREETING} Начнём, когда будешь готова.`;
    return tokensHandler(text.match(/\S+\s*/g))(req, res, rec);
  });
  const s = await setup({ ollama, withDb: true });
  try {
    const storage = fakeStorage();
    const first = s.tab();
    const st = station(first, storage);
    await first.join('Аня', { beforeConnect: () => seedPlayerState(s.dbPath, 'Аня', nearMarusya) });
    await sleep(100);

    st.marusya.open(); // первая встреча: приветствие здесь уместно
    await first.until(settled(2));
    assert.match(first.chat.state.messages[1].text, /^Привет, Аня!/);
    assert.equal(ollama.requests.length, 1);

    // закрыли панель, отошли, подошли снова: ничего не отправляется
    first.chat.close();
    st.marusya.open();
    first.chat.close();
    st.marusya.open();
    await sleep(100);
    assert.equal(ollama.requests.length, 1, 'повторное открытие не вызывает запрос');

    // новый этап: игрок нажимает действие, модель снова хочет поздороваться
    await st.press('Начать тренировку');
    await first.until(settled(4));
    const answer = first.chat.state.messages[3].text;
    assert.doesNotMatch(answer, /Привет/, 'повторное приветствие не показано');
    assert.match(answer, /порядок тренировки/);
    assert.equal(ollama.requests.length, 3, 'первый ответ и один запрос с перегенерацией');
    assert.equal(tokensOf(first).split('Привет').length - 1, 1, 'за всё время приветствие пришло по сети один раз');

    // перезагрузка во вкладке: хранилище вкладки то же, этап тот же — клиент молчит
    st.sync.dispose();
    first.close();
    const reloaded = s.tab();
    let attempt = 0;
    const again = station(reloaded, storage);
    for (;;) {
      try {
        await reloaded.join('Аня');
        break;
      } catch (err) {
        if (++attempt > 40 || err.code !== 'name_taken') throw err;
        await sleep(25);
      }
    }
    await sleep(100);
    const before = ollama.requests.length;
    again.marusya.open();
    await sleep(100);
    assert.equal(ollama.requests.length, before, 'после перезагрузки на том же этапе запроса нет');
    assert.equal(again.sync.state.stage, 'briefing');

    // другое устройство: клиент ничего не помнит и отправляет приветствие, но сервер помнит историю
    const other = s.tab();
    const otherStation = station(other);
    reloaded.close();
    attempt = 0;
    for (;;) {
      try {
        await other.join('Аня');
        break;
      } catch (err) {
        if (++attempt > 40 || err.code !== 'name_taken') throw err;
        await sleep(25);
      }
    }
    await sleep(100);
    otherStation.marusya.open();
    await other.until(settled(2));
    assert.equal(other.chat.state.messages[0].text, SAY.hello);
    assert.doesNotMatch(other.chat.state.messages[1].text, /Привет/, 'сервер не пустил повторное приветствие');
    assert.doesNotMatch(tokensOf(other), /Привет/, 'и по сети оно не приходило');
    assert.ok(readMemory(s.dbPath, 'Аня').topics.dialogue.exchanges >= 3);
  } finally {
    await s.stop();
  }
});

test('Маруся: если модель повторяет сказанное даже после перегенераций, игрок видит ошибку без повтора и может спросить снова', async () => {
  const said = 'Экипировка защищает пожарного от жара и осколков, поэтому её проверяют до смены.';
  let fresh = false;
  const ollama = await fakeOllama((req, res, rec) =>
    tokensHandler((fresh ? 'Ещё рация связывает пожарных во время учений и помогает им не терять друг друга.' : said).match(/\S+\s*/g))(req, res, rec));
  const s = await setup({ ollama, withDb: true });
  try {
    const t = s.tab();
    await t.join('Аня', { beforeConnect: () => seedPlayerState(s.dbPath, 'Аня', nearMarusya) });
    await sleep(100);
    t.chat.open(MARUSYA);
    t.chat.send('Зачем экипировка?');
    await t.until(settled(2));
    assert.equal(t.chat.state.messages[1].text.trim(), said);

    const tokensBefore = tokensOf(t);
    t.chat.send('Расскажи ещё про экипировку');
    await t.until((st) => st.status === 'idle' && st.error);
    assert.match(t.chat.state.error, /повторился/);
    assert.deepEqual(t.chat.state.messages.map((m) => m.from), ['me', 'npc', 'me'], 'ответа на вторую реплику нет, повтор не показан');
    assert.equal(tokensOf(t), tokensBefore, 'токены повтора по сети не уходили');
    assert.equal(ollama.requests.length, 4, 'первый ответ и три попытки на втором');
    assert.equal(t.chat.canSend, true);

    fresh = true;
    t.chat.send('Расскажи ещё про экипировку');
    await t.until(settled(5));
    assert.equal(t.chat.state.error, '');
    assert.match(t.chat.state.messages.at(-1).text, /^Ещё рация/);
    assert.equal(readMemory(s.dbPath, 'Аня').topics.dialogue.exchanges, 2, 'неудачная попытка в память не попала');
  } finally {
    await s.stop();
  }
});

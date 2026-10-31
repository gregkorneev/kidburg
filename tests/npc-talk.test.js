import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db/index.js';
import { TestClient, getTicket, listen, register, tempWorld } from './helpers.js';
import { closedPort, fakeOllama, hangingHandler, ndjsonLine, tokensHandler } from './ollama-fake.js';

// В фикстурах therapist стоит ровно в TALK_DISTANCE от точки возрождения, nurse — чуть дальше.
const talk = (agentId, text, reqId = 'r1', extra = {}) => ({ t: 'npc_talk', agentId, text, reqId, ...extra });
const isAgentMsg = (m) => m.t.startsWith('agent_');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Сервер с миром, базой и настройками агентов; игроки подключаются через join(). */
async function setup({ ollama, agents = {}, ...overrides } = {}) {
  const world = tempWorld();
  const db = openDb(':memory:');
  const { app, port } = await listen({
    worldDir: world.worldDir,
    db,
    npcTalkPerSec: 100,
    agents: { baseUrl: ollama?.url ?? 'http://127.0.0.1:1', model: 'test-model', ...agents },
    ...overrides,
  });
  const clients = [];
  return {
    app,
    db,
    async join(name) {
      const { token, user } = await register(app, name);
      const client = await TestClient.connect(port, await getTicket(app, token));
      client.send({ t: 'hello', ticket: 'x', proto: 1 });
      await client.nextOfType('welcome');
      clients.push(client);
      return { client, user };
    },
    async stop() {
      for (const c of clients) c.ws.terminate();
      await app.close();
      world.cleanup();
      await ollama?.close();
    },
  };
}

/** Читает сообщения agent_* одного запроса до agent_done или agent_error. */
async function readAnswer(client, reqId = 'r1') {
  const msgs = [];
  for (;;) {
    const m = await client.next((x) => isAgentMsg(x) && x.reqId === reqId);
    msgs.push(m);
    if (m.t === 'agent_done' || m.t === 'agent_error') return msgs;
  }
}

test('npc_talk: токены идут потоком, затем agent_done; чужой клиент ничего не получает', async () => {
  const ollama = await fakeOllama(tokensHandler(['Здрав', 'ствуйте', ', юный коллега']));
  const s = await setup({ ollama });
  try {
    const { client: anna } = await s.join('Аня');
    const { client: boris } = await s.join('Борис');
    anna.send(talk('therapist', 'Расскажите о вашей работе'));
    const msgs = await readAnswer(anna);
    assert.deepEqual(
      msgs.map((m) => m.t),
      ['agent_token', 'agent_token', 'agent_token', 'agent_done'],
    );
    assert.equal(msgs.slice(0, 3).map((m) => m.token).join(''), 'Здравствуйте, юный коллега');
    assert.ok(msgs.every((m) => m.agentId === 'therapist' && m.reqId === 'r1'));
    await wait(100);
    assert.equal(boris.inbox.filter(isAgentMsg).length, 0, 'диалог не рассылается другим игрокам');
  } finally {
    await s.stop();
  }
});

test('npc_talk: имя и личность берутся из соединения, а не из payload клиента', async () => {
  const ollama = await fakeOllama(tokensHandler(['ок']));
  const s = await setup({ ollama });
  try {
    const { client, user } = await s.join('Аня');
    client.send(talk('therapist', 'Привет', 'r1', { userId: 999, playerName: 'Хакер', x: 0, z: 0, context: { playerName: 'Хакер' } }));
    await readAnswer(client);
    const system = ollama.requests[0].body.messages[0].content;
    assert.match(system, /Собеседника зовут Аня/);
    assert.ok(!system.includes('Хакер'));
    assert.equal(s.db.getAgentMemory(user.id, 'therapist').turns.length, 2);
    assert.equal(s.db.getAgentMemory(999, 'therapist'), null);
  } finally {
    await s.stop();
  }
});

test('npc_talk: память разных игроков не смешивается', async () => {
  const ollama = await fakeOllama(tokensHandler(['ок']));
  const s = await setup({ ollama });
  try {
    const { client: anna } = await s.join('Аня');
    const { client: boris } = await s.join('Борис');
    anna.send(talk('therapist', 'Мой секретный код ананас'));
    await readAnswer(anna);
    boris.send(talk('therapist', 'Что я говорил раньше?'));
    await readAnswer(boris);
    const forBoris = JSON.stringify(ollama.requests[1].body.messages);
    assert.ok(!forBoris.includes('ананас'));
    // а вторая реплика Ани видит свою историю
    anna.send(talk('therapist', 'Помнишь меня?', 'r2'));
    await readAnswer(anna, 'r2');
    assert.ok(JSON.stringify(ollama.requests[2].body.messages).includes('ананас'));
  } finally {
    await s.stop();
  }
});

test('npc_talk: Ollama не запущена -> agent_error, сервер продолжает работать', async () => {
  const port = await closedPort();
  const s = await setup({ agents: { baseUrl: `http://127.0.0.1:${port}` } });
  try {
    const { client } = await s.join('Аня');
    client.send(talk('therapist', 'Привет'));
    const [err] = await readAnswer(client);
    assert.equal(err.t, 'agent_error');
    assert.match(err.message, /недоступна/);
    client.send(talk('therapist', 'Ещё раз', 'r2'));
    assert.equal((await readAnswer(client, 'r2'))[0].t, 'agent_error');
    const health = await s.app.inject({ method: 'GET', url: '/health' });
    assert.equal(health.statusCode, 200);
  } finally {
    await s.stop();
  }
});

test('npc_talk: HTTP-ошибка, отсутствующая модель, пустой и битый поток -> agent_error', async () => {
  const modes = {
    http: (req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end('{"error":"сбой"}');
    },
    missing: (req, res) => {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"error":"model \'test-model\' not found"}');
    },
    empty: tokensHandler([]),
    blank: tokensHandler(['', '']),
    malformed: (req, res) => {
      res.writeHead(200);
      res.end(ndjsonLine('Начало') + '{не json\n');
    },
    truncated: (req, res) => {
      res.writeHead(200);
      res.end(ndjsonLine('Начало'));
    },
  };
  let mode = 'http';
  const ollama = await fakeOllama((req, res, rec) => modes[mode](req, res, rec));
  const s = await setup({ ollama });
  try {
    const { client } = await s.join('Аня');
    const messages = {};
    let n = 0;
    for (const m of Object.keys(modes)) {
      mode = m;
      const reqId = `m${n++}`;
      client.send(talk('therapist', 'Привет', reqId));
      messages[m] = await readAnswer(client, reqId);
    }
    for (const [m, msgs] of Object.entries(messages)) {
      assert.equal(msgs.at(-1).t, 'agent_error', `${m}: последним должен быть agent_error`);
      assert.ok(!msgs.some((x) => x.t === 'agent_done'), `${m}: agent_done не должно быть`);
    }
    assert.match(messages.missing[0].message, /test-model/);
    assert.match(messages.empty[0].message, /промолчал|пуст/i);
    assert.equal(messages.malformed[0].t, 'agent_token', 'уже отправленное не отзывается');
    assert.equal(s.db.getAgentMemory(1, 'therapist'), null, 'неудачные ответы не попадают в память');
  } finally {
    await s.stop();
  }
});

test('npc_talk: без OLLAMA_MODEL клиент получает понятную ошибку', async () => {
  const s = await setup({ agents: { model: '' } });
  try {
    const { client } = await s.join('Аня');
    client.send(talk('therapist', 'Привет'));
    const [err] = await readAnswer(client);
    assert.equal(err.t, 'agent_error');
    assert.match(err.message, /OLLAMA_MODEL/);
  } finally {
    await s.stop();
  }
});

test('npc_talk: слишком длинный текст, пустой текст, неизвестный agentId, длинный reqId', async () => {
  const ollama = await fakeOllama(tokensHandler(['ок']));
  const s = await setup({ ollama, npcTalkMaxChars: 50 });
  try {
    const { client } = await s.join('Аня');
    client.send(talk('therapist', 'а'.repeat(51), 'long'));
    const [tooLong] = await readAnswer(client, 'long');
    assert.equal(tooLong.t, 'agent_error');
    assert.match(tooLong.message, /50/);

    client.send(talk('therapist', ' \n\t ', 'blank'));
    assert.match((await readAnswer(client, 'blank'))[0].message, /Пустая/);

    client.send(talk('wizard', 'Привет', 'unk'));
    assert.match((await readAnswer(client, 'unk'))[0].message, /Неизвестный собеседник/);

    client.send(talk('therapist', 'Привет', 'x'.repeat(65)));
    assert.equal((await client.nextOfType('error')).code, 'bad_msg');

    client.send({ t: 'npc_talk', agentId: 'therapist', reqId: 'z' }); // нет text: отсекает общая схема
    assert.equal((await client.nextOfType('error')).code, 'bad_msg');
    assert.equal(ollama.requests.length, 0, 'ни одна отклонённая реплика не дошла до Ollama');
  } finally {
    await s.stop();
  }
});

test('npc_talk: слишком частые запросы -> rate_limit и agent_error', async () => {
  const ollama = await fakeOllama(tokensHandler(['ок']));
  const s = await setup({ ollama, npcTalkPerSec: 1 });
  try {
    const { client } = await s.join('Аня');
    client.send(talk('therapist', 'раз', 'a'));
    client.send(talk('therapist', 'два', 'b'));
    assert.equal((await client.nextOfType('error')).code, 'rate_limit');
    const second = await readAnswer(client, 'b');
    assert.equal(second[0].t, 'agent_error');
    assert.equal((await readAnswer(client, 'a')).at(-1).t, 'agent_done');
    assert.equal(ollama.requests.length, 1);
  } finally {
    await s.stop();
  }
});

test('npc_talk: вне радиуса NPC -> too_far и agent_error, Ollama не вызывается', async () => {
  const ollama = await fakeOllama(tokensHandler(['ок']));
  const s = await setup({ ollama });
  try {
    const { client } = await s.join('Аня');
    client.send(talk('nurse', 'Привет', 'far')); // медсестра дальше TALK_DISTANCE
    assert.equal((await client.nextOfType('error')).code, 'too_far');
    assert.equal((await readAnswer(client, 'far'))[0].t, 'agent_error');
    assert.equal(ollama.requests.length, 0);
    client.send(talk('therapist', 'Привет', 'near'));
    assert.equal((await readAnswer(client, 'near')).at(-1).t, 'agent_done');
  } finally {
    await s.stop();
  }
});

test('npc_talk: пока идёт ответ, вторая реплика того же игрока отклоняется', async () => {
  const ollama = await fakeOllama(hangingHandler());
  const s = await setup({ ollama });
  try {
    const { client } = await s.join('Аня');
    client.send(talk('therapist', 'раз', 'a'));
    await client.next((m) => m.t === 'agent_token');
    client.send(talk('therapist', 'два', 'b'));
    const [busy] = await readAnswer(client, 'b');
    assert.equal(busy.t, 'agent_error');
    assert.equal(ollama.requests.length, 1);
  } finally {
    await s.stop();
  }
});

test('npc_talk: отключение клиента обрывает запрос к Ollama и освобождает слот', async () => {
  const ollama = await fakeOllama(hangingHandler());
  const s = await setup({ ollama, agents: { maxConcurrent: 1 } });
  try {
    const { client } = await s.join('Аня');
    client.send(talk('therapist', 'раз'));
    await client.next((m) => m.t === 'agent_token');
    await client.close();
    const rec = await Promise.race([
      ollama.requests[0].finished,
      wait(2000).then(() => assert.fail('соединение с Ollama не оборвано после ухода клиента')),
    ]);
    assert.equal(rec.aborted, true);

    // слот свободен: следующий игрок получает ответ, а не очередь
    ollama.requests.length = 0;
    const { client: boris } = await s.join('Борис');
    boris.send(talk('therapist', 'привет'));
    await boris.next((m) => m.t === 'agent_token');
    assert.equal(boris.inbox.filter((m) => m.t === 'agent_queue').length, 0);
  } finally {
    await s.stop();
  }
});

test('npc_talk: agent_queue приходит только ждущему игроку', async () => {
  const gate = Promise.withResolvers();
  const ollama = await fakeOllama(async (req, res) => {
    res.writeHead(200);
    await gate.promise;
    res.write(ndjsonLine('ок'));
    res.end(ndjsonLine('', true));
  });
  const s = await setup({ ollama, agents: { maxConcurrent: 1 } });
  try {
    const { client: anna } = await s.join('Аня');
    const { client: boris } = await s.join('Борис');
    anna.send(talk('therapist', 'раз', 'a'));
    await wait(50);
    boris.send(talk('therapist', 'два', 'b'));
    const queued = await boris.nextOfType('agent_queue');
    assert.deepEqual([queued.agentId, queued.reqId, queued.position], ['therapist', 'b', 1]);
    assert.equal(anna.inbox.filter((m) => m.t === 'agent_queue').length, 0);
    gate.resolve();
    assert.equal((await readAnswer(anna, 'a')).at(-1).t, 'agent_done');
    assert.equal((await readAnswer(boris, 'b')).at(-1).t, 'agent_done');
  } finally {
    await s.stop();
  }
});

test('новый код и конфигурация не содержат внешних URL', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(path.join(root, 'server', 'agents'));
  files.push(path.join(root, 'server', 'net', 'game.js'), path.join(root, 'server', 'index.js'));
  const external = /https?:\/\/(?!127\.0\.0\.1|localhost|\[::1\])[^\s'"`)]+/g;
  for (const file of files) {
    const hits = readFileSync(file, 'utf8').match(external) ?? [];
    assert.deepEqual(hits, [], `${path.relative(root, file)}: внешние адреса`);
  }
});

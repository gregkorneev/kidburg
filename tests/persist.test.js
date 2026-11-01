import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openDb } from '../server/db/index.js';
import { SPAWN } from '../shared/constants.js';
import { TestClient, getTicket, joinGame, listen, readPlayerState, register, tempDb } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pos = (x, z, seq = 1) => ({ t: 'pos', x, y: 0, z, ry: 0.5, anim: 1, seq });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** База, которая запоминает пакетные записи позиций. */
function spyDb(file = ':memory:') {
  const real = openDb(file);
  const batches = [];
  let singles = 0;
  return {
    db: {
      ...real,
      savePlayerStates(rows) {
        batches.push(rows);
        return real.savePlayerStates(rows);
      },
      savePlayerState(row) {
        singles++;
        return real.savePlayerState(row);
      },
    },
    batches,
    get singles() {
      return singles;
    },
  };
}

test('изменённая позиция сбрасывается раз в flushMs, неизменённая не пишется', async () => {
  const spy = spyDb();
  const { app, port } = await listen({ db: spy.db, flushMs: 60 });
  try {
    const { client, user } = await joinGame(app, port, 'Аня');
    await sleep(200);
    assert.equal(spy.batches.length, 0, 'игрок не двигался: записи нет');

    client.send(pos(SPAWN.x + 0.2, SPAWN.z, 1));
    await sleep(250);
    assert.equal(spy.batches.length, 1, 'позиция сброшена периодическим таймером');
    assert.deepEqual(
      spy.batches[0].map((r) => [r.userId, r.x, r.z, r.ry]),
      [[user.id, SPAWN.x + 0.2, SPAWN.z, 0.5]],
    );
    assert.equal(spy.db.getPlayerState(user.id).x, SPAWN.x + 0.2, 'сохранено до отключения и остановки');

    await sleep(250);
    assert.equal(spy.batches.length, 1, 'без новых движений повторной записи нет');
    await client.close();
    await sleep(100);
    assert.equal(spy.batches.length, 1, 'при отключении неизменённого игрока записи нет');
    assert.equal(spy.singles, 0, 'игровой цикл пишет только пачками');
  } finally {
    await app.close();
  }
});

test('грязные позиции нескольких игроков пишутся одной пачкой', async () => {
  const spy = spyDb();
  const { app, port } = await listen({ db: spy.db, flushMs: 3_600_000 });
  const a = await joinGame(app, port, 'Аня');
  const b = await joinGame(app, port, 'Борис');
  const idle = await joinGame(app, port, 'Тихий');
  a.client.send(pos(a.welcome.state.x + 0.1, a.welcome.state.z, 1));
  b.client.send(pos(b.welcome.state.x, b.welcome.state.z + 0.1, 1));
  await sleep(150);
  assert.equal(spy.batches.length, 0);
  await app.close();
  assert.equal(spy.batches.length, 1, 'одна транзакция на всех');
  assert.deepEqual(spy.batches[0].map((r) => r.userId).sort(), [a.user.id, b.user.id].sort());
  assert.ok(!spy.batches[0].some((r) => r.userId === idle.user.id));
});

test('отключение игрока сохраняет последнюю допустимую позицию', async () => {
  const { dbPath, cleanup } = tempDb();
  const { app, port } = await listen({ dbPath, flushMs: 3_600_000 });
  try {
    const { client } = await joinGame(app, port, 'Аня');
    client.send(pos(SPAWN.x + 0.3, SPAWN.z, 1));
    client.send(pos(SPAWN.x + 300, SPAWN.z, 2)); // недопустимый скачок отбрасывается
    await client.nextOfType('correct');
    await client.close();
    await sleep(100);
    const saved = readPlayerState(dbPath, 'Аня');
    assert.equal(saved.x, SPAWN.x + 0.3);
    assert.equal(saved.z, SPAWN.z);
  } finally {
    await app.close();
    cleanup();
  }
});

test('перезапуск сервера: игрок возвращается на последнее место', async () => {
  const { dbPath, cleanup } = tempDb();
  try {
    const first = await listen({ dbPath });
    const { client } = await joinGame(first.app, first.port, 'Аня');
    client.send(pos(SPAWN.x + 0.4, SPAWN.z - 0.2, 1));
    await sleep(100);
    await first.app.close(); // flushAll при остановке

    const second = await listen({ dbPath });
    try {
      // Код комнаты у второго запуска свой: вход идёт по нему.
      const login = await register(second.app, 'Аня');
      const again = await TestClient.connect(second.port, await getTicket(second.app, login.token));
      again.send({ t: 'hello', ticket: 'x', proto: 1 });
      const welcome = await again.nextOfType('welcome');
      assert.equal(welcome.state.x, SPAWN.x + 0.4);
      assert.equal(welcome.state.z, SPAWN.z - 0.2);
      assert.equal(welcome.state.ry, 0.5);
    } finally {
      await second.app.close();
    }
  } finally {
    cleanup();
  }
});

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`${signal}: сервер как процесс сбрасывает позиции через flushAll и выходит`, async () => {
    const { dbPath, cleanup } = tempDb();
    const port = await freePort();
    const child = spawn(process.execPath, ['server/index.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port), DB_PATH: dbPath, LOG_LEVEL: 'silent' },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    try {
      for (let i = 0; i < 100 && !(await fetch(`http://127.0.0.1:${port}/health`).then(() => true, () => false)); i++) {
        await sleep(50);
      }
      const room = /Код комнаты: ([A-Z]{4})\b/.exec(output)?.[1];
      assert.ok(room, `в выводе сервера нет кода комнаты: ${output}`);
      const reg = await fetch(`http://127.0.0.1:${port}/api/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Сигнал', room, appearance: { avatar: { skin: 0, clothes: 0, hair: 0, shoes: 0 } } }),
      }).then((r) => r.json());
      const { ticket } = await fetch(`http://127.0.0.1:${port}/api/ws-ticket`, {
        method: 'POST',
        headers: { authorization: `Bearer ${reg.token}` },
      }).then((r) => r.json());
      const client = await TestClient.connect(port, ticket);
      client.send({ t: 'hello', ticket: 'x', proto: 1 });
      await client.nextOfType('welcome');
      client.send(pos(SPAWN.x + 0.4, SPAWN.z, 1));
      await sleep(150);

      child.kill(signal);
      const [code] = await once(child, 'exit');
      assert.equal(code, 0);
      assert.equal(readPlayerState(dbPath, 'Сигнал').x, SPAWN.x + 0.4);
    } finally {
      child.kill('SIGKILL');
      cleanup();
    }
  });
}

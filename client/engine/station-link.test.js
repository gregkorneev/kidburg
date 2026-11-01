import test from 'node:test';
import assert from 'node:assert/strict';
import { POS_INTERVAL_MS, createStationLink } from './station-link.js';

function fakeClient() {
  const handlers = new Map();
  const sent = [];
  const api = {
    net: { status: 'open', send: (msg) => (sent.push(msg), true) },
    state: { me: null },
    on(type, fn) {
      handlers.set(type, [...(handlers.get(type) ?? []), fn]);
      return () => handlers.set(type, (handlers.get(type) ?? []).filter((h) => h !== fn));
    },
  };
  return {
    api,
    sent,
    started: 0,
    stopped: 0,
    start() { this.started += 1; },
    stop() { this.stopped += 1; },
    emit: (type, msg = {}) => (handlers.get(type) ?? []).forEach((fn) => fn(msg)),
  };
}

function setup(position = { x: 1, z: 2 }) {
  const client = fakeClient();
  let clock = 0;
  const chat = { disposed: 0, dispose() { this.disposed += 1; } };
  const changes = [];
  const timers = { fns: [], setInterval: (fn) => (timers.fns.push(fn), 1), clearInterval() { timers.fns.length = 0; } };
  const pos = { value: position };
  const link = createStationLink({
    stationId: 'bakery',
    client,
    mountChat: () => chat,
    timers,
    now: () => clock,
    getPosition: () => pos.value,
    setPosition: (next) => { pos.value = next; },
    onChange: () => changes.push(link.ready),
  });
  return { link, client, chat, changes, pos, timers, advance: (ms) => (clock += ms), tickTimer: () => timers.fns.forEach((fn) => fn()) };
}

const stations = (client) => client.sent.filter((m) => m.t.startsWith('station_'));

test('после welcome страница просит сессию станции; ready только после подтверждения сервера', () => {
  const { link, client, pos } = setup();
  assert.equal(link.ready, false);
  client.emit('welcome');
  assert.deepEqual(stations(client), [{ t: 'station_enter', stationId: 'bakery' }]);
  assert.equal(link.ready, false, 'пока сервер не ответил, разговора нет');
  client.emit('station_state', { stationId: 'bakery', ok: true, message: '' });
  assert.equal(link.ready, true);
  assert.deepEqual(pos.value, { x: 0, z: 4.25 }, 'после входа клиент принимает серверный spawn');
  assert.deepEqual(stations(client).at(-1), { t: 'station_pos', x: 0, z: 4.25 }, 'синхронизированный spawn сразу уходит на сервер');
});

test('отказ сервера оставляет станцию локальной и сохраняет причину', () => {
  const { link, client } = setup();
  client.emit('welcome');
  client.emit('station_state', { stationId: 'bakery', ok: false, message: 'Войдите через город' });
  assert.equal(link.ready, false);
  assert.equal(link.message, 'Войдите через город');
  client.emit('station_state', { stationId: 'florist', ok: true, message: '' });
  assert.equal(link.ready, false, 'ответ про другую станцию игнорируется');
});

test('позиция уходит не чаще интервала, при изменении, и heartbeat раз в секунду', () => {
  const { link, client, pos, advance, tickTimer } = setup();
  client.emit('welcome');
  client.emit('station_state', { stationId: 'bakery', ok: true, message: '' });
  const count = () => stations(client).filter((m) => m.t === 'station_pos').length;
  const base = count();
  tickTimer(); // позиция не менялась, прошло 0 мс
  assert.equal(count(), base);
  pos.value = { x: 1.5, z: 2 };
  advance(POS_INTERVAL_MS - 1);
  tickTimer();
  assert.equal(count(), base, 'слишком рано');
  advance(2);
  tickTimer();
  assert.equal(count(), base + 1);
  advance(500);
  tickTimer();
  assert.equal(count(), base + 1, 'без движения heartbeat ещё рано');
  advance(600);
  tickTimer();
  assert.equal(count(), base + 2, 'heartbeat');
  assert.equal(link.syncPosition(), true, 'принудительная отправка перед действием');
  assert.equal(count(), base + 3);
});

test('обрыв связи и выход из сессии снимают ready; позиция в закрытый сокет не шлётся', () => {
  const { link, client, pos, advance, tickTimer } = setup({ x: 6.2, z: 3.2 });
  client.emit('welcome');
  client.emit('station_state', { stationId: 'bakery', ok: true, message: '' });
  client.emit('status', { status: 'reconnecting' });
  assert.equal(link.ready, false);
  client.api.net.status = 'reconnecting';
  const before = client.sent.length;
  advance(5000);
  tickTimer();
  assert.equal(client.sent.length, before);
  client.api.net.status = 'open';
  client.emit('welcome'); // реконнект: новая сессия станции
  assert.deepEqual(stations(client).at(-1), { t: 'station_enter', stationId: 'bakery' });
  client.emit('station_state', { stationId: 'bakery', ok: true, message: '' });
  assert.deepEqual(pos.value, { x: 0, z: 4.25 }, 'локальная сцена возвращается на server spawn после переподключения');
  assert.deepEqual(stations(client).at(-1), { t: 'station_pos', x: 0, z: 4.25 }, 'первой после реконнекта отправляется подтверждённая позиция');
  client.emit('auth', null);
  assert.equal(link.ready, false);
});

test('dispose отправляет station_leave, освобождает чат и клиент', () => {
  const { link, client, chat } = setup();
  client.emit('welcome');
  client.emit('station_state', { stationId: 'bakery', ok: true, message: '' });
  link.dispose();
  assert.deepEqual(stations(client).at(-1), { t: 'station_leave' });
  assert.equal(chat.disposed, 1);
  assert.equal(client.stopped, 1);
  assert.equal(link.ready, false);
});

test('неизвестная станция — ошибка при создании', () => {
  assert.throws(() => createStationLink({ stationId: 'hospital', client: fakeClient(), mountChat: () => ({}), timers: { setInterval() {}, clearInterval() {} }, getPosition: () => null }), /Неизвестная станция/);
});

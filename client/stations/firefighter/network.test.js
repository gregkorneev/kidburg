import test from 'node:test';
import assert from 'node:assert/strict';
import { SPAWN } from '../../../shared/constants.js';
import { validate } from '../../../shared/protocol.js';
import { createEmitter } from '../../engine/emitter.js';
import { ORIGIN, START, connectFireNetwork, headingFromYaw, resolveStart, toLocal, toServer, yawFromHeading } from './network.js';

function setup({ walkable = () => true, sendOk = true } = {}) {
  const emitter = createEmitter();
  const sent = [];
  const api = {
    on: (type, handler) => emitter.on(type, handler),
    net: { send: (msg) => (sendOk ? (sent.push(msg), true) : false) },
  };
  const calls = [];
  let position = { x: 0, z: 0, heading: 0, anim: 0 };
  const world = {
    isWalkable: walkable,
    clearRemotePlayers: () => calls.push(['clear']),
    addRemotePlayer: (id, name, equipped) => calls.push(['add', id, name, equipped]),
    setRemotePlayerEquipment: (id, equipped) => calls.push(['equipment', id, equipped]),
    removeRemotePlayer: (id) => calls.push(['remove', id]),
    updateRemotePlayers: (list) => calls.push(['update', list]),
    setLocalPosition: (p) => {
      position = { ...position, ...p };
      calls.push(['local', p]);
    },
    localPosition: () => position,
  };
  let t = 0;
  const sessions = [];
  const network = connectFireNetwork({ api, world, now: () => t, onSession: (v) => sessions.push(v) });
  return { emitter, sent, calls, world, network, sessions, tick: (ms) => (t += ms) };
}

const welcome = (state) => ({ t: 'welcome', proto: 1, playerId: 1, name: 'a', state, consts: {} });

test('точка появления SPAWN совпадает со стартом preview', () => {
  assert.deepEqual(toLocal(SPAWN.x, SPAWN.z), { x: START.x, z: START.z });
  const back = toServer(3, -2);
  assert.deepEqual(toLocal(back.x, back.z), { x: 3, z: -2 });
  assert.ok(Math.abs(yawFromHeading(headingFromYaw(0.7)) - 0.7) < 1e-12);
  assert.equal(ORIGIN.x, SPAWN.x - START.x);
});

test('resolveStart: сохранённая точка, вне площадки и внутри препятствия', () => {
  const ok = () => true;
  const saved = toServer(5, -3);
  const r = resolveStart({ x: saved.x, z: saved.z, ry: 0.5 }, ok);
  assert.ok(Math.abs(r.x - 5) < 1e-9 && Math.abs(r.z + 3) < 1e-9);
  assert.equal(r.heading, 0.5 + Math.PI);
  const fallback = { x: START.x, z: START.z, heading: Math.PI };
  assert.deepEqual(resolveStart({ x: 5, z: 5, ry: 0 }, () => false), fallback);
  assert.deepEqual(resolveStart(null, ok), fallback);
});

test('welcome ставит игрока и открывает сессию один раз; повторный welcome не дублирует', () => {
  const { emitter, calls, sessions } = setup();
  emitter.emit('welcome', welcome({ x: SPAWN.x, y: 0, z: SPAWN.z, ry: 0 }));
  emitter.emit('welcome', welcome({ x: SPAWN.x, y: 0, z: SPAWN.z, ry: 0 }));
  assert.deepEqual(sessions, [true]);
  const local = calls.find((c) => c[0] === 'local');
  assert.deepEqual(local[1], { x: START.x, z: START.z, heading: Math.PI });
});

test('pos уходит только после welcome, в серверных координатах и проходит validate()', () => {
  const { emitter, sent, network, tick } = setup();
  network.sendPosition({ x: 1, z: 2, heading: Math.PI, anim: 0 });
  assert.equal(sent.length, 0);
  emitter.emit('welcome', welcome({ x: SPAWN.x, y: 3, z: SPAWN.z, ry: 0 }));
  tick(100);
  network.sendPosition({ x: 1, z: 2, heading: Math.PI, anim: 2 });
  assert.equal(sent.length, 1);
  assert.deepEqual(
    { ...sent[0], seq: undefined },
    { t: 'pos', x: ORIGIN.x + 1, y: 3, z: ORIGIN.z + 2, ry: 0, anim: 2, seq: undefined },
  );
  assert.equal(validate(sent[0]).ok, true);
});

test('pos: не чаще 15 Гц, без повторов на месте, но с heartbeat раз в секунду', () => {
  const { emitter, sent, network, tick } = setup();
  emitter.emit('welcome', welcome({ x: SPAWN.x, y: 0, z: SPAWN.z, ry: 0 }));
  const pos = { x: 0, z: 13.25, heading: Math.PI, anim: 0 };
  tick(100);
  network.sendPosition(pos);
  tick(10);
  network.sendPosition({ ...pos, x: 1 });
  assert.equal(sent.length, 1);
  tick(100);
  network.sendPosition({ ...pos, x: 1 });
  assert.equal(sent.length, 2);
  tick(200);
  network.sendPosition({ ...pos, x: 1 });
  assert.equal(sent.length, 2);
  tick(1000);
  network.sendPosition({ ...pos, x: 1 });
  assert.equal(sent.length, 3);
});

test('если сообщение не ушло, оно повторяется на следующем кадре', () => {
  const { emitter, sent, network, tick } = setup({ sendOk: false });
  emitter.emit('welcome', welcome({ x: SPAWN.x, y: 0, z: SPAWN.z, ry: 0 }));
  tick(100);
  network.sendPosition({ x: 0, z: 13.25, heading: Math.PI, anim: 0 });
  assert.equal(sent.length, 0);
});

test('игроки: join, players в локальных координатах, leave', () => {
  const { emitter, calls } = setup();
  emitter.emit('welcome', welcome({ x: SPAWN.x, y: 0, z: SPAWN.z, ry: 0 }));
  emitter.emit('player_join', { t: 'player_join', id: 7, name: 'Аня', appearance: {} });
  emitter.emit('players', { t: 'players', tick: 1, list: [[7, ORIGIN.x + 4, 0, ORIGIN.z - 6, 0, 1]] });
  emitter.emit('player_leave', { t: 'player_leave', id: 7 });
  assert.deepEqual(calls.filter((c) => ['add', 'remove'].includes(c[0])), [['add', 7, 'Аня', false], ['remove', 7]]);
  const update = calls.find((c) => c[0] === 'update')[1][0];
  assert.deepEqual(update, { id: 7, x: 4, z: -6, heading: Math.PI, moving: true });
});

test('экипировка удалённого игрока применяется при появлении и обновляется после события', () => {
  const { emitter, calls } = setup();
  emitter.emit('player_join', { t: 'player_join', id: 7, name: 'Аня', appearance: { firefighterEquipped: true } });
  emitter.emit('player_appearance', { t: 'player_appearance', id: 7, appearance: { firefighterEquipped: false } });
  assert.deepEqual(calls.filter((c) => ['add', 'equipment'].includes(c[0])), [
    ['add', 7, 'Аня', true],
    ['equipment', 7, false],
  ]);
});

test('correct переносит игрока, сохраняя направление; обрыв и выход очищают сцену', () => {
  const { emitter, calls, sent, network, sessions, tick } = setup();
  emitter.emit('welcome', welcome({ x: SPAWN.x, y: 0, z: SPAWN.z, ry: 0 }));
  emitter.emit('correct', { t: 'correct', x: ORIGIN.x + 2, y: 0, z: ORIGIN.z + 3 });
  assert.deepEqual(calls.filter((c) => c[0] === 'local').at(-1)[1], { x: 2, z: 3, heading: Math.PI });

  const cleared = () => calls.filter((c) => c[0] === 'clear').length;
  const before = cleared();
  emitter.emit('status', { status: 'reconnecting' });
  assert.equal(cleared(), before + 1);
  tick(100);
  network.sendPosition({ x: 2, z: 3, heading: 0, anim: 1 });
  assert.equal(sent.length, 0);

  emitter.emit('welcome', welcome({ x: SPAWN.x, y: 0, z: SPAWN.z, ry: 0 }));
  emitter.emit('auth', null);
  assert.deepEqual(sessions, [true, false]);
  assert.ok(cleared() >= before + 2);
});

test('dispose отписывается от событий', () => {
  const { emitter, calls, network } = setup();
  network.dispose();
  emitter.emit('welcome', welcome({ x: SPAWN.x, y: 0, z: SPAWN.z, ry: 0 }));
  assert.equal(calls.length, 0);
});

test('force отправляет изменившуюся позицию сразу, неизменную — нет', () => {
  const { emitter, sent, network, tick } = setup();
  emitter.emit('welcome', welcome({ x: SPAWN.x, y: 0, z: SPAWN.z, ry: 0 }));
  tick(100);
  network.sendPosition({ x: 0, z: START.z, heading: Math.PI, anim: 0 });
  tick(5);
  network.sendPosition({ x: 0, z: START.z, heading: Math.PI + 0.3, anim: 0 }, { force: true });
  assert.equal(sent.length, 2, 'поворот ушёл без ожидания интервала');
  tick(5);
  network.sendPosition({ x: 0, z: START.z, heading: Math.PI + 0.3, anim: 0 }, { force: true });
  assert.equal(sent.length, 2, 'без изменений force ничего не шлёт');
});

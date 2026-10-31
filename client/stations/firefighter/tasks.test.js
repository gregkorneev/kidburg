import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmitter } from '../../engine/emitter.js';
import { validate } from '../../../shared/protocol.js';
import { TASK_ID, createTaskSync } from './tasks.js';

function setup({ sendOk = true } = {}) {
  const emitter = createEmitter();
  const sent = [];
  const api = {
    on: (type, handler) => emitter.on(type, handler),
    net: { send: (msg) => (sendOk ? (sent.push(msg), true) : false) },
  };
  const log = { states: [], notices: [], busy: [], before: 0 };
  const timeouts = [];
  const timers = {
    setTimeout: (fn) => (timeouts.push(fn), timeouts.length),
    clearTimeout: () => {},
  };
  const sync = createTaskSync({
    api,
    onState: (state, meta) => log.states.push({ state, meta }),
    onNotice: (text) => log.notices.push(text),
    onBusy: (value) => log.busy.push(value),
    beforeSend: () => log.before++,
    timers,
  });
  const reply = (state) => emitter.emit('task_state', { t: 'task_state', taskId: TASK_ID, state });
  return { sync, sent, log, reply, timeouts, emitter };
}

const server = (over = {}) => ({
  stage: 'briefing', equipped: false, fireHits: 0, carryingMannequin: false, mannequinDelivered: false,
  done: false, feedback: '', changed: false, ...over,
});

test('клиент отправляет только намерение: taskId и payload.action, без состояния и координат', () => {
  const { sync, sent, log } = setup();
  assert.equal(sync.send('start'), true);
  assert.deepEqual(sent, [{ t: 'task_answer', taskId: TASK_ID, payload: { action: 'start' } }]);
  assert.equal(validate(sent[0]).ok, true);
  assert.equal(log.before, 1, 'перед отправкой досылается позиция');
});

test('состояние берётся только из task_state; подтверждение вызывает onConfirmed', () => {
  const { sync, reply, log } = setup();
  let confirmed = 0;
  sync.send('start', { onConfirmed: () => confirmed++ });
  assert.equal(sync.busy, true);
  assert.equal(sync.state.stage, 'not_started', 'до ответа сервера локально ничего не меняется');
  reply(server({ changed: true, feedback: 'Маруся начинает инструктаж.' }));
  assert.equal(sync.state.stage, 'briefing');
  assert.equal(confirmed, 1);
  assert.equal(sync.busy, false);
  assert.deepEqual(log.busy, [true, false]);
  assert.equal(log.states.at(-1).meta.changed, true);
});

test('отказ сервера: состояние не меняется, показывается подсказка, вызывается onRejected', () => {
  const { sync, reply, log } = setup();
  let rejected = 0;
  let confirmed = 0;
  sync.send('equip', { onConfirmed: () => confirmed++, onRejected: () => rejected++ });
  reply(server({ stage: 'not_started', feedback: 'Подойдите к нужному объекту.', changed: false }));
  assert.equal(confirmed, 0);
  assert.equal(rejected, 1);
  assert.deepEqual(log.notices, ['Подойдите к нужному объекту.']);
  assert.equal(sync.state.stage, 'not_started');
});

test('ошибка сохранения: нет ложного подтверждения, интерфейс остаётся на прежнем состоянии', () => {
  const { sync, reply, log } = setup();
  reply(server({ stage: 'equipping' }));
  let confirmed = 0;
  let rejected = 0;
  sync.send('equip', { onConfirmed: () => confirmed++, onRejected: () => rejected++ });
  const statesBefore = log.states.length;
  reply({ error: 'storage', feedback: 'Сервер не смог сохранить прогресс.' });
  assert.equal(confirmed, 0);
  assert.equal(rejected, 1);
  assert.equal(log.states.length, statesBefore, 'onState не вызывался');
  assert.equal(sync.state.stage, 'equipping');
  assert.equal(log.notices.at(-1), 'Сервер не смог сохранить прогресс.');
  assert.equal(sync.busy, false);
});

test('пока ждём ответ, второе обычное действие не уходит; серия fire_hit идёт без ожидания', () => {
  const { sync, sent, reply } = setup();
  assert.equal(sync.send('start'), true);
  assert.equal(sync.send('accept_briefing'), false);
  assert.equal(sent.length, 1);
  reply(server({ changed: true }));
  reply(server({ stage: 'fire_drill', equipped: true }));
  assert.equal(sync.send('fire_hit'), true);
  assert.equal(sync.send('fire_hit'), true);
  assert.equal(sent.length, 3);
  assert.equal(sync.busy, false);
});

test('нет связи: ничего не уходит, пользователь видит сообщение', () => {
  const { sync, log } = setup({ sendOk: false });
  let rejected = 0;
  assert.equal(sync.send('start', { onRejected: () => rejected++ }), false);
  assert.equal(rejected, 1);
  assert.match(log.notices[0], /Нет связи/);
  assert.equal(sync.busy, false);
});

test('сервер не ответил: таймаут снимает ожидание', () => {
  const { sync, timeouts, log } = setup();
  let rejected = 0;
  sync.send('start', { onRejected: () => rejected++ });
  timeouts[0]();
  assert.equal(sync.busy, false);
  assert.equal(rejected, 1);
  assert.match(log.notices[0], /не ответил/);
});

test('чужие задания и мусор игнорируются; reset и dispose очищают', () => {
  const { sync, emitter, reply, log } = setup();
  emitter.emit('task_state', { t: 'task_state', taskId: 'other', state: server({ stage: 'completed' }) });
  reply(undefined);
  reply({ stage: 5 });
  assert.equal(sync.state.stage, 'not_started');
  reply(server({ stage: 'rescue', fireHits: 18, done: false }));
  assert.equal(sync.state.fireHits, 18);
  sync.reset();
  assert.equal(sync.state.stage, 'not_started');
  const count = log.states.length;
  sync.dispose();
  reply(server());
  assert.equal(log.states.length, count);
});

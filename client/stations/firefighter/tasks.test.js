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
  stage: 'briefing', equipped: false, windows: [0, 0, 0, 0], carryingMannequin: false, mannequinDelivered: false,
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

test('пока ждём ответ, второе обычное действие не уходит; серия window_hit идёт без ожидания', () => {
  const { sync, sent, reply } = setup();
  assert.equal(sync.send('start'), true);
  assert.equal(sync.send('accept_briefing'), false);
  assert.equal(sent.length, 1);
  reply(server({ changed: true }));
  reply(server({ stage: 'fire_drill', equipped: true }));
  assert.equal(sync.send('window_hit', { index: 0 }), true);
  assert.equal(sync.send('window_hit', { index: 3 }), true);
  assert.equal(sent.length, 3);
  assert.equal(sync.busy, false);
  assert.deepEqual(sent[1].payload, { action: 'window_hit', index: 0 });
  assert.deepEqual(sent[2].payload, { action: 'window_hit', index: 3 });
  assert.equal(validate(sent[2]).ok, true);
});

test('window_hit передаёт только action и index; index не попадает в другие действия', () => {
  const { sync, sent, reply } = setup();
  sync.send('start', { index: 2 });
  assert.deepEqual(sent[0].payload, { action: 'start' }, 'лишний index не уходит');
  reply(server({ changed: true }));
  sync.send('window_hit', { index: 1, windows: [12, 12, 12, 12], stage: 'rescue' });
  assert.deepEqual(sent[1].payload, { action: 'window_hit', index: 1 });
  assert.deepEqual(Object.keys(sent[1]).sort(), ['payload', 't', 'taskId']);
});

test('состояние окон берётся только из task_state и очищается от мусора', () => {
  const { sync, reply, log } = setup();
  reply(server({ stage: 'fire_drill', equipped: true, windows: [12, 5, 0, 1], changed: true }));
  assert.deepEqual(sync.state.windows, [12, 5, 0, 1]);
  assert.deepEqual(log.states.at(-1).state.windows, [12, 5, 0, 1]);

  // Некорректные значения не ломают интерфейс: недостающие окна — нули, лишнее обрезается.
  reply(server({ stage: 'fire_drill', windows: [99, -3, 'x', 1.5, 7] }));
  assert.deepEqual(sync.state.windows, [12, 0, 0, 0]);
  reply(server({ stage: 'fire_drill', windows: undefined }));
  assert.deepEqual(sync.state.windows, [0, 0, 0, 0]);
  reply(server({ stage: 'fire_drill', windows: 'oops' }));
  assert.deepEqual(sync.state.windows, [0, 0, 0, 0]);

  // Состояние не делит массив с сообщением сети.
  const wire = [3, 3, 3, 3];
  reply(server({ stage: 'fire_drill', windows: wire }));
  wire[0] = 9;
  assert.deepEqual(sync.state.windows, [3, 3, 3, 3]);
});

test('отказ по окну (мимо, далеко, зона) не меняет состояние и не вызывает onConfirmed', () => {
  const { sync, reply, log } = setup();
  reply(server({ stage: 'fire_drill', equipped: true, windows: [2, 0, 0, 0] }));
  let confirmed = 0;
  sync.send('window_hit', { index: 1, onConfirmed: () => confirmed++ });
  reply(server({ stage: 'fire_drill', equipped: true, windows: [2, 0, 0, 0], changed: false, feedback: 'Направьте учебный рукав на окно.' }));
  assert.equal(confirmed, 0);
  assert.deepEqual(sync.state.windows, [2, 0, 0, 0]);
  assert.equal(log.notices.length, 0, 'серия попаданий без ожидания не засоряет уведомлениями');
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
  reply(server({ stage: 'rescue', windows: [12, 12, 12, 12], done: false }));
  assert.deepEqual(sync.state.windows, [12, 12, 12, 12]);
  sync.reset();
  assert.equal(sync.state.stage, 'not_started');
  const count = log.states.length;
  sync.dispose();
  reply(server());
  assert.equal(log.states.length, count);
});

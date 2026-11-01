import test from 'node:test';
import assert from 'node:assert/strict';
import { PENDING_TTL_MS, createStationProgress } from './station-progress.js';

function fakeApi() {
  const handlers = new Map();
  const sent = [];
  return {
    sent,
    net: { send: (msg) => (sent.push(msg), true) },
    on(type, fn) {
      handlers.set(type, [...(handlers.get(type) ?? []), fn]);
      return () => handlers.set(type, handlers.get(type).filter((h) => h !== fn));
    },
    emit: (type, msg) => (handlers.get(type) ?? []).forEach((fn) => fn(msg)),
  };
}

const setup = ({ canSend = true, onDiverged, timers } = {}) => {
  const api = fakeApi();
  let clock = 0;
  const adopted = [];
  const ctx = { local: { stage: 'a', index: 0 }, canSend };
  const progress = createStationProgress({
    api,
    taskId: 't1',
    project: (s) => ({ stage: s.stage, index: s.index }),
    getLocal: () => ctx.local,
    canSend: () => ctx.canSend,
    onDiverged,
    ...(timers ? { timers } : {}),
    adopt: (s) => adopted.push(s),
    now: () => clock,
  });
  return { api, progress, adopted, ctx, tick: (ms) => (clock += ms) };
};

const serverMsg = (state, extra = {}) => ({ t: 'task_state', taskId: 't1', state: { ...state, done: false, feedback: '', changed: true, ...extra } });

test('действие уходит как task_answer; совпавший ответ сервера ничего не меняет', () => {
  const { api, progress, adopted } = setup();
  assert.equal(progress.send({ action: 'go' }), true);
  assert.deepEqual(api.sent, [{ t: 'task_answer', taskId: 't1', payload: { action: 'go' } }]);
  assert.equal(progress.pending, 1);
  api.emit('task_state', serverMsg({ stage: 'a', index: 0 }));
  assert.equal(progress.pending, 0);
  assert.deepEqual(adopted, []);
});

test('расхождение после ответов на все действия: побеждает сервер', () => {
  const { api, progress, adopted, ctx } = setup();
  ctx.local = { stage: 'b', index: 4 }; // клиент ушёл вперёд
  progress.send({ action: 'one' });
  progress.send({ action: 'two' });
  api.emit('task_state', serverMsg({ stage: 'a', index: 0 })); // промежуточный ответ: ждём второй
  assert.deepEqual(adopted, []);
  api.emit('task_state', serverMsg({ stage: 'a', index: 1 }));
  assert.equal(adopted.length, 1);
  assert.deepEqual([adopted[0].stage, adopted[0].index], ['a', 1]);
  assert.equal('done' in adopted[0] || 'feedback' in adopted[0] || 'changed' in adopted[0], false, 'служебные поля отброшены');
});

test('начальное состояние сервера после hello принимается, если оно отличается (восстановление)', () => {
  const { api, adopted } = setup();
  api.emit('task_state', serverMsg({ stage: 'c', index: 2 }));
  assert.equal(adopted.length, 1);
  assert.equal(adopted[0].stage, 'c');
});

test('сверка учитывает сброшенный сервером режим пианино', () => {
  const api = fakeApi();
  const adopted = [];
  const progress = createStationProgress({
    api, taskId: 't1', canSend: () => true,
    project: (s) => ({ stage: s.stage, index: s.index, pianoMode: s.pianoMode === true }),
    getLocal: () => ({ stage: 'practice', index: 3, pianoMode: true }),
    adopt: (state) => adopted.push(state),
  });
  progress.send({ action: 'resume' });
  api.emit('task_state', serverMsg({ stage: 'practice', index: 3, pianoMode: false }));
  assert.equal(adopted[0].pianoMode, false);
  progress.dispose();
});

test('чужое задание и пустое состояние игнорируются, ошибка хранилища предупреждает игрока', () => {
  const { api, adopted } = setup();
  api.emit('task_state', { t: 'task_state', taskId: 'other', state: { stage: 'x', index: 9 } });
  api.emit('task_state', serverMsg({ stage: 'x', index: 9 }, { error: 'storage' }));
  api.emit('task_state', { t: 'task_state', taskId: 't1', state: null });
  assert.deepEqual(adopted, []);
});

test('ошибка записи на сервере помечает прогресс как несохранённый', () => {
  let warnings = 0;
  const { api, progress, adopted } = setup({ onDiverged: () => warnings++ });
  progress.send({ action: 'go' });
  api.emit('task_state', serverMsg({ stage: 'a', index: 0 }, { error: 'storage' }));
  assert.equal(progress.diverged, true);
  assert.equal(warnings, 1);
  api.emit('task_state', serverMsg({ stage: 'a', index: 0 }));
  assert.deepEqual(adopted, []);
});

test('отказ сервера показывает игроку причину, начальное состояние не вызывает уведомление', () => {
  const api = fakeApi();
  const notices = [];
  const progress = createStationProgress({
    api, taskId: 't1', canSend: () => true, project: (s) => s.stage,
    getLocal: () => ({ stage: 'a' }), adopt: () => {}, onReject: (message) => notices.push(message),
  });
  api.emit('task_state', serverMsg({ stage: 'a' }, { changed: false, feedback: 'Старое сообщение' }));
  progress.send({ action: 'enter_piano' });
  api.emit('task_state', serverMsg({ stage: 'a' }, { changed: false, feedback: 'Подойдите к нужному объекту.' }));
  assert.deepEqual(notices, ['Подойдите к нужному объекту.']);
  progress.dispose();
});

test('действия без связи помечают расхождение: старое состояние сервера локальный прогресс не откатывает', () => {
  let warnings = 0;
  const { api, progress, adopted, ctx } = setup({ canSend: false, onDiverged: () => warnings++ });
  ctx.local = { stage: 'b', index: 1 };
  assert.equal(progress.send({ action: 'offline' }), false);
  assert.equal(progress.diverged, true);
  progress.send({ action: 'offline-again' });
  assert.equal(warnings, 1);
  assert.deepEqual(api.sent, []);
  ctx.canSend = true;
  api.emit('task_state', serverMsg({ stage: 'a', index: 0 }));
  assert.deepEqual(adopted, []);
});

test('потерянный ответ предупреждает и не откатывает неподтверждённый прогресс', () => {
  let warnings = 0;
  let timeout;
  const timers = { setTimeout: (fn) => (timeout = fn, 1), clearTimeout: () => { timeout = null; } };
  const { api, progress, adopted, ctx, tick } = setup({ onDiverged: () => warnings++, timers });
  ctx.local = { stage: 'b', index: 3 };
  progress.send({ action: 'dropped' });
  tick(PENDING_TTL_MS + 1);
  timeout(); // предупреждение появляется даже без дальнейших действий игрока
  assert.equal(progress.pending, 0);
  assert.equal(progress.diverged, true);
  assert.equal(warnings, 1);
  api.emit('task_state', serverMsg({ stage: 'a', index: 0 }));
  assert.equal(adopted.length, 0);
});

test('welcome сбрасывает ожидания; dispose отписывает обработчики', () => {
  const { api, progress, adopted } = setup();
  progress.send({ action: 'x' });
  api.emit('welcome', {});
  assert.equal(progress.pending, 0);
  progress.dispose();
  api.emit('task_state', serverMsg({ stage: 'z', index: 1 }));
  assert.deepEqual(adopted, []);
});

test('обрыв до подтверждения предупреждает о возможной потере действия', () => {
  let warnings = 0;
  const { api, progress, adopted } = setup({ onDiverged: () => warnings++ });
  progress.send({ action: 'go' });
  api.emit('status', { status: 'closed' });
  assert.equal(progress.diverged, true);
  assert.equal(warnings, 1);
  api.emit('welcome', {});
  api.emit('task_state', serverMsg({ stage: 'old', index: 0 }));
  assert.deepEqual(adopted, []);
});

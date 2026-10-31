import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIRE_HIT_LIMIT,
  WINDOW_COUNT,
  WINDOW_HIT_LIMIT,
  countDoneWindows,
  createInitialState,
  isValidWindowIndex,
  transitionTask,
  windowStatus,
} from './state.js';

const act = (state, type, extra = {}) => transitionTask(state, { type, ...extra });
const startAndEquip = () => {
  let state = createInitialState();
  state = act(state, 'start').state;
  state = act(state, 'accept_briefing').state;
  state = act(state, 'equip').state;
  return state;
};
const hit = (state, index, times = 1) => {
  for (let i = 0; i < times; i++) state = act(state, 'window_hit', { index }).state;
  return state;
};
const extinguishAll = (state) => {
  for (let index = 0; index < WINDOW_COUNT; index++) state = hit(state, index, WINDOW_HIT_LIMIT);
  return state;
};

test('проходит от инструктажа до завершения станции', () => {
  let state = createInitialState();
  state = act(state, 'start').state;
  assert.equal(state.stage, 'briefing');
  state = act(state, 'accept_briefing').state;
  state = act(state, 'equip').state;
  assert.equal(state.stage, 'fire_drill');

  state = extinguishAll(state);
  assert.equal(state.stage, 'rescue');
  state = act(state, 'pickup_mannequin').state;
  state = act(state, 'deliver_mannequin').state;
  assert.equal(state.stage, 'debrief');
  state = act(state, 'report').state;
  assert.equal(state.stage, 'completed');
});

test('действия не по порядку не меняют состояние', () => {
  const initial = createInitialState();
  for (const type of ['equip', 'window_hit', 'pickup_mannequin', 'deliver_mannequin', 'report']) {
    const result = act(initial, type, { index: 0 });
    assert.equal(result.changed, false, type);
    assert.deepEqual(result.state, initial, type);
  }
});

test('повторная экипировка и завершение идемпотентны', () => {
  const equipped = startAndEquip();
  const repeatedEquip = act(equipped, 'equip');
  assert.equal(repeatedEquip.changed, false);
  assert.equal(repeatedEquip.state.stage, 'fire_drill');

  let completed = extinguishAll(equipped);
  completed = act(completed, 'pickup_mannequin').state;
  completed = act(completed, 'deliver_mannequin').state;
  completed = act(completed, 'report').state;
  const repeatedReport = act(completed, 'report');
  assert.equal(repeatedReport.changed, false);
  assert.deepEqual(repeatedReport.state, completed);
});

test('прогресс разных игроков независим и состояния не делят массив окон', () => {
  const playerA = startAndEquip();
  const playerB = createInitialState();
  const advancedA = hit(playerA, 2);
  assert.deepEqual(advancedA.windows, [0, 0, 1, 0]);
  assert.deepEqual(playerA.windows, [0, 0, 0, 0], 'исходное состояние не мутируется');
  assert.equal(playerB.stage, 'not_started');
  assert.deepEqual(playerB.windows, [0, 0, 0, 0]);
  assert.notEqual(createInitialState().windows, createInitialState().windows);
});

test('окна тушатся независимо: этап меняется только после последнего окна', () => {
  let state = startAndEquip();
  assert.equal(act(state, 'window_hit', { index: 99 }).changed, false);

  state = hit(state, 1);
  assert.equal(windowStatus(state.windows[1]), 'extinguishing');
  assert.equal(windowStatus(state.windows[0]), 'active');
  state = hit(state, 1, WINDOW_HIT_LIMIT - 1);
  assert.equal(windowStatus(state.windows[1]), 'done');
  assert.equal(act(state, 'window_hit', { index: 1 }).changed, false, 'потушенное окно не принимает попаданий');
  assert.equal(state.stage, 'fire_drill');

  for (const index of [0, 2]) state = hit(state, index, WINDOW_HIT_LIMIT);
  assert.equal(state.stage, 'fire_drill', 'три окна из четырёх — этап не завершён');
  assert.equal(countDoneWindows(state.windows), 3);
  const last = act(state, 'window_hit', { index: 3 });
  assert.equal(last.state.stage, 'fire_drill');
  state = hit(state, 3, WINDOW_HIT_LIMIT);
  assert.equal(state.stage, 'rescue');
  assert.deepEqual(state.windows, [12, 12, 12, 12]);
  assert.equal(FIRE_HIT_LIMIT, WINDOW_COUNT * WINDOW_HIT_LIMIT);
  assert.equal(act(state, 'window_hit', { index: 0 }).changed, false);
});

test('window_hit: индекс должен быть целым числом в пределах окон', () => {
  const state = startAndEquip();
  for (const index of [-1, 4, 99, 1.5, NaN, Infinity, '1', '0', null, undefined, {}, [], true]) {
    const result = act(state, 'window_hit', { index });
    assert.equal(result.changed, false, String(index));
    assert.deepEqual(result.state, state);
  }
  for (let index = 0; index < WINDOW_COUNT; index++) assert.equal(isValidWindowIndex(index), true);
  assert.equal(isValidWindowIndex(WINDOW_COUNT), false);
});

test('сообщения: тихие попадания, окно потушено, все окна потушены', () => {
  let state = startAndEquip();
  assert.equal(act(state, 'window_hit', { index: 0 }).feedback, '');
  state = hit(state, 0, WINDOW_HIT_LIMIT - 1);
  assert.match(act(state, 'window_hit', { index: 0 }).feedback, /Окно 1 потушено! Осталось: 3/);
  for (const index of [1, 2]) state = hit(state, index, WINDOW_HIT_LIMIT);
  state = hit(state, 0, WINDOW_HIT_LIMIT - state.windows[0]);
  state = hit(state, 3, WINDOW_HIT_LIMIT - 1);
  assert.match(act(state, 'window_hit', { index: 3 }).feedback, /Все окна потушены/);
});

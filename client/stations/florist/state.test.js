import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, orderMatches, transitionTask } from './state.js';

function act(state, type, extra = {}) {
  return transitionTask(state, { type, ...extra });
}

function begin() {
  let state = createInitialState();
  state = act(state, 'start_briefing').state;
  state = act(state, 'accept_order').state;
  return state;
}

function add(state, flower, id) {
  state = act(state, 'take_flower', { flower, id }).state;
  return act(state, 'add_flower').state;
}

function correctBouquet() {
  let state = begin();
  for (const [index, flower] of ['pink_tulip', 'white_daisy', 'pink_tulip', 'white_daisy', 'greenery'].entries()) {
    state = add(state, flower, `stem-${index}`);
  }
  return state;
}

test('заказ проходит от инструктажа до сдачи и может быть повторён', () => {
  let state = correctBouquet();
  assert.equal(state.stage, 'wrapping');
  state = act(state, 'choose_ribbon', { ribbon: 'pink' }).state;
  state = act(state, 'wrap').state;
  assert.equal(state.stage, 'handoff');
  assert.equal(state.wrapped, true);
  state = act(state, 'handoff').state;
  assert.equal(state.stage, 'completed');
  state = act(state, 'repeat').state;
  assert.deepEqual(state, createInitialState());
});

test('нельзя взять второй цветок, пока первый в руке', () => {
  const state = act(begin(), 'take_flower', { flower: 'pink_tulip' }).state;
  const result = act(state, 'take_flower', { flower: 'white_daisy' });
  assert.equal(result.changed, false);
  assert.equal(result.state.heldFlower.type, 'pink_tulip');
});

test('неверный состав не упаковывается, последний стебель можно убрать и заменить', () => {
  let state = begin();
  for (const flower of ['pink_tulip', 'white_daisy', 'pink_tulip', 'white_daisy', 'red_rose']) state = add(state, flower);
  assert.equal(state.stage, 'wrapping');
  assert.equal(orderMatches(state.stems), false);
  assert.equal(act(state, 'choose_ribbon', { ribbon: 'pink' }).state.ribbon, 'pink');
  assert.equal(act(state, 'wrap').changed, false);
  state = act(state, 'remove_last').state;
  state = add(state, 'greenery');
  assert.equal(orderMatches(state.stems), true);
});

test('нельзя начать сборку до инструктажа или нести больше пяти стеблей', () => {
  const early = act(createInitialState(), 'take_flower', { flower: 'pink_tulip' });
  assert.equal(early.changed, false);
  let state = correctBouquet();
  const full = act(state, 'take_flower', { flower: 'red_rose' });
  assert.equal(full.changed, false);
  assert.equal(state.stems.length, 5);
});

test('неверная лента и преждевременная сдача отклоняются', () => {
  let state = correctBouquet();
  assert.equal(act(state, 'handoff').changed, false);
  state = act(state, 'choose_ribbon', { ribbon: 'blue' }).state;
  assert.equal(act(state, 'wrap').changed, false);
  assert.equal(state.stage, 'wrapping');
});

test('неизвестные и повторные действия не повреждают состояние', () => {
  const state = begin();
  assert.equal(act(state, 'mystery').state, state);
  assert.equal(act(state, 'accept_order').changed, false);
  assert.equal(state.stems.length, 0);
});

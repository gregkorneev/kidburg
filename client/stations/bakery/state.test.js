import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBakeryAction, createInitialState } from './state.js';

test('состояние Bakery: неправильный порядок не меняет прогресс', () => {
  const initial = createInitialState();
  const result = applyBakeryAction(initial, 'use_oven');
  assert.equal(result.accepted, false);
  assert.equal(result.state, initial);
  assert.match(result.feedback, /Сейчас:/);
});

test('состояние Bakery: полный клиентский цикл завершается и считает заказ', () => {
  let state = createInitialState();
  for (const action of ['get_order', 'prepare_ingredients', 'shape_product', 'use_oven', 'collect_product', 'deliver_order']) {
    const result = applyBakeryAction(state, action);
    assert.equal(result.accepted, true, action);
    state = result.state;
  }
  assert.equal(state.stage, 'completed');
  assert.equal(state.completedOrders, 1);
  const repeated = applyBakeryAction(state, 'repeat_order');
  assert.equal(repeated.accepted, true);
  assert.equal(repeated.state.stage, 'waiting_order');
  assert.equal(repeated.state.completedOrders, 1);
});

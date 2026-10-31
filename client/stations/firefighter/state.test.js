import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, FIRE_HIT_LIMIT, transitionTask } from './state.js';

const act = (state, type) => transitionTask(state, { type });
const startAndEquip = () => {
  let state = createInitialState();
  state = act(state, 'start').state;
  state = act(state, 'accept_briefing').state;
  state = act(state, 'equip').state;
  return state;
};

test('проходит от инструктажа до завершения станции', () => {
  let state = createInitialState();
  state = act(state, 'start').state;
  assert.equal(state.stage, 'briefing');
  state = act(state, 'accept_briefing').state;
  state = act(state, 'equip').state;
  assert.equal(state.stage, 'fire_drill');

  for (let i = 0; i < FIRE_HIT_LIMIT; i++) state = act(state, 'fire_hit').state;
  assert.equal(state.stage, 'rescue');
  state = act(state, 'pickup_mannequin').state;
  state = act(state, 'deliver_mannequin').state;
  assert.equal(state.stage, 'debrief');
  state = act(state, 'report').state;
  assert.equal(state.stage, 'completed');
});

test('действия не по порядку не меняют состояние', () => {
  const initial = createInitialState();
  for (const type of ['equip', 'fire_hit', 'pickup_mannequin', 'deliver_mannequin', 'report']) {
    const result = act(initial, type);
    assert.equal(result.changed, false, type);
    assert.deepEqual(result.state, initial, type);
  }
});

test('повторная экипировка и завершение идемпотентны', () => {
  const equipped = startAndEquip();
  const repeatedEquip = act(equipped, 'equip');
  assert.equal(repeatedEquip.changed, false);
  assert.equal(repeatedEquip.state.stage, 'fire_drill');

  let completed = equipped;
  for (let i = 0; i < FIRE_HIT_LIMIT; i++) completed = act(completed, 'fire_hit').state;
  completed = act(completed, 'pickup_mannequin').state;
  completed = act(completed, 'deliver_mannequin').state;
  completed = act(completed, 'report').state;
  const repeatedReport = act(completed, 'report');
  assert.equal(repeatedReport.changed, false);
  assert.deepEqual(repeatedReport.state, completed);
});

test('прогресс разных игроков независим', () => {
  const playerA = startAndEquip();
  const playerB = createInitialState();
  const advancedA = act(playerA, 'fire_hit').state;
  assert.equal(advancedA.fireHits, 1);
  assert.equal(playerB.stage, 'not_started');
  assert.equal(playerB.fireHits, 0);
});

test('попадания ограничены порогом, завершённая мишень не увеличивает прогресс', () => {
  let state = startAndEquip();
  for (let i = 0; i < FIRE_HIT_LIMIT; i++) state = act(state, 'fire_hit').state;
  const repeated = act(state, 'fire_hit');
  assert.equal(state.fireHits, FIRE_HIT_LIMIT);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.state.fireHits, FIRE_HIT_LIMIT);
});

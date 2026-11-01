import test from 'node:test';
import assert from 'node:assert/strict';
import { activeZone, interactionPrompt, resolveInteraction } from './interactions.js';
import { createInitialState, applyBakeryAction } from './state.js';

test('взаимодействие: активная зона и подсказка соответствуют текущему этапу', () => {
  const state = createInitialState();
  const zone = activeZone(state);
  assert.equal(zone.id, 'mentor');
  assert.equal(interactionPrompt(state, { x: zone.x, z: zone.z }), zone.label);
  assert.equal(resolveInteraction(state, { x: zone.x, z: zone.z }).action, 'get_order');
  assert.equal(interactionPrompt(state, { x: 0, z: 0 }), '');
});

test('взаимодействие: нельзя активировать следующую станцию раньше времени', () => {
  const state = createInitialState();
  const ingredients = { x: -4, z: 0.5 };
  assert.equal(resolveInteraction(state, ingredients).action, null);
  assert.match(resolveInteraction(state, ingredients).feedback, /Сначала:/);
  const next = applyBakeryAction(state, 'get_order').state;
  assert.equal(resolveInteraction(next, ingredients).action, 'prepare_ingredients');
});

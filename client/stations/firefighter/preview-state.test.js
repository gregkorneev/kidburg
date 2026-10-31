import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewState, transitionPreview, WINDOW_COUNT, WINDOW_HIT_LIMIT } from './preview-state.js';

test('окна тушатся независимо и этап завершается только после последнего', () => {
  let state = createPreviewState();
  for (const type of ['start', 'accept_briefing', 'equip']) state = transitionPreview(state, { type }).state;
  assert.equal(transitionPreview(state, { type: 'window_hit', index: 99 }).changed, false);
  state = transitionPreview(state, { type: 'window_hit', index: 1 }).state;
  assert.equal(state.windows[1].status, 'extinguishing');
  assert.equal(state.windows[0].hits, 0);
  for (let i = 1; i < WINDOW_HIT_LIMIT; i++) state = transitionPreview(state, { type: 'window_hit', index: 1 }).state;
  assert.equal(state.windows[1].status, 'done');
  assert.equal(transitionPreview(state, { type: 'window_hit', index: 1 }).changed, false);
  assert.equal(state.stage, 'fire_drill');
  for (let index = 0; index < WINDOW_COUNT; index++) {
    if (index === 1) continue;
    for (let i = 0; i < WINDOW_HIT_LIMIT; i++) state = transitionPreview(state, { type: 'window_hit', index }).state;
  }
  assert.equal(state.stage, 'rescue');
  assert.ok(state.windows.every((window) => window.status === 'done'));
  assert.equal(transitionPreview(state, { type: 'window_hit', index: 0 }).changed, false);
});

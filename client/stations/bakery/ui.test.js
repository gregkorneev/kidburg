import test from 'node:test';
import assert from 'node:assert/strict';
import { BakeryUI, bindControlsToggle } from './ui.js';
import { createInitialState } from './state.js';

test('панель управления показывает содержимое только в открытом состоянии', () => {
  const panel = (controlsOpen) => BakeryUI({ state: createInitialState(), controlsOpen }).props.children[2];
  const open = panel(true).props.children;
  const closed = panel(false).props.children;
  assert.equal(open[0].props['aria-expanded'], true);
  assert.equal(open[1].props.id, 'bakery-controls');
  assert.equal(closed[0].props['aria-expanded'], false);
  assert.equal(closed[1], false);
});

test('H переключает панель один раз и не срабатывает при вводе текста', () => {
  let handler;
  let toggles = 0;
  const target = {
    addEventListener(type, listener) { assert.equal(type, 'keydown'); handler = listener; },
    removeEventListener(type, listener) { assert.equal(type, 'keydown'); assert.equal(handler, listener); handler = null; },
  };
  const unbind = bindControlsToggle(target, () => { toggles++; });
  handler({ code: 'KeyH' });
  handler({ code: 'KeyH', repeat: true });
  handler({ code: 'KeyH', ctrlKey: true });
  handler({ code: 'KeyH', target: { closest: () => ({}) } });
  handler({ code: 'KeyE' });
  assert.equal(toggles, 1);
  unbind();
  assert.equal(handler, null);
});

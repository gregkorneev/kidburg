import test from 'node:test';
import assert from 'node:assert/strict';
import { bindCityExit } from './room-exit.js';

function harness() {
  const listeners = new Map();
  const window = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type, listener) => {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
  return { window, keydown: (event) => listeners.get('keydown')(event), listeners };
}

function key(code, extra = {}) {
  return { code, repeat: false, defaultPrevented: false, target: null, preventDefault() { this.prevented = true; }, ...extra };
}

test('L exits the location once, prevents its default action and removes its handler', () => {
  const h = harness();
  let exits = 0;
  const unbind = bindCityExit({ window: h.window, onExit: () => exits++ });
  const event = key('KeyL');

  h.keydown(event);
  assert.equal(exits, 1);
  assert.equal(event.prevented, true);
  unbind();
  assert.equal(h.listeners.size, 0);
});

test('L is ignored for other keys, repeats, text fields, editable content and blocked dialogs', () => {
  const h = harness();
  let exits = 0;
  bindCityExit({ window: h.window, onExit: () => exits++, isBlocked: () => true });
  h.keydown(key('KeyE'));
  h.keydown(key('KeyL', { repeat: true }));
  h.keydown(key('KeyL', { target: { tagName: 'INPUT', isContentEditable: false } }));
  h.keydown(key('KeyL', { target: { tagName: 'DIV', isContentEditable: true } }));
  h.keydown(key('KeyL'));
  assert.equal(exits, 0);
});

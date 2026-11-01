import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmitter } from '../engine/emitter.js';
import { createCityProgress } from './city-progress.js';

function element() {
  const classes = new Set();
  return {
    children: [], attributes: {}, hidden: false,
    classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); }, contains(name) { return classes.has(name); } },
    appendChild(child) { this.children.push(child); },
    setAttribute(name, value) { this.attributes[name] = value; },
    remove() { this.removed = true; },
  };
}

test('шкала показывает серверное завершение, повтор и новый вход', () => {
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: element };
  try {
    const container = element();
    const emitter = createEmitter();
    const dispose = createCityProgress(container, emitter);
    const root = container.children[0];
    const [label, bar] = root.children;
    assert.equal(root.hidden, true);
    emitter.emit('welcome', { state: { progress: { firefighter_station_v1: true, unknown: true } } });
    assert.equal(root.hidden, false);
    assert.equal(label.textContent, 'Пройдено домиков: 1 из 5');
    assert.equal(bar.attributes['aria-valuenow'], '1');
    assert.equal(bar.children[0].classList.contains('is-complete'), true);
    emitter.emit('task_state', { taskId: 'firefighter_station_v1', state: { done: false, error: 'storage' } });
    assert.equal(bar.attributes['aria-valuenow'], '1');
    emitter.emit('task_state', { taskId: 'firefighter_station_v1', state: { done: false } });
    assert.equal(bar.attributes['aria-valuenow'], '0');
    emitter.emit('task_state', { taskId: 'firefighter_station_v1', state: { done: true } });
    assert.equal(bar.attributes['aria-valuenow'], '1');
    emitter.emit('auth', null);
    assert.equal(root.hidden, true);
    emitter.emit('welcome', { state: { progress: {} } });
    assert.equal(bar.attributes['aria-valuenow'], '0');
    dispose();
    assert.equal(root.removed, true);
  } finally {
    globalThis.document = oldDocument;
  }
});

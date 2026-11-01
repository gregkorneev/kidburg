import test from 'node:test';
import assert from 'node:assert/strict';
import { createCountdown } from './countdown.js';

function fakeTimers() {
  const jobs = new Map();
  let next = 0;
  return {
    jobs,
    setTimeout(fn) { const id = ++next; jobs.set(id, fn); return id; },
    clearTimeout(id) { jobs.delete(id); },
    tick() { const [id, fn] = jobs.entries().next().value ?? []; if (fn) { jobs.delete(id); fn(); } },
  };
}

test('broadcast countdown reports 3, 2, 1 then clears before ON AIR', () => {
  const timers = fakeTimers();
  const values = [];
  const countdown = createCountdown({ timers, onTick: (value) => values.push(value) });
  countdown.start();
  timers.tick(); timers.tick(); timers.tick();
  assert.deepEqual(values, [3, 2, 1, null]);
  assert.equal(countdown.value, null);
});

test('countdown cancellation removes its scheduled step', () => {
  const timers = fakeTimers();
  const countdown = createCountdown({ timers });
  countdown.start();
  countdown.cancel();
  assert.equal(timers.jobs.size, 0);
  assert.equal(countdown.value, null);
});

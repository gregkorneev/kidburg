import test from 'node:test';
import assert from 'node:assert/strict';
import { createTeleprompter, groupTeleprompterWords, TELEPROMPTER_SPEEDS } from './teleprompter.js';

function fakeClock() {
  let now = 0;
  let nextId = 1;
  const jobs = new Map();
  return {
    jobs,
    now: () => now,
    setTimeout(fn, delay) {
      const id = nextId++;
      jobs.set(id, { fn, due: now + delay });
      return id;
    },
    clearTimeout(id) { jobs.delete(id); },
    tick(ms) {
      const end = now + ms;
      while (true) {
        const next = [...jobs.entries()].sort((a, b) => a[1].due - b[1].due)[0];
        if (!next || next[1].due > end) break;
        now = next[1].due;
        jobs.delete(next[0]);
        next[1].fn();
      }
      now = end;
    },
  };
}

const sampleText = 'Сегодня в нашем воображаемом городе солнечно. Лёгкий ветер качает деревья в парке. Днём станет немного теплее.';

test('text divides into groups of two or three words and preserves order and final word', () => {
  const groups = groupTeleprompterWords(sampleText);
  const words = groups.flatMap((group) => group.split(/\s+/u));
  assert.ok(groups.every((group) => group.split(/\s+/u).length >= 2 && group.split(/\s+/u).length <= 3));
  assert.deepEqual(words, sampleText.trim().split(/\s+/u));
  assert.equal(words.at(-1), 'теплее.');
  assert.deepEqual(groupTeleprompterWords('один два три четыре'), ['один два', 'три четыре']);
});

test('slow, normal, and fast use the requested timed intervals', () => {
  assert.deepEqual(TELEPROMPTER_SPEEDS, { slow: 1600, normal: 1000, fast: 650 });
  const clock = fakeClock();
  const prompter = createTeleprompter({ timers: clock, now: clock.now });
  for (const [speed, interval] of Object.entries(TELEPROMPTER_SPEEDS)) {
    prompter.setSpeed(speed);
    prompter.start(sampleText);
    clock.tick(interval - 1);
    assert.equal(prompter.index, 0, `${speed}: группа не меняется до интервала`);
    clock.tick(1);
    assert.equal(prompter.index, 1, `${speed}: новая группа появляется по интервалу`);
  }
  prompter.dispose();
});

test('pause keeps the current group and resume continues with its remaining interval', () => {
  const clock = fakeClock();
  const prompter = createTeleprompter({ timers: clock, now: clock.now });
  prompter.start(sampleText);
  const firstGroup = prompter.group;
  clock.tick(400);
  assert.equal(prompter.pause(), true);
  clock.tick(10_000);
  assert.equal(prompter.group, firstGroup);
  assert.equal(prompter.index, 0);
  assert.equal(prompter.resume(), true);
  clock.tick(599);
  assert.equal(prompter.index, 0);
  clock.tick(1);
  assert.equal(prompter.index, 1);
  prompter.dispose();
});

test('changing speed does not reset the current group or index', () => {
  const clock = fakeClock();
  const prompter = createTeleprompter({ timers: clock, now: clock.now });
  prompter.start(sampleText);
  clock.tick(500);
  const current = prompter.group;
  assert.equal(prompter.setSpeed('fast'), true);
  assert.equal(prompter.index, 0);
  assert.equal(prompter.group, current);
  clock.tick(649);
  assert.equal(prompter.index, 0);
  clock.tick(1);
  assert.equal(prompter.index, 1);
  prompter.dispose();
});

test('the final group remains visible and a new script starts from its first group', () => {
  const clock = fakeClock();
  const prompter = createTeleprompter({ timers: clock, now: clock.now });
  prompter.start(sampleText);
  clock.tick(60_000);
  assert.equal(prompter.isLast, true);
  const lastGroup = prompter.group;
  assert.equal(clock.jobs.size, 0);
  clock.tick(60_000);
  assert.equal(prompter.group, lastGroup);
  prompter.start('Новый выпуск начинается прямо сейчас.');
  assert.equal(prompter.index, 0);
  assert.equal(prompter.group, 'Новый выпуск начинается');
  prompter.dispose();
});

test('dispose clears the active timer', () => {
  const clock = fakeClock();
  const changes = [];
  const prompter = createTeleprompter({ timers: clock, now: clock.now, onChange: (group) => changes.push(group) });
  prompter.start(sampleText);
  assert.equal(clock.jobs.size, 1);
  prompter.dispose();
  assert.equal(clock.jobs.size, 0);
  clock.tick(60_000);
  assert.equal(changes.length, 1);
});

test('teleprompter has no Ollama or network dependency', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('./teleprompter.js', import.meta.url), 'utf8'));
  assert.doesNotMatch(source, /ollama|fetch\s*\(|WebSocket|https?:\/\//i);
});

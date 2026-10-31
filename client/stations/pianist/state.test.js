import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, transitionTask } from './state.js';
import { LESSON, MELODY, NOTES } from './melody.js';

function act(state, action) {
  const result = transitionTask(state, action);
  assert.ok(result.changed, result.feedback);
  return result.state;
}
function ready(stage = 'learning') {
  let state = createInitialState();
  state = act(state, { type: 'start_briefing' });
  state = act(state, { type: 'accept' });
  if (stage === 'learning') return state;
  state = act(state, { type: 'enter_piano' });
  for (const note of LESSON) state = act(state, { type: 'note', note, at: 1000 });
  if (stage === 'practice') return state;
  for (const note of MELODY) state = act(state, { type: 'note', note, at: 1200 });
  if (stage === 'rhythm') return state;
  let at = 2000;
  for (const note of MELODY) { state = act(state, { type: 'note', note, at }); at += 1000 * 60 / 90; }
  return state;
}

test('в октаве C4–C5 13 разных высот; белые ноты сопоставлены клавишам A–K', () => {
  assert.equal(NOTES.length, 13);
  assert.equal(new Set(NOTES.map(({ frequency }) => frequency)).size, 13);
  assert.deepEqual(NOTES.filter(({ black }) => !black).map(({ key }) => key), ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK']);
  assert.equal(NOTES[0].frequency, 261.625565);
  assert.equal(NOTES.at(-1).frequency, 523.251131);
});

test('изучение нот принимает До–Ре–Ми–Соль, ошибочная нота мягко возвращает к началу', () => {
  let state = ready();
  state = act(state, { type: 'enter_piano' });
  state = act(state, { type: 'note', note: 'C4', at: 10 });
  const error = transitionTask(state, { type: 'note', note: 'B4', at: 20 });
  assert.equal(error.changed, true);
  assert.match(error.feedback, /с начала/);
  assert.equal(error.state.index, 0);
  state = error.state;
  for (const note of LESSON) state = act(state, { type: 'note', note, at: 30 });
  assert.equal(state.stage, 'practice');
});

test('мелодия репетируется, ритм принимает 90 BPM и мягко объясняет ранние/поздние ноты', () => {
  let state = ready('practice');
  for (const note of MELODY) state = act(state, { type: 'note', note, at: 3000 });
  assert.equal(state.stage, 'rhythm');
  state = act(state, { type: 'note', note: MELODY[0], at: 4000 });
  const tooSoon = transitionTask(state, { type: 'note', note: MELODY[1], at: 4100 });
  assert.match(tooSoon.feedback, /спокойнее/);
  state = tooSoon.state;
  const tooLate = transitionTask(state, { type: 'note', note: MELODY[0], at: 5000 });
  assert.equal(tooLate.state.index, 1);
  const lateSecond = transitionTask(tooLate.state, { type: 'note', note: MELODY[1], at: 6000 });
  assert.match(lateSecond.feedback, /ближе к щелчку/);
  state = lateSecond.state;
  let at = 6000;
  for (const note of MELODY) { state = act(state, { type: 'note', note, at }); at += 1000 * 60 / 90; }
  assert.equal(state.stage, 'concert_ready');
});

test('неправильная нота на репетиции сбрасывает попытку, но повтор доступен без перезапуска станции', () => {
  let state = ready('practice');
  state = act(state, { type: 'note', note: MELODY[0], at: 1000 });
  const wrong = transitionTask(state, { type: 'note', note: 'B4', at: 1200 });
  assert.match(wrong.feedback, /начни эту фразу заново/);
  assert.equal(wrong.state.stage, 'practice');
  assert.equal(wrong.state.index, 0);
  state = wrong.state;
  for (const note of MELODY) state = act(state, { type: 'note', note, at: 1300 });
  assert.equal(state.stage, 'rhythm');
});

test('концерт доступен у сцены и повтор начинается с чистого состояния', () => {
  let state = ready('rhythm');
  let at = 2000;
  for (const note of MELODY) { state = act(state, { type: 'note', note, at }); at += 1000 * 60 / 90; }
  assert.equal(state.stage, 'concert_ready');
  const away = transitionTask(state, { type: 'enter_piano', atStage: false });
  assert.equal(away.changed, false);
  state = act(state, { type: 'enter_piano', atStage: true });
  for (const note of MELODY) state = act(state, { type: 'note', note, at: 9000 });
  assert.equal(state.stage, 'completed');
  assert.equal(state.pianoMode, false);
  state = act(state, { type: 'repeat' });
  assert.deepEqual(state, createInitialState());
});

test('режим пианино отдельно включается и выключается', () => {
  let state = ready();
  state = act(state, { type: 'enter_piano' });
  assert.equal(state.pianoMode, true);
  state = act(state, { type: 'leave_piano' });
  assert.equal(state.pianoMode, false);
});

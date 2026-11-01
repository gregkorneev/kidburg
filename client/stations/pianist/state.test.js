import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, STAGES, STAGE_LABELS, transitionTask } from './state.js';
import { LESSON, MELODY, NOTES } from './melody.js';

function act(state, action) {
  const result = transitionTask(state, action);
  assert.ok(result.changed, result.feedback);
  return result.state;
}

function beginLesson() {
  let state = createInitialState();
  state = act(state, { type: 'start_briefing' });
  return act(state, { type: 'accept' });
}

function readyForPractice() {
  let state = beginLesson();
  state = act(state, { type: 'enter_piano' });
  for (const note of LESSON) state = act(state, { type: 'note', note });
  return state;
}

function readyForConcert() {
  let state = readyForPractice();
  for (const note of MELODY) state = act(state, { type: 'note', note });
  return state;
}

test('этапы соответствуют упрощённому прохождению без ритмического этапа', () => {
  assert.deepEqual(STAGES, ['not_started', 'briefing', 'learning', 'practice', 'concert', 'completed']);
  assert.deepEqual(STAGES.map((stage) => STAGE_LABELS[stage]), ['Знакомство', 'Знакомство с Маэстро', 'Изучение нот', 'Репетиция', 'Концерт', 'Завершение']);
});

test('в октаве C4–C5 13 разных высот; белые ноты сопоставлены клавишам A–K', () => {
  assert.equal(NOTES.length, 13);
  assert.equal(new Set(NOTES.map(({ frequency }) => frequency)).size, 13);
  assert.deepEqual(NOTES.filter(({ black }) => !black).map(({ key }) => key), ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK']);
  assert.equal(NOTES[0].frequency, 261.625565);
  assert.equal(NOTES.at(-1).frequency, 523.251131);
  assert.deepEqual(LESSON, ['C4', 'D4', 'E4', 'G4']);
  assert.deepEqual(MELODY, ['C4', 'D4', 'E4', 'G4', 'G4', 'E4', 'D4', 'C4']);
});

test('изучение нот принимает До–Ре–Ми–Соль, ошибочная нота мягко возвращает к началу', () => {
  let state = beginLesson();
  state = act(state, { type: 'enter_piano' });
  state = act(state, { type: 'note', note: 'C4' });
  const error = transitionTask(state, { type: 'note', note: 'B4' });
  assert.equal(error.changed, true);
  assert.match(error.feedback, /с начала/);
  assert.equal(error.state.index, 0);
  state = error.state;
  for (const note of LESSON) state = act(state, { type: 'note', note });
  assert.equal(state.stage, 'practice');
});

test('в репетиции паузы 10 и 30 секунд не сбрасывают прогресс; далее сразу открывается концерт', () => {
  let state = readyForPractice();
  let at = 0;
  let finalAction;
  for (const [index, note] of MELODY.entries()) {
    at += index === 1 ? 10_000 : index === 2 ? 30_000 : 700;
    finalAction = transitionTask(state, { type: 'note', note, at });
    assert.ok(finalAction.changed, finalAction.feedback);
    state = finalAction.state;
  }
  assert.equal(state.stage, 'concert');
  assert.equal(state.pianoMode, false);
  assert.equal(state.index, 0);
  assert.match(finalAction.feedback, /Подойди к сцене/);
});

test('неправильная нота сбрасывает только мелодическую фразу и не проверяет время', () => {
  let state = readyForPractice();
  state = act(state, { type: 'note', note: MELODY[0], at: 1 });
  const wrong = transitionTask(state, { type: 'note', note: 'B4', at: 300_001 });
  assert.match(wrong.feedback, /начни эту фразу заново/);
  assert.equal(wrong.state.stage, 'practice');
  assert.equal(wrong.state.index, 0);
});

test('концерт завершается правильной последовательностью даже с 30-секундными паузами', () => {
  let state = readyForConcert();
  const away = transitionTask(state, { type: 'enter_piano', atStage: false });
  assert.equal(away.changed, false);
  state = act(state, { type: 'enter_piano', atStage: true });
  let at = 10_000;
  let finalAction;
  for (const note of MELODY) {
    finalAction = transitionTask(state, { type: 'note', note, at });
    assert.ok(finalAction.changed, finalAction.feedback);
    state = finalAction.state; at += 30_000;
  }
  assert.equal(state.stage, 'completed');
  assert.equal(state.pianoMode, false);
  assert.match(finalAction.feedback, /аплодирует/);
});

test('неправильная концертная нота перезапускает мелодию; после победы можно повторить урок', () => {
  let state = act(readyForConcert(), { type: 'enter_piano', atStage: true });
  state = act(state, { type: 'note', note: MELODY[0] });
  const wrong = transitionTask(state, { type: 'note', note: 'B4' });
  assert.equal(wrong.state.stage, 'concert');
  assert.equal(wrong.state.index, 0);
  state = wrong.state;
  for (const note of MELODY) state = act(state, { type: 'note', note });
  assert.equal(state.stage, 'completed');
  state = act(state, { type: 'repeat' });
  assert.deepEqual(state, createInitialState());
});

test('режим пианино отдельно включается и выключается', () => {
  let state = act(beginLesson(), { type: 'enter_piano' });
  assert.equal(state.pianoMode, true);
  state = act(state, { type: 'leave_piano' });
  assert.equal(state.pianoMode, false);
});

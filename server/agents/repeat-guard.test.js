import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepeatGuard, fingerprint, similarity, splitSentences, startsWithGreeting } from './repeat-guard.js';

const same = (a, b) => similarity(fingerprint(a), fingerprint(b));

test('приветствие в начале ответа распознаётся, обычное начало — нет', () => {
  for (const text of ['Привет, Аня!', 'здравствуйте', 'Здравствуй, друг', 'Добрый день!', 'Приветствую тебя на станции', 'Привет']) {
    assert.equal(startsWithGreeting(text), true, text);
  }
  for (const text of ['Сначала надень экипировку.', 'Рада видеть тебя снова.', 'Это было вчера: привет всем.', '']) {
    assert.equal(startsWithGreeting(text), false, text);
  }
});

test('сходство нечёткое: регистр, пунктуация, ё и окончания не делают повтор «новым»', () => {
  const original = 'Экипировка защищает пожарного от жара и осколков.';
  assert.ok(same(original, 'экипировка защищает ПОЖАРНОГО от жара и осколков!!!') >= 0.9);
  assert.ok(same(original, 'Экипировку проверяют: защищает пожарного от жара, осколков.') >= 0.6);
  assert.ok(same('Всё ещё держит жёлтый шлем.', 'Все еще держит жеcтый шлем') < 1);
  assert.equal(same('Привет!', ''), 0);
});

test('разные ответы с общими словами не считаются повтором', () => {
  const guard = createRepeatGuard({ previous: ['Экипировка защищает пожарного от жара и осколков, поэтому её проверяют до смены.'], met: true });
  // другая мысль, часть слов общая
  assert.equal(guard.check('Пожарные работают в команде: один держит рукав, другой следит за связью.', { ended: true }), 'ok');
  assert.equal(guard.check('Перед сменой пожарный проверяет рацию и шлем, а потом докладывает старшему.', { ended: true }), 'ok');
  // не побуквенный повтор тоже ловится
  assert.equal(guard.check('Экипировка, как известно, защищает пожарного от жара и осколков, поэтому её проверяют до смены!', { ended: true }), 'repeat');
});

test('повторное приветствие — повтор, но только когда игрок и агент уже разговаривали', () => {
  const met = createRepeatGuard({ previous: [], met: true });
  assert.equal(met.check('Привет, Аня! Рада видеть тебя на станции.', { ended: false }), 'repeat');
  assert.equal(met.check('Привет', { ended: false }), 'wait', 'слово ещё может продолжаться («Приветствую»)');
  assert.equal(met.check('Привет,', { ended: false }), 'repeat');
  assert.equal(met.check('Здравствуйте', { ended: true }), 'repeat');

  const first = createRepeatGuard({ previous: [], met: false });
  assert.equal(first.check('Привет, Аня! Я Маруся, наставница учебной смены.', { ended: false }), 'ok');
});

test('решение откладывается, пока начало ответа не законченное предложение; длинное начало решается без точки', () => {
  const guard = createRepeatGuard({ previous: [], met: false });
  assert.equal(guard.check('Сегодня мы', { ended: false }), 'wait');
  assert.equal(guard.check('Сегодня мы начнём с инструктажа', { ended: false }), 'wait');
  assert.equal(guard.check('Сегодня мы начнём с инструктажа. ', { ended: false }), 'ok');
  assert.equal(guard.check('Да.', { ended: false }), 'wait', 'короткое начало ждёт продолжения');
  assert.equal(guard.check('Да.', { ended: true }), 'ok');
  assert.equal(guard.check('слово '.repeat(40), { ended: false }), 'ok', 'очень длинное начало без точки не ждём вечно');
  assert.equal(guard.check('', { ended: true }), 'ok');
});

test('короткие предложения (меньше трёх слов) не сравниваются', () => {
  const guard = createRepeatGuard({ previous: ['Хорошо. Давай начнём.'], met: true });
  assert.equal(guard.check('Хорошо. Давай начнём. А теперь самое важное: слушай инструктаж внимательно.', { ended: true }), 'ok');
});

test('предложения разбиваются по знакам конца', () => {
  assert.deepEqual(splitSentences('Раз. Два! Три? Четыре'), ['Раз.', 'Два!', 'Три?', 'Четыре']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepeatGuard, fingerprint, similarity, splitSentences } from './repeat-guard.js';

const same = (a, b) => similarity(fingerprint(a), fingerprint(b));

test('короткое приветствие не блокирует новый ответ; приветствие перед старым советом не скрывает повтор', () => {
  const advice = 'Экипировка защищает пожарного от жара и осколков.';
  const guard = createRepeatGuard({ previous: ['Привет, Аня!', advice] });
  assert.equal(guard.check('Привет! Смена завершена, можем обсудить профессию.', { ended: true }), 'ok');
  assert.equal(guard.check('Здравствуйте!', { ended: true }), 'ok');
  assert.equal(guard.check(`Привет! ${advice}`, { ended: true }), 'repeat');
});

test('сходство нечёткое: регистр, пунктуация, ё и окончания не делают повтор «новым»', () => {
  const original = 'Экипировка защищает пожарного от жара и осколков.';
  assert.ok(same(original, 'экипировка защищает ПОЖАРНОГО от жара и осколков!!!') >= 0.9);
  assert.ok(same(original, 'Экипировку проверяют: защищает пожарного от жара, осколков.') >= 0.6);
  assert.ok(same('Всё ещё держит жёлтый шлем.', 'Все еще держит жеcтый шлем') < 1);
  assert.equal(same('Привет!', ''), 0);
});

test('разные ответы с общими словами не считаются повтором', () => {
  const guard = createRepeatGuard({ previous: ['Экипировка защищает пожарного от жара и осколков, поэтому её проверяют до смены.'] });
  // другая мысль, часть слов общая
  assert.equal(guard.check('Пожарные работают в команде: один держит рукав, другой следит за связью.', { ended: true }), 'ok');
  assert.equal(guard.check('Перед сменой пожарный проверяет рацию и шлем, а потом докладывает старшему.', { ended: true }), 'ok');
  // не побуквенный повтор тоже ловится
  assert.equal(guard.check('Экипировка, как известно, защищает пожарного от жара и осколков, поэтому её проверяют до смены!', { ended: true }), 'repeat');
});

test('короткое приветствие в потоке ждёт продолжения перед выдачей', () => {
  const guard = createRepeatGuard({ previous: [] });
  assert.equal(guard.check('Прив', { ended: false }), 'wait');
  assert.equal(guard.check('Привет, Аня!', { ended: false }), 'wait');
  assert.equal(guard.check('Привет, Аня!', { ended: true }), 'ok');
});

test('решение откладывается, пока начало ответа не законченное предложение; длинное начало решается без точки', () => {
  const guard = createRepeatGuard({ previous: [] });
  assert.equal(guard.check('Сегодня мы', { ended: false }), 'wait');
  assert.equal(guard.check('Сегодня мы начнём с инструктажа', { ended: false }), 'wait');
  assert.equal(guard.check('Сегодня мы начнём с инструктажа. ', { ended: false }), 'ok');
  assert.equal(guard.check('Да.', { ended: false }), 'wait', 'короткое начало ждёт продолжения');
  assert.equal(guard.check('Да.', { ended: true }), 'ok');
  assert.equal(guard.check('слово '.repeat(40), { ended: false }), 'ok', 'очень длинное начало без точки не ждём вечно');
  assert.equal(guard.check('', { ended: true }), 'ok');
});

test('короткие предложения (меньше трёх слов) не сравниваются', () => {
  const guard = createRepeatGuard({ previous: ['Хорошо. Давай начнём.'] });
  assert.equal(guard.check('Хорошо. Давай начнём. А теперь самое важное: слушай инструктаж внимательно.', { ended: true }), 'ok');
});

test('предложения разбиваются по знакам конца', () => {
  assert.deepEqual(splitSentences('Раз. Два! Три? Четыре'), ['Раз.', 'Два!', 'Три?', 'Четыре']);
});

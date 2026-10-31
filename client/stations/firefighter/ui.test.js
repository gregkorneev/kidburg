import test from 'node:test';
import assert from 'node:assert/strict';
import { StationUI } from './ui.js';
import { WINDOW_COUNT, WINDOW_HIT_LIMIT, createInitialState } from './state.js';

/** Все тексты дерева vnode (компонент вызывается как функция, DOM не нужен). */
function texts(node, out = []) {
  if (node === null || node === undefined || node === false) return out;
  if (Array.isArray(node)) return node.forEach((child) => texts(child, out)), out;
  if (typeof node === 'string' || typeof node === 'number') return out.push(String(node)), out;
  texts(node.props?.children, out);
  return out;
}

function find(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out;
  if (Array.isArray(node)) return node.forEach((child) => find(child, predicate, out)), out;
  if (predicate(node)) out.push(node);
  find(node.props?.children, predicate, out);
  return out;
}

const drill = (windows) => ({ ...createInitialState(), stage: 'fire_drill', equipped: true, windows });
const view = (state, extra = {}) => StationUI({ state, prompt: '', notice: '', dialog: null, hoseActive: false, onChoose() {}, onCloseDialog() {}, ...extra });

test('цель этапа тушения — окна учебной стены; прогресс берётся из подтверждённого состояния', () => {
  const all = texts(view(drill([12, 3, 0, 0]))).join('|');
  assert.match(all, /Потушите окна учебной стены/);
  assert.match(all, new RegExp(`Потушено окон: 1/${WINDOW_COUNT}`));
  assert.match(all, /Наведите прицел на окно/);
  assert.doesNotMatch(all, /мишен/i);
});

test('прицел на окно показывает процент именно этого окна', () => {
  const tree = view(drill([0, 6, 12, 0]), { targetWindow: 1 });
  assert.match(texts(tree).join('|'), /Окно 2: 50%/);
  const bar = find(tree, (n) => n.props?.class === 'progress-value')[0];
  assert.equal(bar.props.style.width, '50%');

  const done = view(drill([0, 6, 12, 0]), { targetWindow: 2 });
  assert.match(texts(done).join('|'), /Окно 3: 100%/);
  assert.equal(find(done, (n) => n.props?.class === 'progress-value')[0].props.style.width, '100%');
  assert.equal(WINDOW_HIT_LIMIT, 12);
});

test('прогресс окон показывается только на этапе тушения; завершение описывает стену', () => {
  const equipping = { ...createInitialState(), stage: 'equipping' };
  assert.equal(find(view(equipping), (n) => n.props?.class === 'progress-wrap').length, 0);
  const completed = { ...createInitialState(), stage: 'completed', windows: [12, 12, 12, 12] };
  assert.match(texts(view(completed)).join('|'), /потушил все окна учебной стены/);
});

test('подсказка про рукав появляется вместе с режимом рукава', () => {
  assert.equal(find(view(drill([0, 0, 0, 0])), (n) => n.props?.class === 'hose-tip').length, 0);
  const tip = find(view(drill([0, 0, 0, 0]), { hoseActive: true }), (n) => n.props?.class === 'hose-tip');
  assert.equal(tip.length, 1);
  assert.match(texts(tip).join(''), /окно/);
});

test('кнопки диалога блокируются, пока сервер не ответил', () => {
  const dialog = { title: 'Т', body: 'Б', options: [{ label: 'Дальше', primary: true }] };
  // Button — функциональный компонент: раскрываем его вызовом и получаем <button>.
  const buttons = (busy) => find(view(createInitialState(), { dialog, busy }), (n) => n.props?.option).map((n) => n.type(n.props));
  assert.equal(buttons(false)[0].props.disabled, false);
  assert.equal(buttons(true)[0].props.disabled, true);
});

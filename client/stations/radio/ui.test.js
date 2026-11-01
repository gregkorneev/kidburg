import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { RadioScreen } from './ui.js';

function walk(node, result = { tags: [], text: [], classes: [] }) {
  if (node == null || typeof node === 'boolean') return result;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, result);
    return result;
  }
  if (typeof node === 'string' || typeof node === 'number') {
    result.text.push(String(node));
    return result;
  }
  if (typeof node.type === 'string') result.tags.push(node.type);
  if (typeof node.props?.class === 'string') result.classes.push(node.props.class);
  walk(node.props?.children, result);
  return result;
}

test('Radio level immediately prepares a server-selected episode without login or category choice', () => {
  const view = walk(RadioScreen({ state: null, pending: null, connected: false, notice: '', countdown: null }));
  const text = view.text.join(' ');

  assert.match(text, /РАДИОСТАНЦИЯ/);
  assert.match(text, /ИИ готовит выпуск/);
  assert.doesNotMatch(text, /Выбери тему выпуска|Погода|Научный факт/);
  assert.doesNotMatch(text, /Вход в радиостанцию|Представься|Имя ведущего|Код комнаты|Войти в Radio/);
  assert.equal(view.tags.includes('form'), false);
  assert.equal(view.tags.includes('input'), false);
});

test('ready view shows the complete script and speed choices before broadcast without a scroll container', async () => {
  const fullText = 'Это весь сценарий, который ведущий прочитает перед началом учебного эфира.';
  const tree = RadioScreen({
    state: { stage: 'ready', category: 'science', script: { category: 'science', title: 'Проверенный факт', text: fullText } },
    pending: null, connected: true, notice: '', countdown: null, speed: 'normal', paused: false,
  });
  const view = walk(tree);
  const text = view.text.join(' ');
  assert.match(text, /Научный факт/);
  assert.match(text, /Проверенный факт/);
  assert.match(text, new RegExp(fullText));
  assert.match(text, /Скорость телесуфлёра/);
  assert.match(text, /Медленно/);
  assert.match(text, /Обычно/);
  assert.match(text, /Быстро/);
  assert.match(text, /Начать эфир/);
  assert.ok(view.classes.includes('radio-ready-view'));
  const css = await readFile(new URL('./style.css', import.meta.url), 'utf8');
  assert.match(css, /\.studio-monitor-content \.radio-content\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(css, /@media\s*\(max-height:\s*430px\)[\s\S]*?\.studio-monitor-content \.radio-content\s*\{\s*overflow:\s*auto/s,
    'scroll остается адаптивным только для небольшого viewport');
});

test('live monitor renders only the current large teleprompter group, not the full script', () => {
  const fullText = 'Сегодня в нашем воображаемом городе солнечно. Лёгкий ветер качает деревья в парке.';
  const view = walk(RadioScreen({
    state: { stage: 'on_air', script: { category: 'weather', title: 'Погода', text: fullText } },
    pending: null, connected: true, notice: '', countdown: null,
    prompterGroup: 'Сегодня в нашем', speed: 'normal', paused: false,
  }));
  const text = view.text.join(' ');

  assert.match(text, /Сегодня в нашем/);
  assert.doesNotMatch(text, /воображаемом городе солнечно/);
  assert.match(text, /ON AIR/);
  assert.doesNotMatch(text, /Медленно|Обычно|Быстро/);
  assert.match(text, /Пауза/);
  assert.match(text, /Завершить эфир/);
});

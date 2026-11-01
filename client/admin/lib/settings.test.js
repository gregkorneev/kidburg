import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDraft, isDirty, customizedKeys, summarizeSettings, testErrorMessage, cloneSettings } from './settings.js';

const schema = [
  { key: 'enabled', kind: 'boolean', default: true },
  { key: 'displayName', kind: 'text', default: '' },
  { key: 'topics', kind: 'list', default: null },
  { key: 'temperature', kind: 'number', default: null },
  { key: 'verbosity', kind: 'enum', default: 'normal', labels: { brief: 'Кратко', normal: 'Обычно' } },
  { key: 'friendliness', kind: 'int', default: 3, max: 5 },
  { key: 'topicMode', kind: 'enum', default: 'open', labels: { open: 'Свободно' } },
];
const base = { enabled: true, displayName: '', topics: null, temperature: null, verbosity: 'normal', friendliness: 3, topicMode: 'open' };

test('normalizeDraft: пустые темы -> null, пробелы обрезаны', () => {
  const n = normalizeDraft({ ...base, topics: ['  ', ' огонь '], displayName: '  Аня ' }, schema);
  assert.deepEqual(n.topics, ['огонь']);
  assert.equal(n.displayName, 'Аня');
  assert.equal(normalizeDraft({ ...base, topics: [' '] }, schema).topics, null);
});

test('isDirty учитывает только содержательные отличия', () => {
  assert.equal(isDirty({ ...base, topics: [] }, base, schema), false);
  assert.equal(isDirty({ ...base, displayName: ' ' }, base, schema), false);
  assert.equal(isDirty({ ...base, friendliness: 4 }, base, schema), true);
  assert.equal(isDirty({ ...base, temperature: 0.5 }, base, schema), true);
});

test('customizedKeys, summarizeSettings, cloneSettings', () => {
  assert.deepEqual(customizedKeys({ ...base, verbosity: 'brief' }, schema), ['verbosity']);
  const s = summarizeSettings({ ...base, enabled: false }, schema);
  assert.equal(s[0].value, 'Выключен');
  assert.equal(s[1].value, 'Обычно');
  assert.equal(s[3].value, '3 из 5');
  const c = cloneSettings(base);
  c.topics = ['x'];
  assert.equal(base.topics, null);
});

test('testErrorMessage: понятные тексты для кодов Ollama', () => {
  assert.match(testErrorMessage({ code: 'unavailable' }), /Ollama недоступна/);
  assert.match(testErrorMessage({ code: 'model_missing' }), /Модель не загружена/);
  assert.match(testErrorMessage({ code: 'not_configured' }), /не настроена/);
  assert.equal(testErrorMessage({ code: 'x', message: 'Своё' }), 'Своё');
});

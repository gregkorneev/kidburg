import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const files = [
  'layout.js', 'station-art.js', 'scene.js', 'state.js', 'interactions.js', 'ui.js', 'style.css', 'preview.js',
  '../../bakery-preview.html',
];

test('новые файлы Bakery не содержат внешних URL', () => {
  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /https?:\/\//i, file);
  }
});

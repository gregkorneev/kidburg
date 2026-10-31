import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('автономный просмотрщик подключает локальную сцену и не содержит внешних ресурсов', async () => {
  const html = await readFile(new URL('./art-preview.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('./art-preview.js', import.meta.url), 'utf8');
  assert.match(html, /src="\.\/art-preview\.js"/);
  assert.doesNotMatch(html + script, /https?:\/\//i);
  for (const name of ['front', 'back', 'face', 'scene']) {
    assert.match(html, new RegExp(`data-view="${name}"`));
  }
});

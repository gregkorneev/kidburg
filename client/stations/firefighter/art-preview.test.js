import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('автономный просмотрщик подключает локальную сцену и не содержит внешних ресурсов', async () => {
  const html = await readFile(new URL('./art-preview.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('./art-preview.js', import.meta.url), 'utf8');
  assert.match(html, /src="\.\/art-preview\.js"/);
  assert.doesNotMatch(html + script, /https?:\/\//i);
  for (const name of ['front', 'side', 'back', 'face', 'npc', 'scene']) {
    assert.match(html, new RegExp(`data-view="${name}"`));
  }
  assert.match(html, /id="toggle-panel"/);
});

test('модель является автономным GLB с мешами и скелетом', async () => {
  const glb = await readFile(new URL('./model-source/firefighter.glb', import.meta.url));
  assert.equal(glb.toString('ascii', 0, 4), 'glTF');
  assert.equal(glb.readUInt32LE(4), 2);
  assert.equal(glb.readUInt32LE(8), glb.length);
  assert.equal(glb.toString('ascii', 16, 20), 'JSON');
  const model = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
  assert.ok(model.meshes?.length > 0);
  assert.ok(model.skins?.length > 0);
  assert.ok(model.skins[0].joints.length >= 6);
  assert.ok((model.buffers || []).every((buffer) => !buffer.uri));
  assert.ok((model.images || []).every((image) => !image.uri));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRadioStation } from './entry.js';

const radioDirectory = path.dirname(fileURLToPath(import.meta.url));
const clientDirectory = path.resolve(radioDirectory, '../..');

test('отдельная Radio HTML-страница входит в production build', async () => {
  const [html, vite] = await Promise.all([
    readFile(path.join(clientDirectory, 'radio-preview.html'), 'utf8'),
    readFile(path.resolve(clientDirectory, '../vite.config.js'), 'utf8'),
  ]);
  assert.match(html, /id="radio-app"/);
  assert.doesNotMatch(html, /id="app"|minimap|city-hud/i);
  assert.match(html, /stations\/radio\/entry\.js/);
  assert.match(vite, /radio:\s*page\('radio-preview\.html'\)/);
});

test('Radio entry dependency graph excludes city app, renderer, HUD, minimap, and roaming', async () => {
  const visited = new Set();
  const forbidden = /(?:^|\/)engine\/(?:app|chunks|remote|player|city-entrance)|(?:^|\/)main\.js$|(?:^|\/)ui\/(?:index|hud|minimap)/;
  async function visit(file) {
    const fullPath = path.resolve(radioDirectory, file);
    if (visited.has(fullPath)) return;
    visited.add(fullPath);
    const source = await readFile(fullPath, 'utf8');
    assert.doesNotMatch(fullPath, forbidden, `городской модуль загружен: ${fullPath}`);
    assert.doesNotMatch(source, /\b(?:createChunkManager|createHud|createRemotePlayers|createInput|createSkyline)\s*\(/,
      `городская подсистема запускается из ${fullPath}`);
    for (const [, , specifier] of source.matchAll(/(?:from\s*|import\s*\()(['"])(\.\.?\/[^'"]+)\1/g)) {
      const imported = path.resolve(path.dirname(fullPath), specifier);
      try {
        if ((await stat(imported)).isFile()) await visit(imported);
      } catch {
        if (await stat(`${imported}.js`).then(() => true, () => false)) await visit(`${imported}.js`);
      }
    }
  }
  await visit('entry.js');
  assert.ok([...visited].some((file) => file.endsWith('/stations/radio/scene.js')));
  assert.ok([...visited].some((file) => file.endsWith('/stations/radio/ui.js')));
  assert.ok([...visited].some((file) => file.endsWith('/stations/radio/tasks.js')));
});

test('production entry starts isolated Radio network and disposes it on exit', () => {
  const root = {};
  const handlers = new Map();
  const win = {
    addEventListener(type, listener) { handlers.set(type, listener); },
    removeEventListener(type, listener) { if (handlers.get(type) === listener) handlers.delete(type); },
  };
  const calls = { networkCreated: 0, started: 0, stopped: 0, previewOptions: null, unmounted: 0 };
  const api = { net: { status: 'open' } };
  const networkOptions = { previewBootstrap: false, session: { token: () => 'integration-token' } };
  const dispose = startRadioStation({
    root,
    window: win,
    networkOptions,
    networkFactory(options) {
      assert.equal(options, networkOptions, 'интегратор может передать существующую session');
      calls.networkCreated++;
      return { api, start() { calls.started++; }, stop() { calls.stopped++; } };
    },
    previewFactory(options) {
      calls.previewOptions = options;
      return () => { calls.unmounted++; };
    },
  });

  assert.equal(calls.networkCreated, 1, 'используется station-only network client');
  assert.equal(calls.previewOptions.root, root);
  assert.equal(calls.previewOptions.api, api);
  assert.equal(calls.started, 1);
  handlers.get('pagehide')({ persisted: true });
  assert.equal(calls.stopped, 0, 'страница в bfcache сохраняет runtime');
  handlers.get('pagehide')({ persisted: false });
  dispose();
  assert.equal(calls.unmounted, 1);
  assert.equal(calls.stopped, 1);
  assert.equal(handlers.size, 0);
});

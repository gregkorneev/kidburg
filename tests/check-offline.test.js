import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkOffline } from '../scripts/check-offline.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'offline-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('offline checker flags external runtime URLs and reports their source line', async (t) => {
  const root = await fixture(t);
  await mkdir(path.join(root, 'stations'), { recursive: true });
  await writeFile(path.join(root, 'index.html'), '<!-- https://comment.example -->\n<script src="https://cdn.example/game.js"></script>');
  await writeFile(path.join(root, 'stations', 'scene.css'), '.hero { background: url(//images.example/hero.png); }');
  const violations = await checkOffline(root);
  assert.deepEqual(violations, [
    { file: 'index.html', line: 2, url: 'https://cdn.example/game.js' },
    { file: 'stations/scene.css', line: 1, url: '//images.example/hero.png' },
  ]);
});

test('offline checker accepts local, data and blob references and ignores comments and test files', async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'main.js'), [
    '// fetch("https://comment.example/")',
    "const api = 'http://127.0.0.1:3000/api';",
    "const socket = new WebSocket('ws://localhost:3000/ws');",
    "const icon = 'data:image/svg+xml,<svg/>';",
    "const worker = URL.createObjectURL(new Blob(['self.close()']));",
  ].join('\n'));
  await writeFile(path.join(root, 'module.test.js'), "fetch('https://test-only.example/');");
  assert.deepEqual(await checkOffline(root), []);
});

test('offline checker flags external module imports and fetch calls in JavaScript strings', async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'main.js'), [
    "import 'https://cdn.example/module.js';",
    "fetch('https://api.example/data');",
  ].join('\n'));
  const violations = await checkOffline(root);
  assert.deepEqual(violations.map(({ line, url }) => [line, url]), [
    [1, 'https://cdn.example/module.js'],
    [2, 'https://api.example/data'],
  ]);
});


test('SVG namespace is allowed without allowing network requests to that address', async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'main.js'), [
    "const SVG = 'http://www.w3.org/2000/svg';",
    "document.createElementNS('http://www.w3.org/2000/svg', 'svg');",
    "fetch('http://www.w3.org/2000/svg');",
    "import 'https://cdn.example/module.js';",
  ].join('\n'));
  const violations = await checkOffline(root);
  assert.deepEqual(violations.map(({ line }) => line), [3, 4]);
});

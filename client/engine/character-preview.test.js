import test from 'node:test';
import assert from 'node:assert/strict';
import { createCharacterPreview } from './character-preview.js';
import { resolvePlayerAppearance } from './player-appearance.js';

test('preview renders the shared character with each selected avatar and releases it', () => {
  const frames = [];
  let removed = 0;
  let disposed = 0;
  const canvas = { remove() { removed++; } };
  const renderer = { domElement: canvas, setPixelRatio() {}, setSize() {}, render(scene) { frames.push(scene.children.find((child) => child.userData.look)); }, dispose() { disposed++; } };
  const container = { append(node) { assert.equal(node, canvas); } };
  const preview = createCharacterPreview(container, { createRenderer: () => renderer });
  const avatar = { skin: 3, clothes: 1, hair: 2, shoes: 0 };
  preview.setAvatar(avatar);
  assert.deepEqual(frames[0].userData.look, resolvePlayerAppearance({ id: 0, appearance: avatar }));
  for (const key of Object.keys(avatar)) {
    const next = { ...avatar, [key]: (avatar[key] + 1) % 4 };
    preview.setAvatar(next);
    assert.deepEqual(frames.at(-1).userData.look, resolvePlayerAppearance({ id: 0, appearance: next }));
  }
  preview.dispose();
  preview.dispose();
  preview.setAvatar(avatar);
  assert.equal(frames.length, 5);
  assert.equal(disposed, 1);
  assert.equal(removed, 1);
});

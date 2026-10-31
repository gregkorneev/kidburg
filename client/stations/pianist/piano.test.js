import test from 'node:test';
import assert from 'node:assert/strict';
import { createPiano } from './piano.js';

test('модель содержит восемь белых и пять чёрных интерактивных клавиш', () => {
  const piano = createPiano();
  assert.equal(piano.keys.size, 13);
  assert.equal([...piano.keys.values()].filter((key) => !key.userData.black).length, 8);
  assert.equal([...piano.keys.values()].filter((key) => key.userData.black).length, 5);
  assert.ok(piano.keys.get('C#4').position.x > piano.keys.get('C4').position.x);
  assert.ok(piano.keys.get('C#4').position.x < piano.keys.get('D4').position.x);
  const c = piano.keys.get('C4');
  const y = c.position.y;
  const material = c.material;
  assert.equal(piano.press('C4', true), true);
  assert.ok(c.position.y < y);
  assert.notEqual(c.material, material);
  piano.press('C4', false);
  assert.equal(c.position.y, y);
  assert.equal(c.material, material);
  piano.dispose();
  assert.equal(piano.keys.size, 0);
  assert.equal(piano.root.children.length, 0);
});

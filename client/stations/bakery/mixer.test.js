import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMixer } from './mixer.js';

test('тестомес плавно запускается и останавливается', () => {
  const mixer = createMixer();
  mixer.start();
  for (let i = 0; i < 180; i++) mixer.update(1 / 60);
  assert.ok(mixer.hook.rotation.y > 1);
  assert.ok(mixer.head.rotation.z < 0.01);
  for (let i = 0; i < 600; i++) mixer.update(1 / 60);
  const angle = mixer.hook.rotation.y;
  for (let i = 0; i < 60; i++) mixer.update(1 / 60);
  assert.ok(Math.abs(mixer.hook.rotation.y - angle) < 0.001);
  assert.ok(mixer.head.rotation.z > 0.3);
  mixer.dispose();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { characterForward, characterYawForPlayer, playerForward } from './orientation.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('визуальное лицо персонажа совпадает с направлением W при любом yaw', () => {
  for (const yaw of [0, Math.PI / 2, -Math.PI / 3, Math.PI * 0.82]) {
    const movement = playerForward(yaw);
    const facing = characterForward(yaw);
    close(facing.x, movement.x);
    close(facing.z, movement.z);
  }
});

test('S отступает назад, а A/D остаются боковым перемещением относительно взгляда', () => {
  const yaw = 0;
  const forward = playerForward(yaw);
  assert.deepEqual(forward, { x: -0, z: -1 });
  const visual = characterYawForPlayer(yaw);
  close(Math.sin(visual), forward.x);
  close(Math.cos(visual), forward.z);
});

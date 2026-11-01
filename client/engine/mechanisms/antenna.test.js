import test from 'node:test';
import assert from 'node:assert/strict';
import { createSatelliteDish, DISH_LIMITS } from './antenna.js';

test('антенна удерживает ограничения угла и скорости, затем освобождает ресурсы', () => {
  const dish = createSatelliteDish({ position: [0, 0, 0], beaconPosition: [0, 5, 0], seed: 34 });
  let previous = dish.pose;
  let moved = false;
  for (let i = 1; i <= 12000; i++) {
    dish.update(0.02, i * 0.02);
    const pose = dish.pose;
    assert.ok(pose.yaw >= DISH_LIMITS.yaw.min && pose.yaw <= DISH_LIMITS.yaw.max);
    assert.ok(pose.tilt >= DISH_LIMITS.tilt.min && pose.tilt <= DISH_LIMITS.tilt.max);
    assert.ok(Math.abs(pose.yaw - previous.yaw) / 0.02 <= DISH_LIMITS.maxSpeed + 1e-8);
    assert.ok(Math.abs(pose.tilt - previous.tilt) / 0.02 <= DISH_LIMITS.maxSpeed + 1e-8);
    moved ||= Math.abs(pose.yaw - previous.yaw) > 1e-8;
    previous = pose;
  }
  assert.ok(moved);
  dish.dispose();
  dish.dispose();
});

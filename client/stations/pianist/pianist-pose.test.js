import test from 'node:test';
import assert from 'node:assert/strict';
import { getPianoSeatPose, PIANIST_PLAYING_ARM_ANGLE, PIANIST_SEATED_LEG_ANGLE } from './pianist-pose.js';
import { PIANIST_PLAN } from './layout-plan.js';

test('игрок занимает банкетку перед учебным пианино лицом к клавишам', () => {
  assert.deepEqual(getPianoSeatPose(PIANIST_PLAN.practicePiano, 0), {
    x: PIANIST_PLAN.practicePiano.x, y: 0, z: PIANIST_PLAN.practicePiano.z + 1.05, yaw: 0,
  });
});

test('игрок занимает банкетку перед сценическим пианино с учётом поворота и высоты сцены', () => {
  const pose = getPianoSeatPose({ ...PIANIST_PLAN.stagePiano, y: 0.155 }, Math.PI);
  assert.ok(Math.abs(pose.x - PIANIST_PLAN.stagePiano.x) < 1e-9);
  assert.equal(pose.y, 0.155);
  assert.ok(Math.abs(pose.z - (PIANIST_PLAN.stagePiano.z - 1.05)) < 1e-9);
  assert.equal(pose.yaw, Math.PI);
});

test('сидячая поза наклоняет ноги вперёд, а руки к клавиатуре', () => {
  assert.ok(PIANIST_SEATED_LEG_ANGLE < 0);
  assert.ok(PIANIST_PLAYING_ARM_ANGLE < -1);
});

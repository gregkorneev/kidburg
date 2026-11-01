import test from 'node:test';
import assert from 'node:assert/strict';
import { getPianoSeatPose, PIANIST_PLAYING_ARM_ANGLE, PIANIST_SEATED_LEG_ANGLE } from './pianist-pose.js';
import { PIANIST_PLAN } from './layout-plan.js';

test('игрок занимает банкетку перед учебным пианино лицом к клавишам', () => {
  const pose = getPianoSeatPose(PIANIST_PLAN.practicePiano, PIANIST_PLAN.practicePiano.rotationY);
  assert.ok(Math.abs(pose.x - (PIANIST_PLAN.practicePiano.x - 1.05)) < 1e-9);
  assert.equal(pose.y, 0);
  assert.equal(pose.z, PIANIST_PLAN.practicePiano.z);
  assert.equal(pose.yaw, -Math.PI / 2);
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

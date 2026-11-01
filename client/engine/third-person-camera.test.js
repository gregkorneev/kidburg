import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_VISIBLE_ARM, createCameraArm, orbitCameraGoal } from './third-person-camera.js';

const focus = { x: 10, y: 1.45, z: 10 };
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('при yaw = 0 камера стоит позади игрока (+Z) и выше при взгляде вниз', () => {
  const goal = orbitCameraGoal(focus, 0, -0.3, 4.6);
  near(goal.x, 10);
  assert.ok(goal.z > focus.z + 4);
  assert.ok(goal.y > focus.y);
  near(Math.hypot(goal.x - focus.x, goal.y - focus.y, goal.z - focus.z), 4.6);
});

test('камера всегда позади направления взгляда при любом yaw', () => {
  for (const yaw of [0, 0.7, Math.PI / 2, Math.PI, -2.1]) {
    const goal = orbitCameraGoal(focus, yaw, 0, 5);
    const lookX = -Math.sin(yaw);
    const lookZ = -Math.cos(yaw);
    near((goal.x - focus.x) * lookX + (goal.z - focus.z) * lookZ, -5);
  }
});

test('взгляд вверх опускает камеру, взгляд вниз поднимает', () => {
  assert.ok(orbitCameraGoal(focus, 0, 0.3, 4).y < focus.y);
  assert.ok(orbitCameraGoal(focus, 0, -0.5, 4).y > focus.y);
});

test('без препятствий плечо равно желаемому', () => {
  const arm = createCameraArm({ distance: 4.6 });
  const goal = orbitCameraGoal(focus, 0, -0.2, 4.6);
  const position = arm.resolve(focus, goal, [], 1 / 60);
  near(position.z, goal.z);
  near(position.y, goal.y);
  near(arm.length, 4.6);
});

test('стена за спиной сразу приближает камеру, после неё камера плавно возвращается', () => {
  const arm = createCameraArm({ distance: 4.6 });
  const goal = orbitCameraGoal(focus, 0, -0.2, 4.6);
  const wall = { minX: 5, maxX: 15, minY: 0, maxY: 6, minZ: 12, maxZ: 12.4 };
  const blocked = arm.resolve(focus, goal, [wall], 1 / 60);
  assert.ok(blocked.z < wall.minZ - 0.2);
  assert.ok(arm.length < 2.5);
  const shortened = arm.length;
  arm.resolve(focus, goal, [], 1 / 60);
  assert.ok(arm.length > shortened && arm.length < 4.6);
  for (let i = 0; i < 180; i++) arm.resolve(focus, goal, [], 1 / 60);
  assert.ok(arm.length > 4.5);
});

test('камера не опускается под землю: плечо укорачивается до отступа над рельефом', () => {
  const arm = createCameraArm({ distance: 4.6, floorClearance: 0.25 });
  const goal = orbitCameraGoal(focus, 0, 0.5, 4.6); // взгляд вверх: камера ниже фокуса
  assert.ok(goal.y < 0);
  const position = arm.resolve(focus, goal, [], 1 / 60, () => 0);
  assert.ok(position.y >= 0.25 - 1e-6);
  assert.ok(arm.length < 4.6);
});

test('рельеф, поднимающийся к камере, тоже учитывается', () => {
  const arm = createCameraArm({ distance: 4.6 });
  const goal = orbitCameraGoal(focus, 0, -0.1, 4.6);
  const hill = (x, z) => (z > 12 ? 1.8 : 0);
  const position = arm.resolve(focus, goal, [], 1 / 60, hill);
  assert.ok(position.y >= hill(position.x, position.z) + 0.25 - 0.05);
  assert.ok(arm.length < 4.6);
});

test('reset возвращает нормальную длину плеча', () => {
  const arm = createCameraArm({ distance: 4.6 });
  const goal = orbitCameraGoal(focus, 0, 0, 4.6);
  arm.resolve(focus, goal, [{ minX: 5, maxX: 15, minY: 0, maxY: 6, minZ: 11, maxZ: 11.2 }], 1 / 60);
  assert.ok(arm.length < MIN_VISIBLE_ARM + 1);
  arm.reset();
  near(arm.length, 4.6);
});

test('очень близкая стена скрывает персонажа через MIN_VISIBLE_ARM', () => {
  const arm = createCameraArm({ distance: 4.6 });
  const goal = orbitCameraGoal(focus, 0, 0, 4.6);
  arm.resolve(focus, goal, [{ minX: 5, maxX: 15, minY: 0, maxY: 6, minZ: 10.45, maxZ: 10.7 }], 1 / 60);
  assert.ok(arm.length < MIN_VISIBLE_ARM);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SPEED, WORLD_SIZE_X } from '../../shared/constants.js';
import { PLAYER, collides, createPlayer, setPlayerPosition, stepPlayer } from './player.js';

const flat = (boxes = []) => ({ heightAt: () => 0, collidersNear: () => boxes });
const forward = { forward: true, back: false, left: false, right: false, run: false };

test('скорости клиента меньше серверного MAX_SPEED', () => {
  assert.ok(PLAYER.walkSpeed < PLAYER.runSpeed);
  assert.ok(PLAYER.runSpeed < MAX_SPEED);
});

test('движение вперёд при yaw = 0 идёт вдоль -Z, бег быстрее ходьбы', () => {
  const walker = createPlayer();
  setPlayerPosition(walker, 100, 0, 100);
  stepPlayer(walker, forward, 0.1, flat());
  assert.ok(Math.abs(walker.z - (100 - PLAYER.walkSpeed * 0.1)) < 1e-9);
  assert.equal(walker.x, 100);

  const runner = createPlayer();
  setPlayerPosition(runner, 100, 0, 100);
  stepPlayer(runner, { ...forward, run: true }, 0.1, flat());
  assert.ok(runner.z < walker.z);
  assert.equal(runner.running, true);
});

test('диагональ не быстрее прямого хода, strafe и yaw считаются верно', () => {
  const p = createPlayer();
  setPlayerPosition(p, 100, 0, 100);
  stepPlayer(p, { ...forward, right: true }, 0.1, flat());
  assert.ok(Math.abs(Math.hypot(p.x - 100, p.z - 100) - PLAYER.walkSpeed * 0.1) < 1e-9);
  assert.ok(p.x > 100 && p.z < 100);

  const turned = createPlayer();
  setPlayerPosition(turned, 100, 0, 100);
  turned.yaw = Math.PI / 2; // повёрнут налево: вперёд = -X
  stepPlayer(turned, forward, 0.1, flat());
  assert.ok(turned.x < 100 && Math.abs(turned.z - 100) < 1e-9);
});

test('длинный кадр ограничен: после паузы игрок не телепортируется', () => {
  const p = createPlayer();
  setPlayerPosition(p, 100, 0, 100);
  stepPlayer(p, forward, 5, flat());
  assert.ok(Math.abs(100 - p.z - PLAYER.walkSpeed * PLAYER.maxStep) < 1e-9);
});

test('коллизии: стена останавливает, вдоль стены игрок скользит', () => {
  const wall = { minX: 90, maxX: 110, minY: 0, maxY: 3, minZ: 94, maxZ: 96 };
  const p = createPlayer();
  setPlayerPosition(p, 100, 0, 97);
  for (let i = 0; i < 30; i++) stepPlayer(p, forward, 0.05, flat([wall]));
  assert.ok(p.z >= 96 + PLAYER.radius - 1e-9, `прошёл сквозь стену: z = ${p.z}`);

  const slider = createPlayer();
  setPlayerPosition(slider, 100, 0, 97);
  slider.yaw = Math.PI / 4; // вперёд-налево: упирается в стену, но уходит по X
  for (let i = 0; i < 10; i++) stepPlayer(slider, forward, 0.05, flat([wall]));
  assert.ok(slider.x < 100, 'скольжение вдоль стены');
  assert.ok(slider.z >= 96 + PLAYER.radius - 1e-9);

  assert.equal(collides([wall], 100, 5, 95), false, 'над препятствием можно пройти');
  assert.equal(collides([wall], 100, 0, 95), true);
});

test('высота берётся из рельефа, у границы мира игрок остаётся внутри', () => {
  const hill = { heightAt: (x) => x * 0.01, collidersNear: () => [] };
  const p = createPlayer();
  setPlayerPosition(p, 200, 0, 200);
  stepPlayer(p, { ...forward, right: true }, 0.1, hill);
  assert.ok(Math.abs(p.y - p.x * 0.01) < 1e-9);

  const edge = createPlayer();
  setPlayerPosition(edge, WORLD_SIZE_X + 50, 0, -20);
  assert.ok(edge.x < WORLD_SIZE_X && edge.z === 0);

  const unloaded = createPlayer();
  setPlayerPosition(unloaded, 10, 3, 10);
  stepPlayer(unloaded, forward, 0.1, { heightAt: () => null, collidersNear: () => [] });
  assert.equal(unloaded.y, 3, 'без данных о рельефе высота не меняется');
});

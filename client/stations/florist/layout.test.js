import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFloristLayout } from './layout.js';
import { FLORIST_PLAN, ROOM } from './layout-plan.js';
import { createInitialState, ORDER } from './state.js';
import { targetDistance, targetsForState } from './targets.js';
import { collides, createPlayer, stepPlayer } from '../../engine/player.js';
import { createCameraArm } from '../../engine/third-person-camera.js';
import { Vector3 } from 'three';
import { setCameraFocus } from './orientation.js';

test('интерьер безопасно освобождает вывески, цветы и геометрию', () => {
  const layout = buildFloristLayout();
  assert.equal(Object.keys(layout.buckets).length, 4);
  assert.equal(layout.setQuality('low'), 6);
  assert.equal(layout.setQuality('medium'), 11);
  assert.equal(layout.setQuality('high'), 16);
  assert.doesNotThrow(() => layout.dispose());
});

test('коллизии защищают мебель, вёдра и стены с отступом', () => {
  const layout = buildFloristLayout();
  for (const { x, z } of [...Object.values(FLORIST_PLAN.desks), ...Object.values(FLORIST_PLAN.buckets)]) {
    assert.ok(collides(layout.colliders, x, 0, z), `нет коллизии в ${x}, ${z}`);
  }
  for (const [x, z] of [[1, 7], [19, 7], [7, 1], [7, 14]]) {
    assert.ok(collides(layout.colliders, x, 0, z), `нет стены в ${x}, ${z}`);
  }
  assert.ok(!collides(layout.colliders, FLORIST_PLAN.spawn.x, 0, FLORIST_PLAN.spawn.z));
  layout.dispose();
});

test('к рабочему и упаковочному столам можно подойти и взаимодействовать с четырёх сторон', () => {
  const layout = buildFloristLayout();
  for (const key of ['workbench', 'wrapping']) {
    const desk = FLORIST_PLAN.desks[key];
    const target = { desk };
    const points = [[desk.x - desk.width / 2 - 0.65, desk.z], [desk.x + desk.width / 2 + 0.65, desk.z],
      [desk.x, desk.z - desk.depth / 2 - 0.65], [desk.x, desk.z + desk.depth / 2 + 0.65]];
    for (const [x, z] of points) {
      assert.ok(!collides(layout.colliders, x, 0, z), `${key}: подход заблокирован ${x}, ${z}`);
      assert.ok(targetDistance(target, x, z) < 1.72);
    }
  }
  layout.dispose();
});

test('блокеры камеры учитывают стены комнаты 20×15 и крупные столы, фасад остаётся открытым', () => {
  const layout = buildFloristLayout();
  assert.ok(layout.cameraBlockers.some((box) => box.minX === 0 && box.maxX === 0.3 && box.maxZ === ROOM.depth));
  assert.ok(layout.cameraBlockers.some((box) => box.minX === ROOM.width - 0.3 && box.maxX === ROOM.width));
  assert.ok(layout.cameraBlockers.some((box) => box.maxZ === ROOM.depth && box.minZ === ROOM.depth - 0.3));
  assert.ok(layout.cameraBlockers.some((box) => box.maxX === FLORIST_PLAN.desks.workbench.x + FLORIST_PLAN.desks.workbench.width / 2));
  assert.ok(!layout.cameraBlockers.some((box) => box.minZ === 0 && box.maxZ === 0.3));
  layout.dispose();
});

test('при ошибочном букете упаковка скрыта, остаётся исправление у стола', () => {
  const layout = buildFloristLayout();
  const invalid = { ...createInitialState(), stage: 'wrapping', stems: [
    { type: 'pink_tulip' }, { type: 'pink_tulip' }, { type: 'white_daisy' }, { type: 'white_daisy' }, { type: 'red_rose' },
  ] };
  const targets = targetsForState(invalid, layout);
  assert.deepEqual(targets.map(({ kind }) => kind), ['remove']);
  const valid = { ...invalid, stems: [...invalid.stems.slice(0, 4), { type: 'greenery' }] };
  assert.deepEqual(targetsForState(valid, layout).map(({ kind }) => kind).sort(), ['remove', 'wrap']);
  layout.dispose();
});

test('невидимый барьер останавливает бег у каждой стороны столов, камера остаётся снаружи', () => {
  const layout = buildFloristLayout();
  const keys = { forward: true, back: false, left: false, right: false, run: true };
  for (const desk of Object.values(FLORIST_PLAN.desks)) {
    for (const [dx, dz, yaw] of [[-1, 0, -Math.PI / 2], [1, 0, Math.PI / 2], [0, -1, Math.PI], [0, 1, 0]]) {
      const player = createPlayer();
      player.x = desk.x + dx * (desk.width / 2 + 1.4);
      player.z = desk.z + dz * (desk.depth / 2 + 1.4);
      player.yaw = yaw;
      if (collides(layout.colliders, player.x, 0, player.z)) continue;
      const world = { heightAt: () => 0, collidersNear: () => layout.colliders };
      for (let i = 0; i < 80; i++) stepPlayer(player, keys, 0.05, world);
      assert.ok(!collides(layout.colliders, player.x, 0, player.z));
      const gap = dx ? Math.abs(player.x - desk.x) - desk.width / 2 : Math.abs(player.z - desk.z) - desk.depth / 2;
      assert.ok(gap >= 0.6 - 1e-8, `персонаж проник в барьер: ${gap}`);
      const focus = setCameraFocus(new Vector3(), player);
      const arm = createCameraArm({ distance: Math.hypot(5.4, 1.45) });
      const camera = arm.resolve(focus, { x: player.x + dx * 4.8, y: 2.65, z: player.z + dz * 4.8 }, layout.cameraBlockers, 1 / 60);
      assert.ok(!layout.cameraBlockers.some((box) => camera.x > box.minX && camera.x < box.maxX && camera.y > box.minY && camera.y < box.maxY && camera.z > box.minZ && camera.z < box.maxZ));
    }
  }
  layout.dispose();
});

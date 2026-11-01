import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIENCE_CHAIRS, AUDIENCE_COLLIDERS, BETWEEN_PIANOS_CHAIRS, MAESTRO_COLLIDER, pianistGroundHeight, pianoCollider, PIANIST_PLAN, POSTER_MOUNTS, ROOM, ROOM_COLLIDERS, STAGE_COLLIDERS } from './layout-plan.js';
import { collides, createPlayer, stepPlayer } from '../../engine/player.js';
import { buildPianistLayout } from './layout.js';
import { approachCameraDistance, safeCameraDistance } from './camera-collision.js';
import { getPianoSeatPose } from './pianist-pose.js';

test('план комнаты 20×15×6 разделяет учебную, зрительскую и сценическую зоны', () => {
  assert.deepEqual(ROOM, { width: 20, depth: 15, height: 6 });
  for (const point of [PIANIST_PLAN.spawn, PIANIST_PLAN.maestro, PIANIST_PLAN.practicePiano, PIANIST_PLAN.stagePiano]) {
    assert.ok(point.x > 1 && point.x < 19 && point.z > 1 && point.z < 14);
  }
  assert.ok(PIANIST_PLAN.stage.minZ > PIANIST_PLAN.practicePiano.z);
  assert.ok(PIANIST_PLAN.practicePiano.x > PIANIST_PLAN.maestro.x);
  assert.equal(AUDIENCE_CHAIRS.length, 16);
  assert.equal(AUDIENCE_CHAIRS.filter(({ side }) => side === 'left').length, 8);
  assert.equal(AUDIENCE_CHAIRS.filter(({ side }) => side === 'right').length, 8);
  assert.equal(BETWEEN_PIANOS_CHAIRS.length, 4);
  assert.equal(BETWEEN_PIANOS_CHAIRS.filter(({ side }) => side === 'left').length, 2);
  assert.equal(BETWEEN_PIANOS_CHAIRS.filter(({ side }) => side === 'right').length, 2);
  assert.ok(BETWEEN_PIANOS_CHAIRS.every(({ z }) => z > PIANIST_PLAN.practicePiano.z && z < PIANIST_PLAN.stagePiano.z));
  assert.equal(PIANIST_PLAN.wallShelves.length, 2);
  assert.ok(PIANIST_PLAN.wallShelves.every(({ x, z }) => x < 1 && Math.hypot(x - PIANIST_PLAN.practicePiano.x, z - PIANIST_PLAN.practicePiano.z) > 5));
  const aisle = Math.min(...PIANIST_PLAN.audienceRightXs) - Math.max(...PIANIST_PLAN.audienceLeftXs) - 0.68;
  assert.ok(aisle >= 2, `центральный проход ${aisle.toFixed(2)} м`);
});

test('ступени дают последовательный подъём на сцену и блокируют обход высокого края', () => {
  const { stairs, stage } = PIANIST_PLAN;
  assert.equal(pianistGroundHeight(stairs.centerX, stairs.startZ + 0.1), 0.1);
  assert.equal(pianistGroundHeight(stairs.centerX, stairs.startZ + stairs.stepDepth + 0.1), 0.2);
  assert.ok(Math.abs(pianistGroundHeight(stairs.centerX, stairs.startZ + stairs.stepDepth * 2 + 0.1) - 0.3) < 1e-9);
  assert.equal(pianistGroundHeight(stairs.centerX, stage.minZ + 0.4), stage.height);
  assert.equal(pianistGroundHeight(2, stage.minZ + 0.4), 0);
  assert.equal(collides(STAGE_COLLIDERS, stairs.centerX, 0, stage.minZ), false);
  assert.equal(collides(STAGE_COLLIDERS, stage.minX, 0, stage.minZ + 0.3), true);
});

test('игрок может пройти по центральному проходу и подняться на сцену по ступеням', () => {
  const player = createPlayer();
  player.x = PIANIST_PLAN.stairs.centerX; player.z = PIANIST_PLAN.stairs.startZ - 0.65; player.yaw = Math.PI;
  for (let i = 0; i < 16 && player.z < PIANIST_PLAN.stage.minZ; i++) {
    stepPlayer(player, { forward: true, back: false, left: false, right: false, run: false }, 0.05, {
      heightAt: pianistGroundHeight,
      collidersNear: () => [...ROOM_COLLIDERS, ...AUDIENCE_COLLIDERS, ...STAGE_COLLIDERS],
    });
  }
  assert.ok(player.z >= PIANIST_PLAN.stage.minZ);
  assert.equal(player.y, PIANIST_PLAN.stage.height);
});

test('игрок не проходит сквозь Маэстро Артёма', () => {
  const player = createPlayer();
  player.x = MAESTRO_COLLIDER.minX - 0.6;
  player.z = PIANIST_PLAN.maestro.z;
  player.yaw = -Math.PI / 2;
  const layout = buildPianistLayout();
  const before = player.x;
  stepPlayer(player, { forward: true, back: false, left: false, right: false, run: false }, 0.1, {
    heightAt: pianistGroundHeight,
    collidersNear: () => layout.colliders,
  });
  assert.equal(player.x, before);
  assert.ok(collides(layout.colliders, PIANIST_PLAN.maestro.x, 0, PIANIST_PLAN.maestro.z));
  layout.dispose();
});

test('все музыкальные таблички закреплены на свободных участках боковых стен', () => {
  assert.equal(POSTER_MOUNTS.length, 4);
  for (const mount of POSTER_MOUNTS) {
    assert.ok(mount.x < 0.1 || mount.x > ROOM.width - 0.2);
    assert.ok(mount.z > 4.5 && mount.z < 6.0 || mount.z > 8.8 && mount.z < 10.2);
    assert.ok(Math.abs(Math.abs(mount.rotationY) - Math.PI / 2) < 1e-9);
  }
});

test('камера приближается к игроку перед стеной и мягко возвращается при освобождении', () => {
  const focus = { x: 10, y: 1.3, z: 9 };
  const desired = { x: 10, y: 2.4, z: 15 };
  const wall = { minX: 0, maxX: 20, minY: 0, maxY: 6, minZ: 14.8, maxZ: 15 };
  const blocked = safeCameraDistance(focus, desired, [wall]);
  assert.ok(blocked < Math.hypot(0, 1.1, 6));
  let distance = blocked;
  for (let i = 0; i < 50; i++) distance = approachCameraDistance(distance, 6.1, 1 / 60);
  assert.ok(distance > blocked && distance <= 6.1);
});

test('камера сокращает дистанцию перед зрительским стулом', () => {
  const chair = AUDIENCE_COLLIDERS[0];
  const focus = { x: (chair.minX + chair.maxX) / 2, y: 1.1, z: chair.minZ - 1 };
  const desired = { x: focus.x, y: focus.y, z: chair.maxZ + 1 };
  assert.ok(safeCameraDistance(focus, desired, [chair]) < Math.hypot(desired.x - focus.x, desired.y - focus.y, desired.z - focus.z));
});

test('ракурсы обоих пианино остаются вне корпуса и рядов стульев', () => {
  const { instrumentCamera } = PIANIST_PLAN;
  const practiceCollider = pianoCollider(PIANIST_PLAN.practicePiano, PIANIST_PLAN.practicePiano.rotationY);
  const stageCollider = pianoCollider({ ...PIANIST_PLAN.stagePiano, y: PIANIST_PLAN.stage.height }, Math.PI);
  const practiceFocus = { x: PIANIST_PLAN.practicePiano.x + Math.sin(PIANIST_PLAN.practicePiano.rotationY) * 1.2, y: 1.02, z: PIANIST_PLAN.practicePiano.z + Math.cos(PIANIST_PLAN.practicePiano.rotationY) * 1.2 };
  const practiceCamera = { x: PIANIST_PLAN.practicePiano.x + instrumentCamera.practice.x, y: 2.8, z: PIANIST_PLAN.practicePiano.z + instrumentCamera.practice.z };
  const stageFocus = { x: PIANIST_PLAN.stagePiano.x, y: 1.02 + PIANIST_PLAN.stage.height, z: PIANIST_PLAN.stagePiano.z - 1.2 };
  const stageCamera = { x: PIANIST_PLAN.stagePiano.x - instrumentCamera.concert.x, y: 2.8 + PIANIST_PLAN.stage.height, z: PIANIST_PLAN.stagePiano.z - instrumentCamera.concert.z };
  for (const [focus, camera] of [[practiceFocus, practiceCamera], [stageFocus, stageCamera]]) {
    const desiredDistance = Math.hypot(camera.x - focus.x, camera.y - focus.y, camera.z - focus.z);
    assert.ok(safeCameraDistance(focus, camera, [...AUDIENCE_COLLIDERS, practiceCollider, stageCollider], { radius: 0.2, clearance: 0.12 }) >= desiredDistance - 1e-6);
  }
});

test('периметр и стулья блокируют предметы, центральный проход и подход к пианино свободны', () => {
  assert.equal(collides(ROOM_COLLIDERS, 7.5, 0, 9.1), false);
  assert.equal(collides(AUDIENCE_COLLIDERS, 7.4, 0, PIANIST_PLAN.betweenPianosChairZ), true);
  assert.equal(collides(AUDIENCE_COLLIDERS, 7.4, 0, 9.35), true);
  assert.equal(collides(AUDIENCE_COLLIDERS, 10.8, 0, 8.5), false);
  assert.equal(collides(ROOM_COLLIDERS, 0.15, 0, 5), true);
  assert.equal(collides([...ROOM_COLLIDERS, ...AUDIENCE_COLLIDERS, ...STAGE_COLLIDERS], 4.2, 0, 7.55), false);
  assert.equal(collides([...ROOM_COLLIDERS, ...AUDIENCE_COLLIDERS, ...STAGE_COLLIDERS], 10.8, 0.3, 11.5), false);
});

test('коллизии закрывают корпус и клавиатурную сторону обоих пианино', () => {
  const practice = pianoCollider(PIANIST_PLAN.practicePiano, PIANIST_PLAN.practicePiano.rotationY);
  const stage = pianoCollider({ ...PIANIST_PLAN.stagePiano, y: PIANIST_PLAN.stage.height }, Math.PI);
  const practiceSeat = getPianoSeatPose(PIANIST_PLAN.practicePiano, PIANIST_PLAN.practicePiano.rotationY);
  const stageSeat = getPianoSeatPose({ ...PIANIST_PLAN.stagePiano, y: PIANIST_PLAN.stage.height }, Math.PI);
  assert.equal(collides([practice], practiceSeat.x, practiceSeat.y, practiceSeat.z), false, 'ученик сидит на банкетке, снаружи корпуса');
  assert.equal(collides([stage], stageSeat.x, stageSeat.y, stageSeat.z), false, 'пианист на сцене сидит снаружи корпуса');
  assert.equal(collides([practice], 14.5, 0, PIANIST_PLAN.practicePiano.z), true);
  assert.equal(collides([practice], 13.7, 0, PIANIST_PLAN.practicePiano.z), false);
  assert.equal(collides([stage], PIANIST_PLAN.stagePiano.x, PIANIST_PLAN.stage.height, 12.2), true);
  assert.equal(collides([stage], PIANIST_PLAN.stagePiano.x, PIANIST_PLAN.stage.height, 11.25), false);

  const player = createPlayer();
  player.x = 13.6; player.z = PIANIST_PLAN.practicePiano.z; player.yaw = -Math.PI / 2;
  stepPlayer(player, { forward: true, back: false, left: false, right: false, run: false }, 0.1, {
    heightAt: pianistGroundHeight, collidersNear: () => [practice],
  });
  assert.equal(player.x, 13.6, 'игрок не проходит с банкетной стороны в учебное пианино');

  player.x = PIANIST_PLAN.stagePiano.x; player.z = 11.1; player.y = PIANIST_PLAN.stage.height; player.yaw = Math.PI;
  stepPlayer(player, { forward: true, back: false, left: false, right: false, run: false }, 0.1, {
    heightAt: pianistGroundHeight, collidersNear: () => [stage],
  });
  assert.equal(player.z, 11.1, 'игрок не проходит с банкетной стороны в сценическое пианино');
});

test('интерьер создаётся без DOM и освобождает геометрию, материалы и локальные текстуры', () => {
  const layout = buildPianistLayout();
  assert.equal(layout.root.getObjectByName('audience-chairs').children.length, 20);
  assert.ok(layout.root.getObjectByName('instrument-display'));
  assert.equal(layout.root.getObjectByName('music-stands'), undefined);
  for (let i = 0; i < BETWEEN_PIANOS_CHAIRS.length; i++) assert.ok(layout.root.getObjectByName(`between-pianos-chair-${i + 1}`));
  for (let i = 0; i < POSTER_MOUNTS.length; i++) assert.ok(layout.root.getObjectByName(`music-poster-${i}`));
  assert.ok(layout.colliders.length >= ROOM_COLLIDERS.length + AUDIENCE_CHAIRS.length + BETWEEN_PIANOS_CHAIRS.length + STAGE_COLLIDERS.length);
  const geometries = []; const materials = []; const textures = [];
  layout.root.traverse((node) => {
    if (!node.isMesh) return;
    geometries.push(node.geometry);
    const materialList = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materialList) { materials.push(material); if (material.map) textures.push(material.map); }
  });
  assert.ok(geometries.length < 100, `static geometry should be merged; found ${geometries.length} meshes`);
  let geometryDisposals = 0; let materialDisposals = 0; let textureDisposals = 0;
  geometries.forEach((geometry) => geometry.addEventListener('dispose', () => geometryDisposals++));
  materials.forEach((material) => material.addEventListener('dispose', () => materialDisposals++));
  textures.forEach((texture) => texture.addEventListener('dispose', () => textureDisposals++));
  layout.dispose();
  assert.equal(geometryDisposals, geometries.length);
  assert.equal(materialDisposals, materials.length);
  assert.equal(textureDisposals, textures.length);
  assert.equal(layout.root.children.length, 0);
});

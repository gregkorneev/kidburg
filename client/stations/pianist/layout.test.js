import test from 'node:test';
import assert from 'node:assert/strict';
import { ROOM, PIANIST_PLAN, ROOM_COLLIDERS } from './layout-plan.js';
import { collides } from '../../engine/player.js';
import { buildPianistLayout } from './layout.js';
import { approachCameraDistance, safeCameraDistance } from './camera-collision.js';

test('план комнаты 20×15×6, точки игры внутри помещения и зона сцены впереди аудитории', () => {
  assert.deepEqual(ROOM, { width: 20, depth: 15, height: 6 });
  for (const point of [PIANIST_PLAN.spawn, PIANIST_PLAN.maestro, PIANIST_PLAN.practicePiano, PIANIST_PLAN.stagePiano]) {
    assert.ok(point.x > 1 && point.x < 19 && point.z > 1 && point.z < 14);
  }
  assert.ok(PIANIST_PLAN.stage.minZ > PIANIST_PLAN.practicePiano.z);
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

test('периметр блокирует выход, а бывшая зона зрителей и центральная дорожка свободны', () => {
  assert.equal(collides(ROOM_COLLIDERS, 7.5, 0, 9.1), false);
  assert.equal(collides(ROOM_COLLIDERS, 0.15, 0, 5), true);
  assert.equal(collides(ROOM_COLLIDERS, 10.8, 0, 9.7), false);
  assert.equal(collides(ROOM_COLLIDERS, 10.8, 0, 5.8), false);
});

test('интерьер создаётся без DOM и освобождает геометрию, материалы и локальные текстуры', () => {
  const layout = buildPianistLayout();
  assert.equal(layout.root.getObjectByName('audience-seats'), undefined);
  const geometries = []; const materials = []; const textures = [];
  layout.root.traverse((node) => {
    if (!node.isMesh) return;
    geometries.push(node.geometry);
    const materialList = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materialList) { materials.push(material); if (material.map) textures.push(material.map); }
  });
  assert.ok(geometries.length < 60, `static geometry should be merged; found ${geometries.length} meshes`);
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

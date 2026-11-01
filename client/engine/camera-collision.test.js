import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { approachCameraDistance, safeCameraDistance } from './camera-collision.js';

const point = (x, y, z) => new THREE.Vector3(x, y, z);
const wallBehind = { minX: 7, maxX: 13, minY: 0, maxY: 6, minZ: 12, maxZ: 12.3 };

test('без препятствий сохраняет стандартное расстояние камеры', () => {
  const focus = point(10, 1.2, 10);
  const desired = point(10, 2.65, 15);
  assert.ok(Math.abs(safeCameraDistance(focus, desired, []) - focus.distanceTo(desired)) < 1e-10);
});

test('стена позади ограничивает длину камеры с учётом радиуса и отступа', () => {
  const focus = point(10, 1.2, 10);
  const desired = point(10, 2.65, 15);
  const distance = safeCameraDistance(focus, desired, [wallBehind]);
  assert.ok(distance < focus.distanceTo(desired));
  const camera = focus.clone().lerp(desired, distance / focus.distanceTo(desired));
  assert.ok(camera.z < wallBehind.minZ - 0.2);
});

test('после исчезновения препятствия камера плавно возвращается на стандартный план', () => {
  const focus = point(10, 1.2, 10);
  const desired = point(10, 2.65, 15);
  const blocked = safeCameraDistance(focus, desired, [wallBehind]);
  const standard = safeCameraDistance(focus, desired, []);
  let current = blocked;
  let previous = current;
  for (let frame = 0; frame < 60; frame++) {
    current = approachCameraDistance(current, standard, 1 / 60);
    assert.ok(current >= previous);
    previous = current;
  }
  assert.ok(current > standard - 0.12);
  assert.equal(approachCameraDistance(standard, blocked, 1 / 60), blocked);
});

test('две стены в углу ограничивают диагональную камеру до обеих плоскостей', () => {
  const focus = point(10, 1.4, 10);
  const desired = point(15, 2.8, 15);
  const corner = [
    { minX: 12.2, maxX: 12.5, minY: 0, maxY: 6, minZ: 8, maxZ: 15 },
    { minX: 8, maxX: 15, minY: 0, maxY: 6, minZ: 12.2, maxZ: 12.5 },
  ];
  const distance = safeCameraDistance(focus, desired, corner);
  const camera = focus.clone().lerp(desired, distance / focus.distanceTo(desired));
  assert.ok(distance < focus.distanceTo(desired));
  for (const box of corner) {
    const insideExpandedBox = camera.x >= box.minX - 0.22 && camera.x <= box.maxX + 0.22
      && camera.y >= box.minY - 0.22 && camera.y <= box.maxY + 0.22
      && camera.z >= box.minZ - 0.22 && camera.z <= box.maxZ + 0.22;
    assert.equal(insideExpandedBox, false);
  }
});

test('вращение на 360° проверяет блокеры в направлении камеры', () => {
  const focus = point(10, 1.2, 10);
  const eastWall = { minX: 12, maxX: 12.3, minY: 0, maxY: 6, minZ: 5, maxZ: 15 };
  const full = 5;
  const distances = Array.from({ length: 36 }, (_, index) => {
    const yaw = index * (Math.PI * 2 / 36);
    const desired = point(focus.x + Math.cos(yaw) * full, focus.y, focus.z + Math.sin(yaw) * full);
    return safeCameraDistance(focus, desired, [eastWall]);
  });
  assert.ok(distances[0] < full);
  assert.equal(distances[18], full);
  assert.ok(distances.every((distance) => Number.isFinite(distance) && distance <= full + 1e-9));
});

test('геометрия персонажа не становится блокером собственной камеры', () => {
  const focus = point(0, 1.2, 0);
  const desired = point(0, 2.65, -5);
  const characterMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.5), new THREE.MeshBasicMaterial());
  characterMesh.position.set(0, 1, -0.6);
  const distance = safeCameraDistance(focus, desired, []);
  assert.ok(Math.abs(distance - focus.distanceTo(desired)) < 1e-10);
  characterMesh.geometry.dispose();
  characterMesh.material.dispose();
});

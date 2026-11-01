import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PLAZA } from '../../tools/build-world/layout.js';
import { AnimalNpc, ANIMAL_SPECS, animalPointClear, createPlazaAnimals, CALM_DISTANCE } from './plaza-animals.js';

test('four independent animals and disposal', () => {
  const scene = new THREE.Scene(); const manager = createPlazaAnimals({ scene, random: () => 0.3 });
  assert.deepEqual(manager.animals.map((a) => a.npc.type), ['cat', 'cat', 'dog', 'dog']);
  assert.equal(scene.children.length, 4);
  let disposed = 0; const v = manager.animals[0].visual;
  v.geometries[0].addEventListener('dispose', () => disposed++);
  manager.update(0.05, null);
  assert.notEqual(manager.animals[0].npc.x, manager.animals[1].npc.x);
  manager.dispose(); assert.equal(scene.children.length, 0); assert.equal(disposed, 1);
});
test('wander moves toward a target and clamps dt', () => {
  const n = new AnimalNpc(ANIMAL_SPECS[0], () => 0.3);
  assert.ok(animalPointClear(n.x, n.z));
  n.target = { x: n.x + 0.5, z: n.z }; n.timer = 10;
  const x = n.x; n.update(10, null); assert.ok(n.x > x); assert.ok(n.x - x <= n.walkSpeed * 0.05 + 1e-9);
  n.x = n.target.x; n.z = n.target.z; n.update(0.05, null); assert.equal(n.target, null); assert.ok(n.pause > 0);
});
test('flee increases distance and uses hysteresis', () => {
  const n = new AnimalNpc(ANIMAL_SPECS[0]);
  const p = { x: PLAZA.x + n.x - 1, z: PLAZA.z + n.z };
  const before = Math.hypot(PLAZA.x + n.x - p.x, PLAZA.z + n.z - p.z);
  n.update(0.05, p); assert.equal(n.mode, 'flee');
  assert.ok(Math.hypot(PLAZA.x + n.x - p.x, PLAZA.z + n.z - p.z) > before);
  assert.ok(n.fleeSpeed > n.walkSpeed);
  n.update(0.05, { x: PLAZA.x + n.x - 4, z: PLAZA.z + n.z }); assert.equal(n.mode, 'flee');
  n.update(0.05, { x: PLAZA.x + n.x - CALM_DISTANCE - 1, z: PLAZA.z + n.z }); assert.equal(n.mode, 'wander');
});
test('long wandering stays inside permitted area', () => {
  for (const spec of ANIMAL_SPECS) {
    const n = new AnimalNpc(spec); assert.ok(animalPointClear(n.x, n.z));
    for (let i = 0; i < 12000; i++) { n.update(0.05, null); assert.ok(animalPointClear(n.x, n.z)); if (n.target) assert.ok(animalPointClear(n.target.x, n.target.z)); }
  }
});

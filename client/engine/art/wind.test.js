import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyWindShadows, wind, windDisplacement, windMaterial } from './wind.js';

const state = { strength: 0.8, gustiness: 0.6, dirX: 0.6, dirZ: 0.8, time: 2.3, detail: 1 };

test('CPU wind is zero at the base and in calm conditions', () => {
  assert.deepEqual(windDisplacement('flower', 2, 4, 0, state), { x: 0, y: 0, z: 0 });
  assert.deepEqual(windDisplacement('flower', 2, 4, 0.5, { ...state, strength: 0, gustiness: 0 }), { x: 0, y: 0, z: 0 });
});

test('CPU wind includes flower tilt, leaf flutter, and radial tree response', () => {
  const flower = windDisplacement('flower', 2, 4, 0.5, state);
  const lowDetailFlower = windDisplacement('flower', 2, 4, 0.5, { ...state, detail: 0 });
  assert.ok(Number.isFinite(flower.y));
  assert.notEqual(flower.y, 0);
  assert.notDeepEqual(flower, lowDetailFlower);

  const trunk = windDisplacement('tree-round', 3, -2, 5.5, state);
  const branch = windDisplacement('tree-round', 3, -2, 5.5, state, { x: 2, z: 0 });
  assert.ok(Math.hypot(branch.x, branch.z) > Math.hypot(trunk.x, trunk.z));
});

test('all wind shadow materials use the same deformation shader and uniforms', () => {
  const mesh = applyWindShadows(new THREE.Mesh(new THREE.BufferGeometry(), windMaterial('bush')));
  assert.equal(mesh.customDepthMaterial.userData.windProfile, 'bush');
  assert.equal(mesh.customDistanceMaterial.userData.windProfile, 'bush');

  for (const material of [mesh.material, mesh.customDepthMaterial, mesh.customDistanceMaterial]) {
    const shader = { uniforms: {}, vertexShader: '#include <common>\nvoid main(){\n#include <begin_vertex>\n}' };
    material.onBeforeCompile(shader);
    assert.match(shader.vertexShader, /windBend/);
    assert.match(shader.vertexShader, /windJitter/);
    assert.strictEqual(shader.uniforms.uWindTime, wind.uniforms.uWindTime);
  }
});

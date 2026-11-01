import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SEATED_BENCHES, SeatedNpc, createPlazaSeatedNpcs } from './plaza-seated-npcs.js';

const playerAt = (npc, distance) => ({ x: npc.x + distance, z: npc.z, y: 0 });

test('two NPCs use separate benches and stay seated in place', () => {
  const scene = new THREE.Scene();
  const manager = createPlazaSeatedNpcs({ scene, quality: 'low' });
  assert.equal(manager.npcs.length, 2);
  assert.equal(scene.children.length, 2);
  assert.notEqual(SEATED_BENCHES[0], SEATED_BENCHES[1]);
  assert.notEqual(SEATED_BENCHES[0].sector, SEATED_BENCHES[1].sector);
  for (const { npc, person } of manager.npcs) {
    const position = person.position.clone();
    manager.update(0.05, playerAt(npc, 1), 1);
    assert.ok(person.position.equals(position));
    assert.equal(person.userData.legs[0].pivot.rotation.x, -Math.PI / 2);
    assert.equal(person.userData.legs[0].knee.rotation.x, Math.PI / 2);
  }
  let disposed = 0;
  const ownedGeometry = new THREE.BoxGeometry();
  ownedGeometry.addEventListener('dispose', () => { disposed++; });
  manager.npcs[0].person.add(new THREE.Mesh(ownedGeometry, new THREE.MeshBasicMaterial()));
  manager.dispose();
  assert.equal(scene.children.length, 0);
  assert.ok(disposed > 0);
});

test('wave triggers once on entry and resets only past outer radius', () => {
  const npc = new SeatedNpc(SEATED_BENCHES[0]);
  const start = { x: npc.x, z: npc.z };
  assert.equal(npc.update(0.1, playerAt(npc, 7)), false);
  assert.equal(npc.state, 'idle');
  assert.equal(npc.update(0.1, playerAt(npc, 3)), true);
  assert.equal(npc.state, 'wave');
  for (let i = 0; i < 30; i++) assert.equal(npc.update(0.1, playerAt(npc, 4.5)), false);
  assert.equal(npc.state, 'idle'); assert.equal(npc.waveCount, 1); assert.equal(npc.nearby, true);
  npc.update(0.1, playerAt(npc, 6.1)); assert.equal(npc.nearby, false);
  assert.equal(npc.update(0.1, playerAt(npc, 3)), true);
  assert.equal(npc.waveCount, 2); assert.equal(npc.state, 'wave');
  assert.deepEqual({ x: npc.x, z: npc.z }, start);
});

test('leaving during wave stops it without retriggering', () => {
  const scene = new THREE.Scene(); const manager = createPlazaSeatedNpcs({ scene, quality: 'low' });
  const { npc, person } = manager.npcs[0];
  manager.update(0.05, playerAt(npc, 1), 0);
  assert.equal(person.userData.anim.gesture, 'wave');
  manager.update(0.05, playerAt(npc, 7), 0.05);
  assert.equal(npc.state, 'idle'); assert.equal(person.userData.anim.gesture, null);
  manager.dispose();
});

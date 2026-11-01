import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrefabKit } from '../../engine/art/prefab-kit.js';
import * as THREE from 'three';
import { addPastry, addPastryDisplays } from './patisserie.js';

test('изделия имеют различимую геометрию и помещаются на полках', () => {
  const types = ['croissant', 'donut', 'cupcake', 'cake', 'macaron', 'baguette', 'roll', 'brownie'];
  const counts = new Set();
  for (const type of types) {
    const kit = createPrefabKit({ tint: 0 });
    addPastry(kit, type, 0, 0, 0);
    const geometry = kit.build({ groundAO: null, underside: 1 });
    geometry.computeBoundingBox();
    const { min, max } = geometry.boundingBox;
    assert.ok(min.y >= -0.001 && max.y <= 0.4, `${type}: высота`);
    assert.ok(min.x >= -0.3 && max.x <= 0.3 && min.z >= -0.3 && max.z <= 0.3, `${type}: габариты`);
    counts.add(geometry.attributes.position.count);
    geometry.dispose();
  }
  assert.ok(counts.size >= 7, 'разные виды не являются перекрашенными копиями');
});

test('декоративная выпечка не закрывает место игрового хлеба', () => {
  const kit = createPrefabKit({ tint: 0 });
  addPastryDisplays(kit);
  const geometry = kit.build({ groundAO: null, underside: 1 });
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  for (const [x, z, length] of [[4.56, 4.78, 0.98], [-3.24, 5.53, 0.98]]) {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 1.78, z), new THREE.Vector3(1, 0, 0), 0, length);
    assert.equal(ray.intersectObject(mesh).length, 0);
  }
  geometry.dispose();
  material.dispose();
});

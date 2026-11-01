import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPrefabKit } from './prefab-kit.js';
import { TREE_BUILDERS, TREE_VARIANTS, bin, bush, flower, infoStand, lampPost, picketFence, planterBox, rock, signpost } from './flora.js';
import { swayMaterial } from './wind.js';

const sane = (g) => {
  assert.equal(g.index, null, 'без индекса');
  assert.deepEqual(Object.keys(g.attributes).sort(), ['color', 'normal', 'position']);
  g.computeBoundingBox();
  assert.ok(g.boundingBox.min.y >= -0.12, `ниже земли: ${g.boundingBox.min.y}`); // валуны чуть вросшие в землю
  assert.ok(Number.isFinite(g.boundingBox.max.y));
};

test('кит префабов: коробка, цилиндр, лента и lathe с фазой собираются в одну геометрию', () => {
  const k = createPrefabKit({ seed: 3 });
  k.slab(2, 1, 2, 0, 0, 0, 0xffffff, { r: 0.1 });
  k.cyl(0.5, 0.6, 1, 8, 3, 0.5, 0, 0xff0000);
  k.lathe([[1, 0], [1, 0.5], [0.5, 0.5]], 8, -3, 0.1, 0, 0x00ff00, { phiStart: 0.5, phiLength: 1.5 });
  k.flatShape([[0, 0], [1, 0], [1, 1]], 0.1, 0.02, 0x0000ff);
  const g = k.build();
  sane(g);
  assert.ok(g.attributes.position.count > 100);
});

test('растения и мебель: каждая деталь строится без индекса и не уходит под землю', () => {
  for (const type of TREE_VARIANTS) sane(TREE_BUILDERS[type]());
  const k = createPrefabKit({ seed: 5 });
  bush(k, 0, 0);
  flower(k, 1, 0, 0, 0xff88aa);
  planterBox(k, 2, 0, 0.3);
  lampPost(k, 4, 0);
  bin(k, 5, 0);
  signpost(k, 6, 0);
  infoStand(k, 8, 0);
  picketFence(k, 10, 0, 14, 0);
  rock(k, 16, 0);
  k.bench(18, 0, 0.5);
  sane(k.build());
});

test('скамья сохраняет форму при повороте и спинка соединена с сиденьем', () => {
  const make = (angle) => {
    const k = createPrefabKit({ tint: 0 });
    k.bench(0, 0, angle);
    return k.build().attributes.position;
  };
  const straight = make(0);
  const angle = 0.8;
  const rotated = make(angle);
  const point = new THREE.Vector3();
  for (let i = 0; i < straight.count; i++) {
    point.fromBufferAttribute(straight, i).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    assert.ok(point.distanceTo(new THREE.Vector3().fromBufferAttribute(rotated, i)) < 1e-6);
  }
  const backBottom = Math.min(...Array.from({ length: 36 }, (_, i) => straight.getY(36 + i)));
  assert.ok(backBottom <= 0.55, 'спинка должна соединяться с сиденьем');
});

test('ветер: материал общий для одинаковой силы и помечен как shared', () => {
  const a = swayMaterial(0.05);
  assert.equal(a, swayMaterial(0.05));
  assert.notEqual(a, swayMaterial(0.1));
  assert.ok(a.userData.shared && a.vertexColors);
});

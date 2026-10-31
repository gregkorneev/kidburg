import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { disposeFlower, createFlower, createWrapping, disposeWrapping } from './flowers.js';

test('четыре вида цветов имеют отдельные модели с геометрией', () => {
  const flowers = ['pink_tulip', 'white_daisy', 'red_rose', 'greenery'].map((type) => createFlower(type));
  assert.equal(new Set(flowers.map((flower) => flower.userData.flower.type)).size, 4);
  assert.ok(flowers.every((flower) => flower.children.length === 1));
  assert.ok(flowers.every((flower) => flower.userData.ownedGeometries.size === 1));
  assert.ok(flowers.every((flower) => flower.children[0].geometry.getAttribute('position').count > 180));
  flowers.forEach(disposeFlower);
});

test('геометрия цветка и упаковки освобождается при удалении', () => {
  const flower = createFlower('pink_tulip');
  const flowerGeometries = [...flower.userData.ownedGeometries];
  const flowerDisposed = new Set();
  flowerGeometries.forEach((geometry) => geometry.addEventListener('dispose', () => flowerDisposed.add(geometry)));
  disposeFlower(flower);
  assert.equal(flowerDisposed.size, flowerGeometries.length);

  const bouquet = new THREE.Group();
  const wrapping = createWrapping(bouquet, 'pink');
  const wrapGeometries = [...wrapping.userData.ownedGeometries];
  const wrapDisposed = new Set();
  wrapGeometries.forEach((geometry) => geometry.addEventListener('dispose', () => wrapDisposed.add(geometry)));
  disposeWrapping(wrapping);
  assert.equal(wrapDisposed.size, wrapGeometries.length);
});

test('неизвестный тип цветка отклоняется', () => {
  assert.throws(() => createFlower('sunflower'), /Неизвестный вид цветка/);
});

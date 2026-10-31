import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bouquetStemTransform, disposeFlower, createFlower, createWrapping, disposeWrapping } from './flowers.js';

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

test('бумага образует широкий открытый конус из трёх листов, стянутый лентой', () => {
  const bouquet = new THREE.Group();
  const wrapping = createWrapping(bouquet, 'pink');
  const paper = wrapping.userData.paperMesh;
  assert.equal(paper.name, 'three-overlapping-paper-sheets');
  assert.equal(wrapping.userData.paperSheetCount, 3);
  assert.equal(paper.material.vertexColors, true);

  const positions = paper.geometry.getAttribute('position');
  let lowRadius = 0;
  let highRadius = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    const radius = Math.hypot(x, z);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    if (y < 0.05) lowRadius = Math.max(lowRadius, radius);
    if (y > 0.94) highRadius = Math.max(highRadius, radius);
  }
  assert.ok(minY >= 0.03 && maxY > 0.98);
  assert.ok(highRadius > lowRadius * 4, `expected flared top (${highRadius}) around narrow base (${lowRadius})`);
  assert.equal(wrapping.children.filter((child) => child.name === 'bouquet-ribbon-band').length, 1);
  assert.equal(wrapping.children.filter((child) => child.name === 'ribbon-bow-loop').length, 2);
  disposeWrapping(wrapping);
});

test('бантик крупно закреплён спереди, лента и бант меняют цвет во всех вариантах', () => {
  const colors = new Set();
  for (const ribbon of ['pink', 'yellow', 'blue']) {
    const bouquet = new THREE.Group();
    const wrapping = createWrapping(bouquet, ribbon);
    const band = wrapping.children.find((child) => child.name === 'bouquet-ribbon-band');
    const loops = wrapping.children.filter((child) => child.name === 'ribbon-bow-loop');
    const tails = wrapping.children.filter((child) => child.name === 'ribbon-tail');
    const knot = wrapping.children.find((child) => child.name === 'ribbon-bow-knot');

    assert.equal(loops.length, 2);
    assert.equal(tails.length, 2);
    assert.ok(loops.every((loop) => {
      const vertices = loop.geometry.getAttribute('position');
      const xs = Array.from({ length: vertices.count }, (_, index) => vertices.getX(index));
      const ys = Array.from({ length: vertices.count }, (_, index) => vertices.getY(index));
      return loop.position.z > 0.5 && vertices.count === 7
        && Math.max(...ys) - Math.min(...ys) > 0.28
        && Math.max(...xs.map(Math.abs)) > 0.3;
    }));
    assert.ok(tails.every((tail) => {
      const vertices = tail.geometry.getAttribute('position');
      const ys = Array.from({ length: vertices.count }, (_, index) => vertices.getY(index));
      const zs = Array.from({ length: vertices.count }, (_, index) => vertices.getZ(index));
      return Math.min(...ys) < 0.18 && Math.max(...ys) > 0.55 && Math.min(...zs) > 0.2;
    }));
    assert.ok(knot.position.z > 0.6);
    assert.ok(band.geometry.parameters.radiusTop > 0.45);
    colors.add(band.material.color.getHexString());
    assert.ok(loops.every((loop) => loop.material === band.material));
    assert.ok(tails.every((tail) => tail.material === band.material));
    disposeWrapping(wrapping);
  }
  assert.equal(colors.size, 3);
});

test('в упакованном букете основания сходятся плотнее, а бутоны расходятся естественно', () => {
  const count = 5;
  const loose = Array.from({ length: count }, (_, index) => bouquetStemTransform(index, count));
  const packed = Array.from({ length: count }, (_, index) => bouquetStemTransform(index, count, true));
  const looseRadius = Math.max(...loose.map(({ position: [x, , z] }) => Math.hypot(x, z)));
  const packedRadius = Math.max(...packed.map(({ position: [x, , z] }) => Math.hypot(x, z)));
  assert.ok(packedRadius < looseRadius * 0.35);
  assert.ok(new Set(packed.map(({ rotation }) => rotation.map((value) => value.toFixed(3)).join(','))).size > 1);
});

test('неизвестный тип цветка отклоняется', () => {
  assert.throws(() => createFlower('sunflower'), /Неизвестный вид цветка/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildBakeryInteriorGeometry, createBakeryInterior } from './station-art.js';

test('интерьер: vertex colors, bounding box и отдельная геометрия мелких деталей', () => {
  const base = buildBakeryInteriorGeometry({ detail: false });
  const detailed = buildBakeryInteriorGeometry({ detail: true, includeBase: false });
  base.computeBoundingBox();
  detailed.computeBoundingBox();
  assert.equal(base.index, null);
  assert.deepEqual(Object.keys(base.attributes).sort(), ['color', 'normal', 'position']);
  assert.ok(base.boundingBox.min.y >= -0.241 && base.boundingBox.min.y <= -0.239, 'основание пола ниже уровня ног персонажа');
  assert.ok(base.boundingBox.min.x >= -8.5 && base.boundingBox.max.x <= 8.5);
  assert.ok(base.boundingBox.min.z >= -6.5 && base.boundingBox.max.z <= 6.5);
  assert.ok(base.boundingBox.max.y <= 6.0);
  assert.ok(base.getAttribute('position').count > detailed.getAttribute('position').count);
  assert.ok(base.getAttribute('position').count / 3 <= 18_000, 'статичный интерьер укладывается в бюджет треугольников');
  assert.ok(detailed.getAttribute('position').count / 3 <= 3_000, 'мелкий слой остаётся компактным');
  base.dispose();
  detailed.dispose();
});

test('интерьер: качество переключает детали, продукт и dispose освобождает ресурсы', () => {
  const parent = new THREE.Scene();
  const interior = createBakeryInterior({ quality: 'low' });
  parent.add(interior.group);
  assert.equal(interior.group.getObjectByName('bakery-detail').visible, false);
  interior.setQuality('medium');
  assert.equal(interior.group.getObjectByName('bakery-detail').visible, true);
  interior.setStage('product_shaped');
  assert.equal(interior.group.getObjectByName('bakery-product-dough').visible, true);
  interior.setQuality('low');
  assert.equal(interior.group.getObjectByName('bakery-product-dough').visible, false);
  interior.setStage('product_baked');
  assert.equal(interior.group.getObjectByName('bakery-product-loaf').visible, true);
  interior.setQuality('high');
  assert.equal(interior.setQuality('invalid'), 'medium');
  const disposed = [];
  interior.group.getObjectByName('bakery-static').geometry.addEventListener('dispose', () => disposed.push('static'));
  interior.dispose();
  assert.equal(parent.children.length, 0);
  assert.ok(disposed.includes('static'));
});

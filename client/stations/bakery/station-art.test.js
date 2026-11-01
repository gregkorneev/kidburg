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
  assert.equal(interior.group.getObjectByName('bakery-product-dough').visible, true, 'тесто видно и на низком качестве');
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

// Лучи из комнаты проверяют порядок реальной геометрии, а не только исходные координаты.
test('окна: стекло отделено от подложки и находится глубже переплёта', () => {
  const geometry = buildBakeryInteriorGeometry({ detail: false });
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  for (const [side, z] of [[-1, -3], [1, -3.65]]) {
    const depths = (y, dz) => {
      const ray = new THREE.Raycaster(new THREE.Vector3(side * 7, y, z + dz), new THREE.Vector3(side, 0, 0));
      return ray.intersectObject(mesh).map((hit) => hit.distance).sort((a, b) => a - b);
    };
    const pane = depths(3.36, 0.48);
    const frame = depths(3.36, 0);
    const crossing = depths(3.73, 0.02);
    assert.ok(crossing[1] - crossing[0] > 0.1, 'перекладины не имеют совпадающих передних граней');
    assert.ok(frame[0] + 0.03 < pane[0], 'переплёт выступает перед стеклом');
    assert.ok(pane[1] - pane[0] > 0.04, 'стекло имеет толщину');
    assert.ok(pane[2] - pane[1] > 0.02, 'стекло отделено от подложки');
  }
  geometry.dispose();
  mesh.material.dispose();
});

test('дорожка: внутри соединений нет вертикальных граней и швов', () => {
  const geometry = buildBakeryInteriorGeometry({ detail: false });
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  for (const [x, z] of [[-1.8, 0.5], [1.2, 0], [-1.8, 3.8]]) {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 0.014, z), new THREE.Vector3(1, 0, 0), 0, 0.6);
    assert.equal(ray.intersectObject(mesh).length, 0, `шов у ${x}, ${z}`);
  }
  geometry.dispose();
  material.dispose();
});

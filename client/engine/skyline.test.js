import test from 'node:test';
import assert from 'node:assert/strict';
import { createCitySkyline } from './skyline.js';

test('дальний город — единый цветной меш за границами площади', () => {
  const skyline = createCitySkyline();
  const [mesh] = skyline.group.children;
  assert.equal(skyline.group.children.length, 1);
  assert.ok(mesh.geometry.getAttribute('color'));
  mesh.geometry.computeBoundingBox();
  assert.ok(mesh.geometry.boundingBox.max.x > 100);
  assert.ok(mesh.geometry.boundingBox.min.x < -100);
  assert.ok(mesh.geometry.boundingBox.max.y > 70);
  skyline.dispose();
  assert.equal(skyline.group.children.length, 0);
});

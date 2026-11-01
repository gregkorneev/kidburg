import test from 'node:test';
import assert from 'node:assert/strict';
import { createScenery, grassGeometry } from './scenery.js';
import { wind, windMaterial } from '../../engine/art/wind.js';

test('растения пожарного двора используют общий ветер и не освобождают его материалы', () => {
  const scenery = createScenery({ detail: 1 });
  const profiles = new Set(scenery.group.children.map((node) => node.material?.userData?.windProfile).filter(Boolean));
  for (const profile of ['tree-round', 'tree-pine', 'tree-birch', 'bush', 'grass', 'flower']) assert.ok(profiles.has(profile), profile);
  scenery.update(17);
  assert.equal(wind.uniforms.uWindTime.value, 17);
  assert.ok(scenery.group.children.filter((node) => node.material?.userData?.windProfile).every((node) => node.customDepthMaterial && node.customDistanceMaterial));
  const material = windMaterial('grass');
  let disposed = false;
  const onDispose = () => { disposed = true; };
  material.addEventListener('dispose', onDispose);
  scenery.dispose();
  material.removeEventListener('dispose', onDispose);
  assert.equal(disposed, false);
});

test('grass blades have multiple vertical segments for smooth bending', () => {
  const geometry = grassGeometry();
  const yLevels = new Set(Array.from(geometry.getAttribute('position').array).filter((_, index) => index % 3 === 1).map((y) => y.toFixed(3)));
  assert.equal(geometry.userData.windSegments, 4);
  assert.ok(yLevels.size >= 5);
  assert.equal(geometry.index.count, 6 * 4 * 6);
  geometry.dispose();
});

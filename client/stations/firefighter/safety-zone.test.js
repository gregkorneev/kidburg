import test from 'node:test';
import assert from 'node:assert/strict';
import { blockedBySafetyZone, SAFETY_ZONE } from './safety-zone.js';

test('учебная зона закрыта со всех сторон только во время тушения', () => {
  const { minX, maxX, minZ, maxZ } = SAFETY_ZONE;
  for (const [x, z] of [[3, maxZ], [minX, 4], [maxX, 4], [3, minZ], [minX, maxZ]]) {
    assert.equal(blockedBySafetyZone('fire_drill', x, z), true);
    assert.equal(blockedBySafetyZone('rescue', x, z), false);
  }
  assert.equal(blockedBySafetyZone('fire_drill', -3, 2.1), false); // Маруся
  assert.equal(blockedBySafetyZone('fire_drill', -7.6, 2.3), false); // шкаф
  assert.equal(blockedBySafetyZone('fire_drill', -0.9, 7.4), false); // рукав
  assert.equal(blockedBySafetyZone('fire_drill', 3.5, maxZ + 0.5), false);
});

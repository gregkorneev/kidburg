import test from 'node:test';
import assert from 'node:assert/strict';
import { canMoveWithHose, MAX_HOSE_DISTANCE } from './hose-length.js';

test('рукав ограничивает удаление и позволяет двигаться обратно', () => {
  const anchor = { x: -0.9, z: 7.4 };
  const current = { x: anchor.x + MAX_HOSE_DISTANCE, z: anchor.z };
  assert.equal(canMoveWithHose(true, current, { x: current.x + 0.1, z: current.z }, anchor), false);
  assert.equal(canMoveWithHose(true, current, { x: current.x - 0.1, z: current.z }, anchor), true);
  assert.equal(canMoveWithHose(false, current, { x: current.x + 100, z: current.z }, anchor), true);
  assert.equal(canMoveWithHose(true, { x: 3, z: 7 }, { x: 6, z: 7 }, anchor), true);
  assert.equal(canMoveWithHose(true, current, { x: current.x, z: current.z + 1 }, anchor), false);
});

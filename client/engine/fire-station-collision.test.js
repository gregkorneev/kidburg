import test from 'node:test';
import assert from 'node:assert/strict';
import { collides } from './player.js';
import { cityGateColliders } from './city-interactions.js';
import { fireStationCollisionBoxes, fireStationFloorHeight, GATE, GARAGE_X } from './fire-station.js';

test('гаражные проёмы пожарной части проходимы только при поднятых воротах', () => {
  const walls = fireStationCollisionBoxes();
  const x = GARAGE_X[0];
  const z = GATE.z;
  const closedGate = {
    kind: 'gate', x, z, width: GATE.width, depth: GATE.thickness, minY: GATE.baseY,
    maxY: GATE.baseY + GATE.height, rotationY: 0, object: { blocking: true },
  };
  assert.equal(collides(walls, x, 0, z), false);
  assert.equal(collides([...walls, ...cityGateColliders([closedGate])], x, 0, z), true);
  closedGate.object.blocking = false;
  assert.equal(collides([...walls, ...cityGateColliders([closedGate])], x, 0, z), false);
  assert.equal(collides(walls, x, 0, 0), false);
  assert.equal(collides(walls, -9, 0, z), true);
});


test('игрок стоит на верхней поверхности пола гаража, а снаружи остаётся на террейне', () => {
  assert.equal(fireStationFloorHeight(382, 412), 0.5);
  assert.equal(fireStationFloorHeight(360, 412), null);
});

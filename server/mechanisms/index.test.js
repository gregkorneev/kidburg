import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMechanisms } from './index.js';
import { MECHANISMS } from '../../shared/mechanisms.js';
import { createSectionalGate } from '../../client/engine/mechanisms/gate.js';

test('ворота восстанавливаются после смены направления и позднего подключения', () => {
  let time = 0;
  const mechanisms = createMechanisms({ now: () => time });
  const id = 'fire-city-gate-0';
  const pos = MECHANISMS[id];
  assert.equal(mechanisms.set(id, true, pos).ok, true);
  time = 1300;
  assert.equal(mechanisms.get(id).progress, 0.5);
  mechanisms.set(id, false, pos);
  time = 1950;
  const snapshot = mechanisms.get(id);
  assert.equal(snapshot.progress, 0.25);
  const gate = createSectionalGate({ id, width: 4, height: 4 });
  gate.applyRemote({ open: snapshot.active, progress: snapshot.progress });
  assert.equal(gate.progress, 0.25);
  gate.update(0.65);
  assert.equal(gate.progress, 0);
  gate.dispose();
  assert.equal(mechanisms.set(id, true, { x: 0, z: 0 }).reason, 'too_far');
});

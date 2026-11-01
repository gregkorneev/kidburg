import test from 'node:test';
import assert from 'node:assert/strict';
import { createSectionalGate } from './gate.js';

test('секции ворот следуют касательной направляющей и разворачиваются без скачка', () => {
  const height = 3.6;
  const radius = 0.3;
  const gate = createSectionalGate({ id: 'test', width: 4, height, radius, sections: 6 });
  const arc = Math.PI * radius / 2;
  const distance = height + arc / 2 - (height / 6) * 5.5;
  const progress = Math.acos(1 - 2 * distance / gate.travel) / Math.PI;
  gate.applyRemote({ open: true, progress });
  const top = gate.parts.sections[5];
  assert.ok(Math.abs(top.rotation.x + Math.PI / 4) < 1e-10);
  const before = top.position.clone();
  gate.close();
  assert.ok(top.position.distanceTo(before) < 1e-10);
  gate.update(10);
  assert.equal(gate.state, 'closed');
  gate.open();
  gate.update(10);
  assert.equal(gate.state, 'open');
  assert.ok(gate.parts.sections.every((panel) => Math.abs(panel.rotation.x + Math.PI / 2) < 1e-10));
  gate.dispose();
});

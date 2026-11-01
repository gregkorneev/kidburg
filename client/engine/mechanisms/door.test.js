import test from 'node:test';
import assert from 'node:assert/strict';
import { createDoor, DOOR_SWING } from './door.js';

const make = (extra = {}) => createDoor({ id: 'door-test', w: 2.4, h: 2.6, leaf: 0xcc4433, glass: 0x9ad, ...extra });

test('дверь: две створки на независимых шарнирах у внешних кромок', () => {
  const door = make();
  const [left, right] = door.parts.hinges;
  assert.equal(door.leafCount, 2);
  assert.ok(Math.abs(left.position.x + (1.2 - 0.04)) < 1e-9);
  assert.ok(Math.abs(right.position.x - (1.2 - 0.04)) < 1e-9);
  assert.notEqual(door.parts.leaves[0], door.parts.leaves[1]);
  assert.equal(door.state, 'closed');
  door.dispose();
});

test('дверь: открывается и закрывается за время duration, створки расходятся в разные стороны', () => {
  const door = make({ duration: 0.9 });
  const [a, b] = door.parts.hinges;
  assert.equal(door.open(), true);
  assert.equal(door.state, 'opening');
  door.update(0.45);
  assert.ok(a.rotation.y !== 0 && Math.sign(a.rotation.y) === -Math.sign(b.rotation.y));
  assert.equal(door.isOpen, false);
  door.update(0.5);
  assert.equal(door.state, 'open');
  assert.equal(door.isOpen, true);
  assert.ok(Math.abs(Math.abs(a.rotation.y) - DOOR_SWING) < 1e-9);
  door.close();
  door.update(1);
  assert.equal(door.state, 'closed');
  assert.equal(a.rotation.y + 0, 0);
  assert.equal(b.rotation.y + 0, 0);
  door.dispose();
});

test('дверь: разворот в середине движения идёт без скачка угла', () => {
  const door = make();
  door.open();
  door.update(0.4);
  const angle = door.parts.hinges[0].rotation.y;
  door.close();
  assert.equal(door.parts.hinges[0].rotation.y, angle);
  assert.equal(door.state, 'closing');
  door.update(0.01);
  assert.ok(Math.abs(door.parts.hinges[0].rotation.y) < Math.abs(angle));
  door.dispose();
});

test('дверь: applyRemote восстанавливает состояние по времени сервера и безопасна при повторе', () => {
  const door = make({ duration: 1 });
  door.applyRemote({ open: true, ageMs: 400 });
  assert.ok(door.progress > 0.35 && door.progress < 0.45);
  door.applyRemote({ open: true, ageMs: 400 });
  door.applyRemote({ open: true, progress: 1, elapsedMs: 0 });
  assert.equal(door.state, 'open');
  door.applyRemote({ open: false, progress: 1, elapsedMs: 5000 });
  assert.equal(door.state, 'closed');
  assert.ok(door.label.includes('Открыть'));
  door.dispose();
});

test('дверь: dispose повторно безопасен, общие геометрии остаются', () => {
  const a = make();
  const b = make();
  assert.equal(a.parts.leaves[0].geometry, b.parts.leaves[0].geometry);
  a.dispose();
  a.dispose();
  assert.equal(b.parts.leaves[0].geometry.getAttribute('position').count > 0, true);
  b.dispose();
});

test('дверь: initialOpen стартует распахнутой', () => {
  const door = make({ initialOpen: true });
  assert.equal(door.state, 'open');
  assert.equal(door.isOpen, true);
  door.dispose();
});

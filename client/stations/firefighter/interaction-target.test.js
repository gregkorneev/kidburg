import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestInteraction } from './interaction-target.js';

test('E выбирает ближайшее доступное действие и игнорирует удалённые цели', () => {
  const gate = { kind: 'gate', distance: 1.1, radius: 3, label: 'Открыть ворота' };
  const npc = { kind: 'npc', distance: 1.5, radius: 2.8, label: 'Поговорить' };
  assert.equal(nearestInteraction([npc, gate]), gate);
  assert.equal(nearestInteraction([{ ...gate, distance: 4 }, npc]), npc);
  assert.equal(nearestInteraction([{ ...gate, distance: 4 }]), null);
});

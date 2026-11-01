import test from 'node:test';
import assert from 'node:assert/strict';
import { CABINET_SWING, DRAWER_TRAVEL, createCabinet, createDrawerChest } from './furniture.js';
import { FURNITURE, furnitureBlockers } from '../../stations/firefighter/furniture-plan.js';

test('шкаф: дверца на петле у боковой кромки открывается наружу и закрывается', () => {
  const left = createCabinet({ id: 'c-left', hinge: 'left', duration: 1 });
  const right = createCabinet({ id: 'c-right', hinge: 'right', duration: 1 });
  assert.ok(left.parts.door.position.x < 0 && right.parts.door.position.x > 0);
  assert.equal(left.label, 'Открыть шкаф');
  left.toggle();
  right.toggle();
  left.update(0.5);
  assert.equal(left.state, 'opening');
  left.update(1);
  right.update(1.5);
  assert.equal(left.state, 'open');
  assert.equal(left.label, 'Закрыть шкаф');
  assert.ok(Math.abs(left.angle - CABINET_SWING) < 1e-9);
  // Свободная кромка уходит к +Z (к игроку) в обоих вариантах.
  for (const cabinet of [left, right]) {
    cabinet.root.updateMatrixWorld(true);
    const edge = cabinet.parts.door.localToWorld(cabinet.parts.door.position.clone().set(-cabinet.parts.hingeSide * cabinet.width * 0.9, 0, 0));
    assert.ok(edge.z > cabinet.depth / 2 + 0.5, `свободная кромка ${edge.z}`);
  }
  left.toggle();
  left.update(2);
  assert.equal(left.state, 'closed');
  assert.equal(left.parts.door.rotation.y + 0, 0);
  left.dispose();
  right.dispose();
});

test('шкаф: содержимое внутри корпуса — геометрия не пустая, дверца отдельным Mesh', () => {
  const cabinet = createCabinet({ id: 'c', variant: 'gear' });
  const meshes = [];
  cabinet.root.traverse((n) => n.isMesh && meshes.push(n));
  assert.ok(meshes.some((m) => m.name.endsWith(':door')));
  const body = meshes.find((m) => m.name.endsWith(':body'));
  assert.ok(body.geometry.attributes.position.count > 400, 'полки и предметы внутри корпуса');
  cabinet.dispose();
});

test('тумба: ящики выдвигаются независимо друг от друга', () => {
  const chest = createDrawerChest({ id: 'bench', drawers: 3, duration: 0.5 });
  assert.equal(chest.drawers.length, 3);
  const [a, b, c] = chest.drawers;
  assert.equal(a.label, 'Выдвинуть ящик');
  b.toggle();
  chest.update(0.25);
  assert.ok(b.offset > 0 && b.offset < DRAWER_TRAVEL);
  assert.equal(a.offset, 0);
  assert.equal(c.offset, 0);
  chest.update(1);
  assert.ok(Math.abs(b.offset - DRAWER_TRAVEL) < 1e-9);
  a.toggle();
  chest.update(1);
  assert.ok(a.offset > 0.4 && b.offset > 0.4 && c.offset === 0);
  b.toggle();
  chest.update(1);
  assert.equal(b.offset, 0);
  assert.equal(b.label, 'Выдвинуть ящик');
  assert.ok(a.isOpen);
  chest.dispose();
});

test('мебель: applyRemote и повторные команды безопасны', () => {
  const cabinet = createCabinet({ id: 'r', duration: 1 });
  cabinet.applyRemote({ open: true, ageMs: 500 });
  assert.ok(cabinet.progress > 0.45 && cabinet.progress < 0.55);
  assert.equal(cabinet.open(), true);
  cabinet.update(2);
  assert.equal(cabinet.open(), true);
  assert.equal(cabinet.state, 'open');
  cabinet.dispose();
  cabinet.dispose();
});

test('план мебели: корпуса не пересекаются друг с другом и со шкафом экипировки, стоят у стены здания', () => {
  const boxes = furnitureBlockers();
  assert.equal(boxes.length, FURNITURE.cabinets.length + 1);
  for (let i = 0; i < boxes.length; i++) {
    assert.ok(boxes[i].minZ >= 1.1 - 1e-9, 'не заходит в здание');
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlap = a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
      assert.equal(overlap, false, `${i} пересекает ${j}`);
    }
  }
  // Шкаф экипировки (-7.6, 2.3) и Маруся (-3, 2.1) остаются свободными.
  for (const [x, z] of [[-7.6, 2.3], [-3, 2.1]]) {
    assert.equal(boxes.some((b) => x > b.minX - 0.4 && x < b.maxX + 0.4 && z > b.minZ && z < b.maxZ), false);
  }
});

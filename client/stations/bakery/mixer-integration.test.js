import test from 'node:test';
import assert from 'node:assert/strict';
import { createBakeryInterior } from './station-art.js';

test('тестомес запускается на приготовлении ингредиентов и останавливается при переходе и повторном заказе', () => {
  const interior = createBakeryInterior();
  const mixer = interior.group.getObjectByName('bakery-mixer');
  assert.ok(mixer);
  assert.deepEqual(mixer.position.toArray(), [-5.77, 1.12, 0.43]);
  const head = mixer.children.find((child) => child.isGroup);
  const hook = head.children.find((child) => child.isGroup);
  interior.setStage('order_received');
  interior.setStage('ingredients_ready');
  for (let i = 0; i < 120; i++) interior.update(1 / 60, i / 60);
  assert.ok(hook.rotation.y > 1);
  interior.setStage('product_shaped');
  for (let i = 0; i < 300; i++) interior.update(1 / 60, i / 60);
  const stopped = hook.rotation.y;
  for (let i = 0; i < 120; i++) interior.update(1 / 60, i / 60);
  assert.ok(Math.abs(hook.rotation.y - stopped) < 0.001);
  interior.setStage('completed');
  interior.setStage('waiting_order');
  interior.setStage('order_received');
  interior.setStage('ingredients_ready');
  for (let i = 0; i < 120; i++) interior.update(1 / 60, i / 60);
  assert.ok(hook.rotation.y > stopped + 1);
  interior.dispose();
});

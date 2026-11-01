import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('бенчмарк отклоняет позицию, исправленную сервером, и восстанавливает update', async () => {
  const update = () => {};
  const world = { update };
  const player = { x: 0, z: 0 };
  const window = { __cityDebug: { world, player } };
  const context = vm.createContext({ window, performance, setTimeout: (fn) => { player.x = 0; fn(); } });
  vm.runInContext(readFileSync(new URL('./city-bench.js', import.meta.url), 'utf8'), context);
  await assert.rejects(window.__bench([{ name: 'станция', x: 100, z: 0, yaw: 0 }]), /измерение отменено/);
  assert.equal(world.update, update);
  world.update();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createBakeryScene } from './scene.js';

function makeRenderer() {
  const canvas = { setAttribute() {}, remove() { this.removed = true; } };
  return {
    domElement: canvas,
    shadowMap: {},
    setPixelRatio() {},
    setSize() {},
    render() {},
    dispose() { this.disposed = true; },
    forceContextLoss() { this.contextLost = true; },
  };
}

test('сцена Bakery: создаётся, принимает все пресеты и dispose удаляет сцену и canvas', () => {
  const children = [];
  const container = { clientWidth: 800, clientHeight: 600, appendChild: (node) => children.push(node) };
  const renderer = makeRenderer();
  const world = createBakeryScene({
    container,
    rendererFactory: () => renderer,
    requestFrame: () => 1,
    cancelFrame: () => {},
  });
  assert.equal(children.length, 1);
  assert.ok(world.debug.scene.children.length > 0);
  assert.equal(world.setQuality('low'), 'low');
  assert.equal(world.setQuality('medium'), 'medium');
  assert.equal(world.setQuality('high'), 'high');
  world.setPosition({ x: 0, z: 5.55 });
  assert.deepEqual(world.getPosition(), { x: 0, z: 5.55 });
  world.dispose();
  assert.equal(renderer.disposed, true);
  assert.equal(renderer.domElement.removed, true);
  assert.equal(world.debug.scene.children.length, 0);
});

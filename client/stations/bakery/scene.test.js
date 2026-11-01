import test from 'node:test';
import assert from 'node:assert/strict';
import { createBakeryScene } from './scene.js';
import { ZONES } from './layout.js';
import { applyBakeryAction, createInitialState } from './state.js';

function makeRenderer() {
  const canvasListeners = new Map();
  const canvas = {
    setAttribute() {},
    addEventListener(type, listener) { canvasListeners.set(type, listener); },
    removeEventListener(type) { canvasListeners.delete(type); },
    click() { canvasListeners.get('click')?.(); },
    remove() { this.removed = true; },
  };
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
  const windowListeners = new Map();
  const documentListeners = new Map();
  const windowObject = {
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    removeEventListener(type) { windowListeners.delete(type); },
  };
  const documentObject = {
    pointerLockElement: null,
    addEventListener(type, listener) { documentListeners.set(type, listener); },
    removeEventListener(type) { documentListeners.delete(type); },
    exitPointerLock() {
      this.pointerLockElement = null;
      documentListeners.get('pointerlockchange')?.();
    },
  };
  const container = { clientWidth: 800, clientHeight: 600, appendChild: (node) => children.push(node) };
  const renderer = makeRenderer();
  const frames = [];
  let world;
  let gameState = createInitialState();
  const actions = [];
  const notices = [];
  world = createBakeryScene({
    container,
    rendererFactory: () => renderer,
    window: windowObject,
    document: documentObject,
    onAction(action) {
      actions.push(action);
      const result = applyBakeryAction(gameState, action);
      if (result.accepted) { gameState = result.state; world.setState(gameState); }
    },
    onNotice: (message) => notices.push(message),
    requestFrame: (fn) => { frames.push(fn); return frames.length; },
    cancelFrame: () => {},
  });
  assert.equal(children.length, 1);
  assert.ok(world.debug.scene.children.length > 0);
  assert.equal(world.debug.camera.rotation.order, 'YXZ');
  frames.at(-1)(0);
  assert.deepEqual(world.getPosition(), { x: 0, z: 4.25 });
  assert.equal(world.debug.player.visible, true, 'модель игрока находится в сцене');
  assert.ok(world.debug.camera.position.distanceTo(world.debug.player.position) > 5, 'камера отодвинута за персонажа');
  assert.ok(world.debug.camera.position.y >= 3.5, 'стартовый ракурс поднят над персонажем');
  assert.ok(world.debug.player.userData.nameTag.scale.x < 1.3, 'плашка игрока компактная');
  assert.ok(world.debug.mentor.userData.nameTag.scale.x < 1.5, 'плашка наставника компактная');
  assert.ok(world.debug.mentor.userData.nameTag.position.y <= 3.3, 'плашка наставника близко к персонажу');
  assert.ok(world.debug.camera.position.y < 5.1, 'камера остаётся ниже потолка');
  assert.ok(world.debug.bounds(world.getPosition().x, world.getPosition().z), 'игрок стартует внутри помещения');
  assert.equal(world.debug.cameraState().locked, false);
  const startYaw = world.debug.cameraState().yaw;
  assert.ok(startYaw > 1.2 && startYaw < 1.7, 'стартовый взгляд направлен к наставнику');

  // Canvas click acquires the same pointer lock used by the city input system.
  renderer.domElement.requestPointerLock = () => {
    documentObject.pointerLockElement = renderer.domElement;
    documentListeners.get('pointerlockchange')?.();
  };
  renderer.domElement.click();
  assert.equal(world.debug.cameraState().locked, true);
  documentListeners.get('mousemove')?.({ movementX: 100, movementY: -40 });
  windowListeners.get('keydown')?.({ code: 'KeyW', target: renderer.domElement, repeat: false, preventDefault() {} });
  frames.at(-1)(1000);
  assert.ok(world.debug.cameraState().yaw < startYaw - 0.2, 'мышь поворачивает камеру');
  assert.ok(world.getPosition().x < 0, 'W движется относительно нового направления камеры');
  assert.ok(world.getPosition().z < 4.25);
  assert.ok(world.getPosition().z >= -6.1, 'игрок остаётся внутри стен');
  windowListeners.get('keyup')?.({ code: 'KeyW' });
  // Browser Escape exits pointer lock; pointerlockchange resets input just like the main client.
  documentObject.exitPointerLock();
  assert.equal(world.debug.cameraState().locked, false);

  // The live E handler enforces the order and can complete a full local order.
  const pressE = () => windowListeners.get('keydown')?.({ code: 'KeyE', target: renderer.domElement, repeat: false });
  world.setPosition(ZONES.find((zone) => zone.id === 'ingredients'));
  pressE();
  assert.equal(actions.length, 0, 'нельзя начинать с ингредиентов');
  assert.ok(notices.length > 0);
  for (const zoneId of ['mentor', 'ingredients', 'worktable', 'oven', 'cooling_rack', 'delivery']) {
    world.setPosition(ZONES.find((zone) => zone.id === zoneId));
    pressE();
  }
  assert.deepEqual(actions, ['get_order', 'prepare_ingredients', 'shape_product', 'use_oven', 'collect_product', 'deliver_order']);
  assert.equal(gameState.stage, 'completed');
  assert.equal(gameState.completedOrders, 1);

  assert.equal(world.setQuality('low'), 'low');
  assert.equal(world.setQuality('medium'), 'medium');
  assert.equal(world.setQuality('high'), 'high');
  world.setPosition({ x: 0, z: 5.55 });
  assert.deepEqual(world.getPosition(), { x: 0, z: 5.55 });
  world.dispose();
  assert.equal(renderer.disposed, true);
  assert.equal(renderer.domElement.removed, true);
  assert.equal(windowListeners.size, 0);
  assert.equal(documentListeners.size, 0);
  assert.equal(world.debug.scene.children.length, 0);
});

// E у пекаря: разговор при подтверждённой сессии станции, прежнее поведение без неё, рабочие зоны не перебиваются.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createBakeryScene, TALK_PROMPT } from './scene.js';
import { ZONES } from './layout.js';

function setup({ talkEnabled }) {
  const windowListeners = new Map();
  const documentListeners = new Map();
  const canvas = { setAttribute() {}, addEventListener() {}, removeEventListener() {}, remove() {} };
  const renderer = { domElement: canvas, shadowMap: {}, setPixelRatio() {}, setSize() {}, render() {}, dispose() {}, forceContextLoss() {} };
  const frames = [];
  const log = { actions: [], talks: 0, prompts: [] };
  const world = createBakeryScene({
    container: { clientWidth: 800, clientHeight: 600, appendChild() {} },
    rendererFactory: () => renderer,
    window: { addEventListener: (type, fn) => windowListeners.set(type, fn), removeEventListener: (type) => windowListeners.delete(type) },
    document: { pointerLockElement: null, addEventListener: (type, fn) => documentListeners.set(type, fn), removeEventListener: (type) => documentListeners.delete(type), exitPointerLock() {} },
    onAction: (action) => log.actions.push(action),
    onPrompt: (value) => log.prompts.push(value),
    requestFrame: (fn) => (frames.push(fn), frames.length),
    cancelFrame: () => {},
    talk: { enabled: () => talkEnabled.value, range: 2.6, onTalk: () => { log.talks += 1; } },
  });
  const pressE = () => windowListeners.get('keydown')?.({ code: 'KeyE', target: canvas, repeat: false });
  const frame = (t) => frames.at(-1)(t);
  return { world, log, pressE, frame, canvas };
}

const zone = (id) => ZONES.find((z) => z.id === id);

test('без связи с сервером E у пекаря получает заказ, как раньше', () => {
  const { world, log, pressE, frame } = setup({ talkEnabled: { value: false } });
  world.setPosition(zone('mentor'));
  frame(0);
  pressE();
  assert.deepEqual(log.actions, ['get_order']);
  assert.equal(log.talks, 0);
  assert.ok(!log.prompts.includes(TALK_PROMPT));
  world.dispose();
});

test('при подтверждённой сессии E у пекаря открывает разговор и не засчитывает этап', () => {
  const { world, log, pressE, frame } = setup({ talkEnabled: { value: true } });
  world.setPosition(zone('mentor'));
  frame(0);
  assert.equal(log.prompts.at(-1), TALK_PROMPT);
  pressE();
  assert.equal(log.talks, 1);
  assert.deepEqual(log.actions, [], 'разговор шаг заказа не выполняет');
  world.dispose();
});

test('вдали от пекаря и у рабочих объектов E остаётся рабочим действием', () => {
  const enabled = { value: true };
  const { world, log, pressE, frame } = setup({ talkEnabled: enabled });
  // Стойка ингредиентов далеко от пекаря: неверный по порядку шаг сообщает подсказку, а не открывает чат.
  world.setPosition(zone('ingredients'));
  frame(0);
  pressE();
  assert.equal(log.talks, 0);

  // Стойка выдачи — в зоне досягаемости пекаря, но на этапе «передай заказ» побеждает рабочая зона.
  world.setState({ stage: 'product_ready', completedOrders: 0 });
  world.setPosition({ x: -3.4, z: 4.0 });
  frame(16);
  pressE();
  assert.equal(log.talks, 0, 'работа с объектом приоритетнее разговора');
  assert.deepEqual(log.actions, ['deliver_order']);

  // Если шаг не относится к этой зоне, рядом с пекарем E открывает разговор.
  world.setState({ stage: 'order_received', completedOrders: 0 });
  world.setPosition({ x: -5.2, z: 4.1 });
  frame(32);
  pressE();
  assert.equal(log.talks, 1);
  world.dispose();
});

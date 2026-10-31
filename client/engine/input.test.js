import test from 'node:test';
import assert from 'node:assert/strict';
import { createInput } from './input.js';

function setup() {
  const win = new EventTarget();
  const doc = new EventTarget();
  doc.pointerLockElement = null;
  let exits = 0;
  doc.exitPointerLock = () => {
    exits += 1;
    doc.pointerLockElement = null;
    doc.dispatchEvent(new Event('pointerlockchange'));
  };
  const target = new EventTarget();
  let lockRequests = 0;
  target.requestPointerLock = () => {
    lockRequests += 1;
    doc.pointerLockElement = target;
    doc.dispatchEvent(new Event('pointerlockchange'));
  };
  const calls = { interact: 0, chat: 0 };
  const input = createInput({
    target,
    document: doc,
    window: win,
    onInteract: () => (calls.interact += 1),
    onChat: () => (calls.chat += 1),
  });
  const key = (type, code, extra = {}) => win.dispatchEvent(Object.assign(new Event(type), { code, ...extra }));
  return { win, doc, target, input, key, calls, exits: () => exits, lockRequests: () => lockRequests };
}

test('WASD и Shift: нажатия, отпускание и потеря фокуса', () => {
  const { input, key, win } = setup();
  key('keydown', 'KeyW');
  key('keydown', 'ShiftLeft');
  assert.deepEqual(input.keys(), { forward: true, back: false, left: false, right: false, run: true });
  key('keyup', 'KeyW');
  assert.equal(input.keys().forward, false);
  key('keydown', 'KeyA');
  win.dispatchEvent(new Event('blur'));
  assert.deepEqual(input.keys(), { forward: false, back: false, left: false, right: false, run: false });
});

test('pointer lock: клик ставит захват, мышь поворачивает только при захвате', () => {
  const { input, target, doc, lockRequests } = setup();
  doc.dispatchEvent(Object.assign(new Event('mousemove'), { movementX: 5, movementY: 3 }));
  assert.deepEqual(input.consumeLook(), { dx: 0, dy: 0 });
  target.dispatchEvent(new Event('click'));
  assert.equal(lockRequests(), 1);
  assert.equal(input.locked, true);
  doc.dispatchEvent(Object.assign(new Event('mousemove'), { movementX: 5, movementY: 3 }));
  doc.dispatchEvent(Object.assign(new Event('mousemove'), { movementX: 1, movementY: -1 }));
  assert.deepEqual(input.consumeLook(), { dx: 6, dy: 2 });
  assert.deepEqual(input.consumeLook(), { dx: 0, dy: 0 });
});

test('UI просит освободить мышь: захват снят, управление выключено, клик не захватывает', () => {
  const { input, target, key, exits, lockRequests, calls } = setup();
  target.dispatchEvent(new Event('click'));
  key('keydown', 'KeyW');
  input.unlockPointer();
  assert.equal(exits(), 1);
  assert.equal(input.locked, false);
  assert.equal(input.keys().forward, false);
  key('keydown', 'KeyW');
  key('keydown', 'KeyE');
  assert.equal(input.keys().forward, false);
  assert.equal(calls.interact, 0);
  target.dispatchEvent(new Event('click'));
  assert.equal(lockRequests(), 1, 'пока панель открыта, захват не возвращается');
  input.lockPointer();
  assert.equal(lockRequests(), 2);
  key('keydown', 'KeyW');
  assert.equal(input.keys().forward, true);
});

test('E и Enter вызывают обработчики один раз за нажатие; в полях ввода игнорируются', () => {
  const { key, calls, win } = setup();
  key('keydown', 'KeyE');
  key('keydown', 'KeyE', { repeat: true });
  key('keydown', 'Enter');
  assert.deepEqual(calls, { interact: 1, chat: 1 });

  // Событие из поля ввода (например, чат интерфейса) не должно двигать игрока или говорить с NPC.
  const typing = Object.assign(new Event('keydown'), { code: 'KeyE' });
  Object.defineProperty(typing, 'target', { value: { closest: () => ({}) } });
  win.dispatchEvent(typing);
  assert.equal(calls.interact, 1);
});

test('dispose снимает все обработчики и освобождает мышь', () => {
  const { input, key, target, doc, win, calls, exits } = setup();
  target.dispatchEvent(new Event('click'));
  input.dispose();
  assert.equal(exits(), 1);
  key('keydown', 'KeyW');
  key('keydown', 'KeyE');
  target.dispatchEvent(new Event('click'));
  doc.dispatchEvent(Object.assign(new Event('mousemove'), { movementX: 9, movementY: 9 }));
  assert.equal(input.keys().forward, false);
  assert.equal(calls.interact, 0);
  assert.deepEqual(input.consumeLook(), { dx: 0, dy: 0 });
  assert.equal(win instanceof EventTarget, true);
});

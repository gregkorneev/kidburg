import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from './session.js';
import { createEmitter } from './emitter.js';

function fakeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
}

test('сессия хранится только в переданном sessionStorage, localStorage не трогается', () => {
  const guard = {
    get() {
      throw new Error('обращение к localStorage запрещено');
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: guard.get });
  try {
    const storage = fakeStorage();
    const session = createSession(storage);
    assert.equal(session.token(), null);
    session.save('tok', { id: 1, name: 'Аня' });
    assert.equal(session.token(), 'tok');
    assert.deepEqual(session.user(), { id: 1, name: 'Аня' });
    assert.equal(storage.map.size, 2);
    session.clear();
    assert.equal(session.token(), null);
    assert.equal(storage.map.size, 0);
  } finally {
    delete globalThis.localStorage;
  }
});

test('сессия переживает недоступное хранилище на время жизни страницы', () => {
  const broken = {
    getItem() {
      throw new Error('нет доступа');
    },
    setItem() {
      throw new Error('нет доступа');
    },
    removeItem() {
      throw new Error('нет доступа');
    },
  };
  const session = createSession(broken);
  session.save('tok', { id: 2, name: 'Борис' });
  assert.equal(session.token(), 'tok');
  assert.equal(session.user().name, 'Борис');
  session.clear();
  assert.equal(session.token(), null);
});

test('шина событий: отписка, повтор обработчика и ошибка в обработчике', () => {
  const errors = [];
  const bus = createEmitter((e) => errors.push(e.message));
  const got = [];
  const h = (v) => got.push(v);
  bus.on('a', h);
  bus.on('a', h); // тот же обработчик второй раз не добавляется
  bus.on('a', () => {
    throw new Error('сбой');
  });
  bus.on('a', (v) => got.push(`второй:${v}`));
  bus.emit('a', 1);
  assert.deepEqual(got, [1, 'второй:1']);
  assert.deepEqual(errors, ['сбой']);
  bus.off('a', h);
  bus.emit('a', 2);
  assert.deepEqual(got, [1, 'второй:1', 'второй:2']);
  const off = bus.on('b', h);
  off();
  bus.emit('b', 3);
  assert.equal(got.length, 3);
  bus.clear();
  bus.emit('a', 4);
  assert.equal(got.length, 3);
});

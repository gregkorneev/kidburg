import test from 'node:test';
import assert from 'node:assert/strict';
import { appearanceFromSeed } from './art/character-appearance.js';
import { createPlayerAppearance, currentPlayerAppearance } from './player-appearance.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

test('spawn appearance matches the same account ID and color used for remote players', () => {
  const user = { id: 42, appearance: { color: 0x4b9974 } };
  assert.deepEqual(createPlayerAppearance(user), appearanceFromSeed(42, 0x4b9974));
  assert.deepEqual(createPlayerAppearance(user, 42), createPlayerAppearance({ ...user }, 42));
});

test('welcome player ID takes precedence while keeping the account profile color', () => {
  const user = { id: 42, appearance: { color: 0x4b9974 } };
  assert.deepEqual(createPlayerAppearance(user, 57), appearanceFromSeed(57, 0x4b9974));
});

test('standalone locations read the same current-session appearance', () => {
  const user = { id: 73, appearance: { color: 0x8055aa } };
  const storage = memoryStorage({ 'city.user': JSON.stringify(user) });
  assert.deepEqual(currentPlayerAppearance(storage), appearanceFromSeed(73, 0x8055aa));
});

test('no session keeps standalone preview fallback and invalid IDs are rejected', () => {
  assert.equal(currentPlayerAppearance(memoryStorage()), null);
  assert.equal(createPlayerAppearance(null), null);
});

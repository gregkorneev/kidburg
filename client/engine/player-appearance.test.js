import test from 'node:test';
import assert from 'node:assert/strict';
import { appearanceFromSeed } from './art/character-appearance.js';
import { createPlayerAppearance, currentPlayerAppearance, resolvePlayerAppearance } from './player-appearance.js';

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


test('avatar fields give four stable and independent choices', () => {
  const avatar = { skin: 0, clothes: 0, hair: 0, hairColor: 0, shoes: 0 };
  const groups = { skin: ['skin'], clothes: ['top', 'outfit', 'pants', 'topAccent'], hair: ['hairStyle'], hairColor: ['hair'], shoes: ['shoes', 'shoeColor', 'bootColor'] };
  const pick = (look, keys) => keys.map((key) => look[key]);
  for (const field of Object.keys(groups)) {
    const variants = new Set();
    for (let value = 0; value < 4; value++) {
      const chosen = { ...avatar, [field]: value };
      const look = resolvePlayerAppearance({ id: 42, appearance: { avatar: chosen } });
      assert.deepEqual(look, resolvePlayerAppearance({ id: 42, appearance: chosen }));
      assert.deepEqual(look, createPlayerAppearance({ id: 42, appearance: { avatar: chosen } }));
      variants.add(JSON.stringify(pick(look, groups[field])));
      for (const other of Object.keys(groups).filter((key) => key !== field)) {
        assert.deepEqual(pick(look, groups[other]), pick(resolvePlayerAppearance({ id: 42, appearance: avatar }), groups[other]));
      }
    }
    assert.equal(variants.size, 4, field);
  }
});

test('missing or invalid avatar retains the original ID and color fallback', () => {
  for (const appearance of [{}, { color: 0x336699 }, { avatar: { skin: 4, clothes: 0, hair: 0, hairColor: 0, shoes: 0 }, color: 0x336699 }]) {
    assert.deepEqual(resolvePlayerAppearance({ id: 42, appearance }), appearanceFromSeed(42, appearance.color ?? null));
  }
});


test('all hair styles and colors are independent of each other and player id', () => {
  const avatar = { skin: 3, clothes: 2, hair: 3, hairColor: 1, shoes: 0 };
  const expected = resolvePlayerAppearance({ id: 0, appearance: avatar });
  assert.equal(expected.hair, '#b9532f');
  for (let style = 0; style < 4; style++) for (let color = 0; color < 4; color++) {
    const a = { ...avatar, hair: style, hairColor: color };
    const preview = resolvePlayerAppearance({ id: 0, appearance: a });
    const local = createPlayerAppearance({ id: 42, appearance: { avatar: a } });
    const remote = resolvePlayerAppearance({ id: 42, appearance: { avatar: a } });
    assert.equal(preview.hair, local.hair);
    assert.equal(local.hair, remote.hair);
    assert.equal(preview.hairStyle, local.hairStyle);
    const other = resolvePlayerAppearance({ id: 0, appearance: { ...a, hairColor: (color + 1) % 4 } });
    for (const field of ['hairStyle', 'skin', 'top', 'outfit', 'pants', 'shoes', 'shoeColor', 'bootColor']) assert.equal(other[field], preview[field]);
    assert.notEqual(other.hair, preview.hair);
  }
});

test('old stored avatar keeps its choices and gets a fixed hair color', () => {
  const avatar = { skin: 3, clothes: 2, hair: 3, shoes: 0 };
  const look = resolvePlayerAppearance({ id: 42, appearance: { avatar } });
  assert.equal(look.hair, '#c9a66b');
  assert.equal(look.hairStyle, 'ponytail');
  assert.equal(look.hair, resolvePlayerAppearance({ id: 0, appearance: avatar }).hair);
  assert.deepEqual(avatar, { skin: 3, clothes: 2, hair: 3, shoes: 0 });
});

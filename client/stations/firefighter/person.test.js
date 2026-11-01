import test from 'node:test';
import assert from 'node:assert/strict';
import { createPerson, createMarusya, setPersonEquipment } from './scene.js';
import { CITY_CHARACTER_SCALE, disposeCharacter } from '../../engine/art/character.js';

test('экипировка переключается и возвращает исходную одежду игрока', () => {
  const person = createPerson({ player: true });
  const outfit = person.userData.torso.material;

  setPersonEquipment(person, true);
  assert.equal(person.userData.helmet.visible, true);
  assert.equal(person.userData.uniform.visible, true);
  assert.notEqual(person.userData.torso.material, outfit);
  assert.ok(person.userData.arms.every(({ stripe, hand }) => stripe.visible && hand.visible));

  setPersonEquipment(person, false);
  assert.equal(person.userData.helmet.visible, false);
  assert.equal(person.userData.uniform.visible, false);
  assert.equal(person.userData.torso.material, outfit);
  assert.ok(person.userData.arms.every(({ sleeve, stripe, hand }) => sleeve.material === outfit && !stripe.visible && !hand.visible));
});

test('пожарные и наставник используют городской масштаб', () => {
  const people = [createPerson(), createPerson({ name: 'Игрок' }), createMarusya()];
  for (const person of people) {
    assert.deepEqual(person.scale.toArray(), [CITY_CHARACTER_SCALE, CITY_CHARACTER_SCALE, CITY_CHARACTER_SCALE]);
    disposeCharacter(person);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PALETTE, pick } from './palette.js';
import { QUALITY_LEVELS, QUALITY_PRESETS, isQuality, readQuality, saveQuality } from './quality.js';
import {
  HAIR_STYLES, animateCharacter, appearanceFromSeed, createCharacter, disposeCharacter, setPersonEquipment, triggerGesture,
} from './character.js';
import { applyStylizedLook } from './lighting.js';
import { createBatch, isSharedResource, stdMat } from './materials.js';

const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = String(v); }, data };
};

test('palette: pick циклически выбирает элемент и работает с любыми числами', () => {
  assert.equal(pick(['a', 'b', 'c'], 4), 'b');
  assert.ok(PALETTE.skin.includes(pick(PALETTE.skin, 12345)));
  assert.ok(PALETTE.skin.includes(pick(PALETTE.skin, -7)));
});

test('quality: адрес важнее хранилища, мусор игнорируется, ошибки хранилища не ломают игру', () => {
  assert.deepEqual([...QUALITY_LEVELS], ['low', 'medium', 'high']);
  assert.equal(readQuality('', memoryStorage()), 'medium');
  assert.equal(readQuality('?quality=low', memoryStorage({ 'kidburg.quality': 'high' })), 'low');
  assert.equal(readQuality('?quality=ultra', memoryStorage({ 'kidburg.quality': 'high' })), 'high');
  assert.equal(readQuality('', memoryStorage({ 'kidburg.quality': 'мусор' })), 'medium');
  const broken = { getItem() { throw new Error('closed'); }, setItem() { throw new Error('closed'); } };
  assert.equal(readQuality('', broken), 'medium');
  assert.doesNotThrow(() => saveQuality('high', broken));
  const storage = memoryStorage();
  saveQuality('high', storage);
  saveQuality('ultra', storage);
  assert.equal(storage.data['kidburg.quality'], 'high');
  assert.ok(isQuality('low') && !isQuality('ultra'));
  assert.ok(QUALITY_PRESETS.low.pixelRatio <= QUALITY_PRESETS.medium.pixelRatio);
  assert.ok(QUALITY_PRESETS.medium.pixelRatio <= QUALITY_PRESETS.high.pixelRatio);
  assert.equal(QUALITY_PRESETS.low.shadowSize, 0);
});

test('внешность: один id — один человек на любом клиенте, разные id различаются', () => {
  assert.deepEqual(appearanceFromSeed(42), appearanceFromSeed(42));
  assert.notDeepEqual(appearanceFromSeed(1), appearanceFromSeed(2));
  const styles = new Set(Array.from({ length: 40 }, (_, i) => appearanceFromSeed(i).hairStyle));
  assert.ok(styles.size >= 3, 'причёски разнообразны');
  assert.ok(!styles.has('ponytail'), 'хвост оставлен наставнику');
  for (const style of styles) assert.ok(HAIR_STYLES.includes(style));
  assert.equal(appearanceFromSeed(5, 0xff0000).outfit, '#ff0000', 'цвет из appearance сервера сохраняется');
});

test('персонаж: экипировка, жесты и анимация без DOM; освобождение не трогает общие ресурсы', () => {
  const person = createCharacter({ appearance: appearanceFromSeed(3) });
  assert.equal(person.userData.helmet.visible, false);
  setPersonEquipment(person, true);
  assert.equal(person.userData.helmet.visible, true);
  assert.equal(person.userData.uniform.visible, true);

  const before = person.userData.legs.map(({ pivot }) => pivot.rotation.x);
  for (let i = 0; i < 30; i++) animateCharacter(person, 1 / 60, i / 60, { speed: 2 });
  const after = person.userData.legs.map(({ pivot }) => pivot.rotation.x);
  assert.notDeepEqual(before, after, 'на бегу ноги двигаются');
  for (let i = 0; i < 60; i++) animateCharacter(person, 1 / 60, 1 + i / 60, { speed: 0 });
  assert.ok(person.userData.legs.every(({ pivot }) => Math.abs(pivot.rotation.x) < 0.1), 'в покое ноги выпрямляются');

  triggerGesture(person, 'wave');
  assert.equal(person.userData.anim.gesture, 'wave');
  assert.doesNotThrow(() => animateCharacter(person, 0.016, 0, { speed: 0, talking: true, lookYaw: 5 }));

  const shared = person.userData.torso.geometry;
  const sharedMaterial = stdMat('#123456');
  assert.ok(isSharedResource(sharedMaterial));
  disposeCharacter(person);
  assert.ok(isSharedResource(shared) || shared.attributes.position.count > 0);
  assert.ok(sharedMaterial.userData.shared, 'общий материал не освобождён');
});

test('createBatch сливает одинаковые материалы в один меш', () => {
  const material = stdMat('#abcdef');
  const batch = createBatch();
  for (let i = 0; i < 5; i++) batch.add(new THREE.BoxGeometry(1, 1, 1), material, [i * 2, 0, 0]);
  const group = batch.build();
  const meshes = group.children.filter((o) => o.isMesh);
  assert.equal(meshes.length, 1);
});

test('освещение: единая схема, небо следует за камерой, dispose убирает всё из сцены', () => {
  const renderer = { setPixelRatio() {}, toneMapping: 0, toneMappingExposure: 1 };
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
  const look = applyStylizedLook({ renderer, scene, camera, shadowExtent: 0 });
  assert.equal(renderer.toneMapping, THREE.ACESFilmicToneMapping);
  assert.equal(look.sun.castShadow, false, 'город без теней');
  assert.ok(scene.fog && scene.background);
  camera.position.set(10, 2, -5);
  look.update({ x: 10, z: -5 }, 3);
  assert.deepEqual(look.sky.position.toArray(), [10, 2, -5]);
  look.dispose();
  assert.ok(!scene.children.includes(look.sky));
  assert.ok(!scene.children.includes(look.sun));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createCharacterPreview } from './character-preview.js';
import { resolvePlayerAppearance } from './player-appearance.js';

test('preview renders the shared character with each selected avatar and releases it', () => {
  const frames = [];
  let removed = 0;
  let disposed = 0;
  const canvas = { remove() { removed++; } };
  const renderer = { domElement: canvas, setPixelRatio() {}, setSize() {}, render(scene) { frames.push(scene.children.find((child) => child.userData.look)); }, dispose() { disposed++; } };
  const container = { append(node) { assert.equal(node, canvas); } };
  const preview = createCharacterPreview(container, { createRenderer: () => renderer });
  const avatar = { skin: 3, clothes: 1, hair: 2, hairColor: 0, shoes: 0 };
  preview.setAvatar(avatar);
  assert.deepEqual(frames[0].userData.look, resolvePlayerAppearance({ id: 0, appearance: avatar }));
  for (const key of Object.keys(avatar)) {
    const next = { ...avatar, [key]: (avatar[key] + 1) % 4 };
    preview.setAvatar(next);
    assert.deepEqual(frames.at(-1).userData.look, resolvePlayerAppearance({ id: 0, appearance: next }));
  }
  preview.dispose();
  preview.dispose();
  preview.setAvatar(avatar);
  assert.equal(frames.length, 6);
  assert.equal(disposed, 1);
  assert.equal(removed, 1);
});

test('all variants change real character meshes and remain framed after resize', async () => {
  const THREE = await import('three');
  let observer;
  let scene;
  let camera;
  let disconnects = 0;
  class Observer {
    constructor(callback) { this.callback = callback; observer = this; }
    observe() {}
    disconnect() { disconnects++; }
  }
  const renderer = { domElement: { remove() {} }, setPixelRatio() {}, setSize() {}, render(s, c) { scene = s; camera = c; } , dispose() {} };
  const container = { clientWidth: 300, clientHeight: 200, append() {} };
  const preview = createCharacterPreview(container, { createRenderer: () => renderer, ResizeObserverImpl: Observer });
  const selected = { skin: 0, clothes: 0, hair: 0, hairColor: 0, shoes: 0 };
  const samples = { skin: new Set(), clothes: new Set(), hair: new Set(), hairColor: new Set(), shoes: new Set() };
  for (const key of Object.keys(selected)) {
    for (let value = 0; value < 4; value++) {
      preview.setAvatar({ ...selected, [key]: value });
      const person = scene.children.find((child) => child.userData.look);
      const u = person.userData;
      assert.equal(u.layers.fire, false);
      assert.equal(u.layers.helmet, false);
      assert.equal(u.holding, null);
      assert.equal(u.accessory, null);
      assert.ok(u.face.smile.scale.x < 0.2 && u.face.smile.scale.y < 0.1, 'smile arc initialized');
      if (key === 'skin') samples.skin.add(u.skin.color.getHexString());
      if (key === 'clothes') samples.clothes.add(u.torso.material.color.getHexString());
      if (key === 'hair') samples.hair.add(u.hair.children[0].geometry.uuid);
      if (key === 'hairColor') samples.hairColor.add(u.hair.children[0].material.color.getHexString());
      if (key === 'shoes') samples.shoes.add(u.legs[0].boot.material.color.getHexString());
      person.updateMatrixWorld(true);
      person.traverseVisible((part) => {
        if (!part.isMesh || !part.geometry) return;
        if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
        const b = part.geometry.boundingBox;
        for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
          const p = new THREE.Vector3(x, y, z).applyMatrix4(part.matrixWorld).project(camera);
          assert.ok(Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1, `${key} ${value}: mesh outside frame`);
        }
      });
    }
    assert.equal(samples[key].size, 4, `${key}: four distinct rendered variants`);
  }
  container.clientWidth = 150;
  observer.callback();
  assert.equal(camera.aspect, 0.75);
  preview.dispose();
  assert.equal(disconnects, 1);
});


test('preview, local and remote models use the same selected hair color', async () => {
  const THREE = await import('three');
  const { createRemotePlayers } = await import('./remote.js');
  const { createPlayerAppearance } = await import('./player-appearance.js');
  const avatar = { skin: 3, clothes: 2, hair: 3, hairColor: 1, shoes: 0 };
  let person;
  const renderer = { domElement: { remove() {} }, setPixelRatio() {}, setSize() {}, render(scene) { person = scene.children.find((item) => item.userData.look); }, dispose() {} };
  const preview = createCharacterPreview({ append() {} }, { createRenderer: () => renderer });
  preview.setAvatar(avatar);
  const previewLook = person.userData.look;
  const localLook = createPlayerAppearance({ id: 42, appearance: { avatar } });
  const scene = new THREE.Scene();
  const remote = createRemotePlayers({ scene, createLabel: () => { const label = new THREE.Object3D(); label.element = { remove() {} }; return label; } });
  remote.join(42, 'Аня', { avatar });
  const remotePerson = scene.children[0].children[0];
  assert.equal(previewLook.hair, '#b9532f');
  assert.equal(previewLook.hair, localLook.hair);
  assert.equal(localLook.hair, remotePerson.userData.look.hair);
  assert.equal(person.userData.hair.children[0].material.color.getHexString(), remotePerson.userData.hair.children[0].material.color.getHexString());
  preview.dispose();
  remote.dispose();
});

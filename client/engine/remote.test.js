import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPool } from './pool.js';
import { INTERP_DELAY_MS, createRemotePlayers, sampleSnapshots } from './remote.js';

const snap = (t, x, ry = 0, anim = 1) => ({ t, x, y: 0, z: 0, ry, anim });

test('интерполяция: середина между снимками, до первого и после последнего — без экстраполяции', () => {
  const snaps = [snap(100, 0), snap(200, 10)];
  assert.equal(sampleSnapshots(snaps, 150).x, 5);
  assert.equal(sampleSnapshots(snaps, 50).x, 0);
  assert.equal(sampleSnapshots(snaps, 500).x, 10);
  assert.equal(sampleSnapshots([], 10), null);
  assert.equal(sampleSnapshots([snap(10, 3)], 10).x, 3);
  const three = [snap(0, 0), snap(100, 10), snap(200, 30)];
  assert.equal(sampleSnapshots(three, 150).x, 20);
});

test('интерполяция угла идёт кратчайшим путём через ±π', () => {
  const snaps = [snap(0, 0, 3.0), snap(100, 0, -3.0)];
  const mid = sampleSnapshots(snaps, 50).ry;
  assert.ok(Math.abs(Math.abs(mid) - Math.PI) < 0.2, `угол ${mid} пошёл длинным путём`);
});

function makeRemote() {
  const scene = new THREE.Scene();
  const pool = createPool();
  const removed = [];
  const createLabel = (text) => {
    const o = new THREE.Object3D();
    o.userData.text = text;
    o.element = { remove: () => removed.push(text) };
    return o;
  };
  return { scene, pool, removed, remote: createRemotePlayers({ scene, pool, createLabel }) };
}

test('игрок: появляется после снимка, двигается с задержкой, уходит с освобождением ресурсов', () => {
  const { remote, scene, pool, removed } = makeRemote();
  remote.join(7, 'Борис', {});
  const group = scene.children[0];
  assert.equal(group.visible, false, 'до первого снимка позиции нет');
  assert.equal(group.children.find((c) => c.userData.text)?.userData.text, 'Борис');

  remote.snapshot([[7, 0, 0, 0, 0, 1]], 1000);
  remote.snapshot([[7, 10, 0, 0, 0, 1]], 1100);
  remote.update(1050 + INTERP_DELAY_MS);
  assert.equal(group.visible, true);
  assert.ok(Math.abs(group.position.x - 5) < 1e-9);
  remote.update(1100 + INTERP_DELAY_MS + 500);
  assert.equal(group.position.x, 10, 'после последнего снимка стоит на месте');

  remote.leave(7);
  assert.equal(remote.size, 0);
  assert.equal(scene.children.length, 0);
  assert.equal(pool.size, 0);
  assert.deepEqual(removed, ['Борис']);
  remote.leave(7); // повторный leave безопасен
});

test('players без player_join создаёт запасной аватар; clear и dispose убирают всех', () => {
  const { remote, scene, pool } = makeRemote();
  remote.snapshot([[9, 1, 0, 1, 0, 0]], 10);
  assert.equal(remote.size, 1);
  remote.join(9, 'Вера', {});
  assert.equal(remote.size, 1, 'повторный join заменяет аватар, а не дублирует');
  remote.join(10, 'Глеб', { color: 0xff0000 });
  assert.equal(scene.children.length, 2);
  remote.dispose();
  assert.equal(remote.size, 0);
  assert.equal(scene.children.length, 0);
  assert.equal(pool.size, 0);
});

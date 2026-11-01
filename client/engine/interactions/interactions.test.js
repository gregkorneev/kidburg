import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { INTERACT_LIMITS } from '../../../shared/interaction-contracts.js';
import { PLACE_RANK, createInteractionManager, pickWorldInteraction, segmentBlocked } from './interaction-manager.js';
import { MAX_EXTRAPOLATION_S, createBallRenderer, extrapolateBall } from './physics-renderer.js';
import { createCarrySystem } from './carry-system.js';
import { createPrefabKit } from '../art/prefab-kit.js';

const player = { x: 100, z: 100, yaw: Math.PI }; // смотрит в +Z

test('segmentBlocked: стена между точками блокирует, цель внутри стены — нет', () => {
  const wall = [{ minX: 95, maxX: 105, minZ: 101, maxZ: 102, maxY: 6 }];
  assert.equal(segmentBlocked(100, 100, 100, 104, wall), true);
  assert.equal(segmentBlocked(100, 100, 108, 100, wall), false);
  assert.equal(segmentBlocked(100, 100, 100, 101.5, wall), false);
  assert.equal(segmentBlocked(100, 100, 100, 104, [{ ...wall[0], maxY: 0.2 }]), false, 'низкое не мешает');
});

test('pick: ближайший мяч/предмет, предмет за спиной хуже, за стеной недоступен, в руках — только «поставить»', () => {
  const ball = { id: 'ball-1', x: 100, z: 101.5 };
  const crate = { id: 'crate-1', type: 'crate', state: 'available', x: 100, z: 101 };
  assert.equal(pickWorldInteraction({ player, balls: [ball], props: [crate] }).kind, 'take');
  assert.equal(pickWorldInteraction({ player, balls: [ball] }).kind, 'kick');
  const behind = { ...crate, id: 'c2', z: 99 };
  const front = { ...crate, id: 'c3', z: 99.2 + 2 };
  assert.equal(pickWorldInteraction({ player, props: [behind, { ...front, z: 101.2 }] }).id, 'c3');
  assert.equal(pickWorldInteraction({ player, props: [{ ...crate, z: 100 + INTERACT_LIMITS.TAKE_REACH + 1 }] }), null);
  const wall = [{ minX: 90, maxX: 110, minZ: 100.5, maxZ: 100.8, maxY: 5 }];
  assert.equal(pickWorldInteraction({ player, balls: [ball], colliders: wall }), null);
  const held = pickWorldInteraction({ player, balls: [], props: [crate], held: { id: 'cone-1', type: 'cone' } });
  assert.equal(held.kind, 'place');
  assert.equal(held.distance, PLACE_RANK);
  assert.equal(pickWorldInteraction({ player: { x: NaN, z: 1 } }), null);
});

function makeManager(extra = {}) {
  let t = 1000;
  const sent = [];
  const navigated = [];
  const requests = [];
  const manager = createInteractionManager({
    net: { status: 'open', send: (m) => (sent.push(m), true) },
    mechSync: { request: (id, active) => (requests.push([id, active]), true) },
    now: () => t,
    navigate: (href) => navigated.push(href),
    notify: () => {},
    ...extra,
  });
  return { manager, sent, navigated, requests, advance: (ms) => { t += ms; } };
}

test('менеджер: действия уходят на сервер с seq, быстрые повторы подавляются, отказ сервера сообщается', () => {
  const notices = [];
  const { manager, sent, advance } = makeManager({ notify: (m) => notices.push(m) });
  assert.equal(manager.activate({ kind: 'kick', id: 'ball-1' }, player), true);
  assert.equal(manager.activate({ kind: 'kick', id: 'ball-1' }, player), false, 'дребезг 220 мс');
  advance(300);
  assert.equal(manager.activate({ kind: 'take', id: 'crate-1' }, player), true);
  assert.deepEqual(sent.map((m) => [m.t, m.action, m.id]), [['interact', 'kick', 'ball-1'], ['interact', 'take', 'crate-1']]);
  assert.notEqual(sent[0].seq, sent[1].seq);
  const done = manager.onResult({ seq: sent[1].seq, ok: false, message: 'Руки заняты' });
  assert.equal(done.action, 'take');
  assert.deepEqual(notices, ['Руки заняты']);
});

test('менеджер: без соединения действие не отправляется', () => {
  const { manager, sent } = makeManager({ net: { status: 'closed', send: () => false } });
  assert.equal(manager.activate({ kind: 'take', id: 'crate-1' }, player), false);
  assert.equal(sent.length, 0);
});

test('менеджер: вход в станцию сразу запрашивает открытие двери и переходит', () => {
  const door = { id: 'door-bakery', kind: 'door', href: '/bakery-preview.html', x: 100, z: 101, radius: 4.2, object: { isOpen: false, progress: 0, open() {}, close() {} } };
  const { manager, navigated, requests, advance } = makeManager();
  manager.setMechanisms([door]);
  assert.equal(manager.activate({ href: door.href }, player), true);
  assert.deepEqual(requests, [['door-bakery', true]]);
  assert.equal(manager.busy, true);
  manager.update();
  assert.deepEqual(navigated, [door.href]);
  door.object.progress = 1;
  door.object.isOpen = true;
  manager.update();
  assert.deepEqual(navigated, [door.href]);

  const far = makeManager();
  far.manager.setMechanisms([door]);
  far.manager.activate({ href: door.href }, { x: 200, z: 200, yaw: 0 });
  assert.deepEqual(far.navigated, [door.href]);

  const timeout = makeManager();
  door.object.isOpen = false;
  door.object.progress = 0;
  timeout.manager.setMechanisms([door]);
  timeout.manager.activate({ href: door.href }, player);
  timeout.advance(3500);
  timeout.manager.update();
  assert.deepEqual(timeout.navigated, [door.href], 'по таймауту переходим, даже если сервер не ответил');
});

test('extrapolateBall: покоящийся мяч стоит, летящий падает и отскакивает, время ограничено, без NaN', () => {
  const rest = { x: 1, y: 0.26, z: 2, vx: 0, vy: 0, vz: 0, rest: true };
  assert.deepEqual(extrapolateBall(rest, 5), { x: 1, y: 0.26, z: 2, vx: 0, vy: 0, vz: 0 });
  const flying = { x: 0, y: 2, z: 0, vx: 3, vy: 0, vz: 0, rest: false };
  const later = extrapolateBall(flying, 0.3);
  assert.ok(later.x > 0.8 && later.y < 2 && later.y >= 0.26);
  const long = extrapolateBall(flying, 100);
  const capped = extrapolateBall(flying, MAX_EXTRAPOLATION_S);
  assert.deepEqual(long, capped);
  for (const v of Object.values(long)) assert.ok(Number.isFinite(v));
  const ground = extrapolateBall({ x: 0, y: 0.26, z: 0, vx: 5, vy: 0, vz: 0, rest: false }, 0.4);
  assert.ok(ground.x > 0 && ground.x < 2 && ground.y === 0.26);
});

test('рендерер мячей: снимок, телепорт, устаревший снимок, меши только в загруженных чанках', () => {
  const scene = new THREE.Scene();
  let loaded = true;
  let clock = 0;
  const renderer = createBallRenderer({ scene, isLoaded: () => loaded, now: () => clock });
  assert.equal(renderer.snapshot({ tick: 10, list: [['ball-1', 458, 0.26, 378, 0, 0, 0, 1]] }), true);
  assert.equal(renderer.snapshot({ tick: 3, list: [['ball-1', 0, 0.26, 0, 0, 0, 0, 1]] }), false, 'старый снимок игнорируется');
  renderer.update(0.016);
  assert.equal(renderer.positions().length, 1);
  assert.equal(renderer.positions()[0].x, 458);
  renderer.snapshot({ tick: 11, list: [['ball-1', 470, 0.26, 378, 0, 0, 0, 3]] });
  renderer.update(0.016);
  assert.equal(renderer.positions()[0].x, 470, 'флаг телепорта показывает сразу');
  loaded = false;
  renderer.update(0.016);
  assert.equal(renderer.positions().length, 0);
  renderer.resetClock();
  assert.equal(renderer.snapshot({ tick: 1, list: [] }), true);
  renderer.dispose();
  assert.equal(renderer.size, 0);
});

function holderGroup() {
  const parent = new THREE.Group();
  parent.updateMatrixWorld(true);
  return parent;
}

test('carry-system: предмет на земле, в руках игрока и обратно; устаревшая ревизия игнорируется; без утечек', () => {
  const scene = new THREE.Scene();
  const holder = holderGroup();
  scene.add(holder);
  const system = createCarrySystem({
    scene,
    isLoaded: () => true,
    anchorOf: (id) => (id === 7 ? { parent: holder, scale: 1, forward: 1 } : null),
    selfId: () => 7,
  });
  system.snapshot([{ id: 'crate-1', type: 'crate', x: 10, z: 20, ry: 0, state: 'available', holder: 0, rev: 1 }]);
  system.update(0.016);
  assert.equal(system.groundProps().length, 1);
  assert.equal(scene.children.filter((c) => c.name.startsWith('prop:')).length, 1);

  assert.equal(system.state({ id: 'crate-1', type: 'crate', x: 10, z: 20, ry: 0, state: 'held', holder: 7, rev: 2 }), true);
  system.update(0.3);
  system.update(0.3);
  assert.equal(system.heldByMe().id, 'crate-1');
  assert.equal(holder.children.length, 1, 'предмет прикреплён к игроку');
  assert.equal(system.groundProps().length, 0);

  assert.equal(system.state({ id: 'crate-1', type: 'crate', x: 11, z: 21, ry: 0, state: 'placed', holder: 0, rev: 1 }), false, 'старая ревизия');
  assert.equal(system.heldByMe().id, 'crate-1');

  system.state({ id: 'crate-1', type: 'crate', x: 11, z: 21, ry: 0, state: 'placed', holder: 0, rev: 3 });
  for (let i = 0; i < 10; i++) system.update(0.1);
  assert.equal(holder.children.length, 0);
  const mesh = scene.children.find((c) => c.name === 'prop:crate');
  assert.ok(Math.abs(mesh.position.x - 11) < 1e-6 && Math.abs(mesh.position.z - 21) < 1e-6);

  system.dispose();
  assert.equal(scene.children.filter((c) => c.name.startsWith('prop:')).length, 0);
});

test('carry-system: предмет в незагруженном чанке не создаёт Mesh', () => {
  const scene = new THREE.Scene();
  const system = createCarrySystem({ scene, isLoaded: () => false, anchorOf: () => null, selfId: () => 1 });
  system.snapshot([{ id: 'cone-1', type: 'cone', x: 1, z: 1, ry: 0, state: 'available', holder: 0, rev: 1 }]);
  system.update(0.016);
  assert.equal(scene.children.length, 0);
});

test('prefab-kit door: leaves=false оставляет только раму, без створок', () => {
  const count = (leaves) => {
    const k = createPrefabKit({ seed: 1 });
    k.door(0, 0, 0, { w: 2.4, h: 2.6, leaves });
    return k.count;
  };
  assert.ok(count(false) < count(true));
});

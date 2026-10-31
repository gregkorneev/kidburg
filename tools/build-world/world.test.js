import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decode } from '@msgpack/msgpack';
import { buildCityWorld, makeCityChunk, BUILDING_PREFAB_IDS, PLAZA_PREFAB_ID } from './index.js';
import { BUILDINGS } from './layout.js';
import { WORLD_POINTS } from '../../client/stations/firefighter/layout.js';

let dir;
let world;
test.before(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'kidburg-world-'));
  buildCityWorld(dir);
  world = JSON.parse(readFileSync(path.join(dir, 'world.json'), 'utf8'));
});
test.after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

test('мир содержит 144 файла чанков и точный индекс размеров', () => {
  assert.equal(Object.keys(world.bytes).length, 144);
  assert.equal(world.totalBytes, Object.values(world.bytes).reduce((a, b) => a + b, 0));
  for (let cz = 0; cz < 12; cz++) for (let cx = 0; cx < 12; cx++) {
    const binary = readFileSync(path.join(dir, 'chunks', `${cx}_${cz}.bin`));
    assert.equal(binary.length, world.bytes[`${cx}_${cz}`]);
    const data = decode(binary);
    assert.equal(data.cx, cx);
    assert.equal(data.cz, cz);
    assert.equal(data.v, 1);
  }
});

test('площадь и шесть зданий представлены ровно по одному разу', () => {
  const ids = new Map();
  for (let cz = 0; cz < 12; cz++) for (let cx = 0; cx < 12; cx++) {
    const c = makeCityChunk(cx, cz);
    for (const i of c.instances) ids.set(i[0], (ids.get(i[0]) || 0) + 1);
  }
  for (const b of BUILDINGS) assert.equal(ids.get(BUILDING_PREFAB_IDS[b.id]), 1, b.name);
  assert.equal(ids.get(PLAZA_PREFAB_ID), 1);
});

test('Маруся зарегистрирована для пожарной локации, но не размещена в чанках города', () => {
  const marusya = { id: 'npc_marusya', agentId: 'marusya', x: WORLD_POINTS.npc.x, y: WORLD_POINTS.npc.y, z: WORLD_POINTS.npc.z, ry: 0 };
  assert.deepEqual(world.npcs, [marusya]);
  for (let cz = 0; cz < 12; cz++) for (let cx = 0; cx < 12; cx++) {
    assert.deepEqual(makeCityChunk(cx, cz).npcs, []);
    const chunk = decode(readFileSync(path.join(dir, 'chunks', `${cx}_${cz}.bin`)));
    assert.deepEqual(chunk.npcs, []);
  }
});

test('центральные девять чанков укладываются в 10% байтового лимита', () => {
  let centerBytes = 0;
  for (let cz = 5; cz <= 7; cz++) for (let cx = 5; cx <= 7; cx++) centerBytes += world.bytes[`${cx}_${cz}`];
  assert.ok(centerBytes <= Math.floor(world.totalBytes * 0.1), `${centerBytes}/${world.totalBytes}`);
});

test('все инстансы находятся в правильном чанке и используются известные prefabId', () => {
  const known = new Set(world.prefabs.map(p => p.id));
  for (let cz = 0; cz < 12; cz++) for (let cx = 0; cx < 12; cx++) {
    const c = makeCityChunk(cx, cz);
    assert.equal(c.heights.length, 289);
    for (const [id, x, y, z, ry, scale] of c.instances) {
      assert.ok(known.has(id));
      assert.equal(Math.floor(x / 64), cx);
      assert.equal(Math.floor(z / 64), cz);
      assert.ok([x, y, z, ry, scale].every(Number.isFinite));
    }
  }
});

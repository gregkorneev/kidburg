import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { encode } from '@msgpack/msgpack';
import { buildFireStationGeometry } from './fire-station.js';
import { getPrefab } from './prefabs.js';
import { createChunkManager } from './chunks.js';
import { createPool } from './pool.js';

test('пожарная часть: цветной двухэтажный фасад и коллайдер', () => {
  const prefab=getPrefab(11);
  assert.equal(prefab.name,'fire_station');
  assert.equal(prefab.vertexColors,true);
  assert.deepEqual(prefab.collider,[24,9,16]);
  const g=buildFireStationGeometry();
  const c=g.getAttribute('color');
  assert.ok(c);
  assert.ok(c.count>300);
  const colors=new Set();
  for(let i=0;i<c.count;i++) colors.add(`${c.getX(i).toFixed(2)} ${c.getY(i).toFixed(2)} ${c.getZ(i).toFixed(2)}`);
  assert.ok(colors.size>=8);
  assert.ok(g.boundingBox.max.y>10);
  assert.ok(g.boundingBox.min.y>=-0.01);
  assert.ok(g.boundingBox.min.x>=-12 && g.boundingBox.max.x<=12);
  g.dispose();
});

test('пожарная часть: InstancedMesh выгружается вместе с чанком',()=>{
 const scene=new THREE.Scene(),pool=createPool();
 const manager=createChunkManager({scene,pool});
 const bytes=encode({v:1,cx:5,cz:6,zone:'plain',heights:new Float32Array(289),instances:[[11,382,0,412,Math.PI/2,1]],npcs:[]});
 manager.load(5,6,bytes);
 const mesh=scene.children[0].children.find(o=>o.isInstancedMesh);
 assert.ok(mesh);
 assert.equal(mesh.material.vertexColors,true);
 manager.unload(5,6);
 assert.equal(pool.size,0);
 assert.equal(scene.children.length,0);
});

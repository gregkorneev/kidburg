import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { encode } from '@msgpack/msgpack';
import { getPrefab } from './prefabs.js';
import { createPool } from './pool.js';
import { createChunkManager } from './chunks.js';

test('радиостанция: цветной фасад, антенна и коллайдер',()=>{
  const p=getPrefab(15);
  assert.equal(p.name,'radio_station');
  assert.deepEqual(p.collider,[18,9,14]);
  assert.equal(p.vertexColors,true);
  const g=p.build();g.computeBoundingBox();
  assert.ok(g.boundingBox.max.y>15,'антенна возвышается над крышей');
  assert.ok(g.boundingBox.min.y>=-0.01);
  assert.ok(g.getAttribute('color'));
  g.dispose();
});

test('радиостанция: геометрия и материалы выгружаются с чанком',()=>{
  const scene=new THREE.Scene(),pool=createPool();
  const manager=createChunkManager({scene,pool});
  manager.load(6,6,encode({v:1,cx:6,cz:6,zone:'plain',heights:new Float32Array(289),instances:[[15,424,0,424,0,1]],npcs:[]}));
  const mesh=scene.children[0].children.find(o=>o.isInstancedMesh);
  assert.ok(mesh);
  assert.equal(mesh.material.vertexColors,true);
  manager.unload(6,6);
  assert.equal(pool.size,0);
  assert.equal(scene.children.length,0);
});

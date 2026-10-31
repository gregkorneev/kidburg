import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { encode } from '@msgpack/msgpack';
import { buildCityPlazaGeometry } from './city-plaza.js';
import { getPrefab } from './prefabs.js';
import { createChunkManager } from './chunks.js';
import { createPool } from './pool.js';

test('площадь: брусчатка, фонтан и многоцветная геометрия',()=>{
  const prefab=getPrefab(20);
  assert.equal(prefab.vertexColors,true);
  assert.equal(prefab.collider,null);
  const g=buildCityPlazaGeometry();
  assert.ok(g.attributes.position.count>10000);
  assert.ok(g.getAttribute('color'));
  g.computeBoundingBox();
  assert.ok(g.boundingBox.max.y>=4,'фонари выше покрытия');
  assert.ok(g.boundingBox.min.x>=-22.01);
  assert.ok(g.boundingBox.max.x<=22.01);
  assert.ok(g.boundingBox.min.z>=-22.01);
  assert.ok(g.boundingBox.max.z<=22.01);
  g.dispose();
});

test('площадь: выгружается с чанком без утечек пула',()=>{
  const scene=new THREE.Scene();
  const pool=createPool();
  const manager=createChunkManager({scene,pool});
  const bytes=encode({v:1,cx:6,cz:6,zone:'plain',heights:new Float32Array(289),instances:[[20,416,0,416,0,1]],npcs:[]});
  manager.load(6,6,bytes);
  const mesh=scene.children[0].children.find(o=>o.isInstancedMesh);
  assert.ok(mesh);
  assert.equal(mesh.material.vertexColors,true);
  assert.ok(mesh.geometry.getAttribute('color'));
  manager.unload(6,6);
  assert.equal(scene.children.length,0);
  assert.equal(pool.size,0);
});

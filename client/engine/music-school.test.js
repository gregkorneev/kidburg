import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { encode } from '@msgpack/msgpack';
import { getPrefab } from './prefabs.js';
import { createPool } from './pool.js';
import { createChunkManager } from './chunks.js';

test('музыкальная школа: цветная геометрия, вывеска и размеры',()=>{
  const p=getPrefab(14);
  assert.equal(p.name,'music_school');
  assert.equal(p.vertexColors,true);
  assert.equal(p.color,0xffffff);
  assert.deepEqual(p.collider,[22,9,14]);
  const g=p.build();g.computeBoundingBox();
  assert.ok(g.boundingBox.max.y>11);
  assert.ok(g.getAttribute('color').count>100);
  g.dispose();
});
test('музыкальная школа: InstancedMesh освобождается с чанком',()=>{
  const scene=new THREE.Scene();const pool=createPool();
  const manager=createChunkManager({scene,pool});
  const bytes=encode({v:1,cx:6,cz:7,zone:'plain',heights:new Float32Array(289),instances:[[14,416,0,456,Math.PI,1]],npcs:[]});
  manager.load(6,7,bytes);
  const mesh=scene.children[0].children.find(o=>o.isInstancedMesh);
  assert.ok(mesh);assert.equal(mesh.material.vertexColors,true);
  manager.unload(6,7);assert.equal(pool.size,0);assert.equal(scene.children.length,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { encode } from '@msgpack/msgpack';
import { buildBakeryGeometry } from './bakery.js';
import { getPrefab } from './prefabs.js';
import { createChunkManager } from './chunks.js';
import { createPool } from './pool.js';

test('пекарня: цветной фасад и корректный префаб', () => {
  const p=getPrefab(12);
  assert.equal(p.name,'bakery');
  assert.equal(p.vertexColors,true);
  assert.deepEqual(p.collider,[18,9,14]);
  const g=buildBakeryGeometry();
  g.computeBoundingBox();
  assert.ok(g.boundingBox.max.y > 10);
  assert.ok(g.boundingBox.min.y >= 0);
  assert.ok(g.getAttribute('color'));
  const colors=new Set();
  const a=g.getAttribute('color').array;
  for(let i=0;i<a.length;i+=3) colors.add(a[i].toFixed(2)+','+a[i+1].toFixed(2)+','+a[i+2].toFixed(2));
  assert.ok(colors.size >= 8);
  g.dispose();
});

test('пекарня: чанковый рендеринг выгружает ресурсы', () => {
  const scene=new THREE.Scene(), pool=createPool();
  const manager=createChunkManager({scene,pool});
  const bytes=encode({v:1,cx:7,cz:6,zone:'plain',heights:new Float32Array(289),instances:[[12,450,0,412,-Math.PI/2,1]],npcs:[]});
  manager.load(7,6,bytes);
  const mesh=scene.children[0].children.find(x=>x.isInstancedMesh);
  assert.ok(mesh);
  assert.equal(mesh.material.vertexColors,true);
  manager.unload(7,6);
  assert.equal(pool.size,0);
  assert.equal(scene.children.length,0);
});

import * as THREE from 'three';
import { PLAZA } from '../../tools/build-world/layout.js';
import { ANIMAL_SPECS } from './plaza-animal-simulation.js';
export { AnimalNpc, ANIMAL_SPECS, animalPointClear, FLEE_DISTANCE, CALM_DISTANCE } from './plaza-animal-simulation.js';

function model(spec) {
  const group = new THREE.Group(), body = new THREE.Group(); group.add(body);
  const materials = [new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.9 }), new THREE.MeshStandardMaterial({ color: 0x40302c, roughness: 0.9 })];
  const geometries = [];
  function box(w, h, d, x, y, z, material = materials[0], parent = body) {
    const geometry = new THREE.BoxGeometry(w, h, d); geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  }
  const dog = spec.type === 'dog';
  box(0.48, 0.38, dog ? 0.82 : 0.68, 0, 0.52, 0);
  box(0.4, 0.36, 0.36, 0, 0.72, 0.43);
  box(dog ? 0.27 : 0.19, 0.15, 0.22, 0, 0.65, 0.67, materials[1]);
  for (const side of [-1, 1]) box(0.12, dog ? 0.25 : 0.2, 0.13, side * 0.16, dog ? 0.78 : 0.97, 0.42, dog ? materials[1] : materials[0]);
  const legs = [];
  for (const x of [-0.16, 0.16]) for (const z of [-0.25, 0.25]) {
    const pivot = new THREE.Group(); pivot.position.set(x, 0.4, z); body.add(pivot);
    box(0.12, 0.35, 0.12, 0, -0.17, 0, materials[0], pivot); legs.push(pivot);
  }
  const tail = box(0.1, 0.1, dog ? 0.44 : 0.52, 0, 0.69, -0.52); tail.rotation.x = -0.4;
  return { group, body, legs, tail, geometries, materials };
}

export function createPlazaAnimals({ scene }) {
  const animals = ANIMAL_SPECS.map((spec) => ({ npc: { type: spec.type }, visual: model(spec), phase: 0 }));
  for (const { visual } of animals) { visual.group.visible = false; scene.add(visual.group); }
  return {
    animals,
    snapshot(list) {
      list.forEach((row, i) => {
        const a = animals[i];
        if (!a) return;
        Object.assign(a.npc, row);
        a.visual.group.visible = true;
        a.visual.group.position.set(PLAZA.x + row.x, 0.11, PLAZA.z + row.z);
        a.visual.group.rotation.y = row.direction;
      });
    },
    clear() { for (const { visual } of animals) visual.group.visible = false; },
    update(dt) {
      for (const a of animals) {
        const n = a.npc, v = a.visual;
        a.phase += Math.min(0.05, Math.max(0, dt)) * (n.mode === 'flee' ? 14 : 8);
        const amplitude = n.speed ? 0.45 : 0;
        v.legs.forEach((leg, i) => { leg.rotation.x = Math.sin(a.phase + (i === 0 || i === 3 ? 0 : Math.PI)) * amplitude; });
        v.body.position.y = n.speed ? Math.abs(Math.sin(a.phase)) * 0.025 : 0;
        v.tail.rotation.y = Math.sin(a.phase * 0.5) * 0.18;
      }
    },
    dispose() { for (const { visual: v } of animals) { scene.remove(v.group); v.geometries.forEach((g) => g.dispose()); v.materials.forEach((m) => m.dispose()); } },
  };
}

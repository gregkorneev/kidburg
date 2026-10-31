import * as THREE from 'three';

export const ROOM = Object.freeze({ width: 20, depth: 15, height: 6 });

export const FLORIST_PLAN = Object.freeze({
  spawn: Object.freeze(new THREE.Vector3(6, 0, 4)),
  stations: Object.freeze({
    lilia: new THREE.Vector3(10, 0, 3.45),
    handoff: new THREE.Vector3(4, 0, 3.4),
    workbench: new THREE.Vector3(10, 0, 9.85),
    wrapping: new THREE.Vector3(13, 0, 12.1),
  }),
  desks: Object.freeze({
    mentor: Object.freeze({ x: 10, z: 2.05, width: 4.5, depth: 0.9 }),
    handoff: Object.freeze({ x: 4, z: 2.05, width: 2.8, depth: 0.9 }),
    workbench: Object.freeze({ x: 10, z: 8.0, width: 5.8, depth: 2.0 }),
    wrapping: Object.freeze({ x: 16, z: 12.1, width: 3.0, depth: 1.4 }),
  }),
  buckets: Object.freeze({
    pink_tulip: Object.freeze({ x: 2.45, z: 5.0 }),
    white_daisy: Object.freeze({ x: 2.45, z: 10.2 }),
    red_rose: Object.freeze({ x: 17.55, z: 5.0 }),
    greenery: Object.freeze({ x: 17.55, z: 10.2 }),
  }),
  bouquet: Object.freeze({ x: 10, y: 1.16, z: 8 }),
  wrappedBouquet: Object.freeze({
    wrapping: new THREE.Vector3(16, 1.12, 12.1),
    handoff: new THREE.Vector3(4, 1.16, 2.55),
  }),
  lilia: Object.freeze({ x: 10, y: 0, z: 1.18 }),
  handoffDecor: Object.freeze({ x: 4, z: 2.05 }),
  wrappingTargetRadius: 2.05,
});

import * as THREE from 'three';
import { stdMat } from '../../engine/art/materials.js';
import { disposeOwned } from '../../engine/animated.js';

// Настольный тестомес: собственные геометрии удаляются вместе с интерьером.
export function createMixer() {
  const root = new THREE.Group();
  root.name = 'bakery-mixer';
  const cream = stdMat(0xf5e8d0);
  const red = stdMat(0xc95c49);
  const metal = stdMat(0xb5c4c3, { metalness: 0.35, roughness: 0.4 });
  function mesh(geometry, material, parent, x, y, z) {
    const item = new THREE.Mesh(geometry, material);
    item.position.set(x, y, z);
    item.castShadow = true;
    parent.add(item);
    return item;
  }
  mesh(new THREE.BoxGeometry(0.7, 0.1, 0.55), cream, root, 0, 0.05, 0);
  mesh(new THREE.BoxGeometry(0.18, 0.63, 0.24), red, root, -0.25, 0.37, 0);
  mesh(new THREE.CylinderGeometry(0.23, 0.16, 0.27, 16, 1, true), metal, root, 0.06, 0.25, 0);
  const head = new THREE.Group();
  head.position.set(-0.25, 0.69, 0);
  root.add(head);
  mesh(new THREE.BoxGeometry(0.66, 0.18, 0.34), red, head, 0.25, 0, 0);
  mesh(new THREE.SphereGeometry(0.055, 8, 6), cream, head, 0.42, 0.02, 0.18);
  const hook = new THREE.Group();
  hook.position.set(0.31, -0.09, 0);
  head.add(hook);
  mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.28, 8), metal, hook, 0, -0.14, 0);
  mesh(new THREE.TorusGeometry(0.09, 0.018, 6, 12, Math.PI), metal, hook, 0.07, -0.27, 0);
  let remaining = 0;
  let speed = 0;
  let raised = 1;
  head.rotation.z = 0.35;
  return {
    root, head, hook,
    start() { remaining = 5; },
    stop() { remaining = 0; },
    update(dt) {
      remaining = Math.max(0, remaining - dt);
      const working = remaining > 0;
      const targetSpeed = remaining > 0.6 && remaining < 4.5 ? 9 : 0;
      speed += (targetSpeed - speed) * (1 - Math.exp(-4 * dt));
      raised += ((working || speed > 0.2 ? 0 : 1) - raised) * (1 - Math.exp(-3 * dt));
      head.rotation.z = raised * 0.35;
      hook.rotation.y += speed * dt;
    },
    dispose() { disposeOwned(root); root.removeFromParent(); },
  };
}

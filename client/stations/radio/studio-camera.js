import * as THREE from 'three';

export function createStudioCamera(aspect = 1) {
  const camera = new THREE.PerspectiveCamera(40, aspect, 0.1, 50);
  // Fixed seated host point of view: monitor centered, microphone left, mixer at the lower edge.
  camera.position.set(0, 2.75, 5.35);
  camera.lookAt(0, 2.45, -1.05);
  return camera;
}

import * as THREE from 'three';

export function createStudioLighting(scene) {
  scene.background = new THREE.Color('#dce8e3');
  scene.fog = new THREE.Fog('#dce8e3', 15, 32);

  const ambient = new THREE.HemisphereLight('#fff5df', '#79533d', 2.0);
  scene.add(ambient);

  const key = new THREE.DirectionalLight('#ffe1ad', 2.2);
  key.position.set(-4, 8, 6);
  scene.add(key);

  const windowGlow = new THREE.PointLight('#8ed2d0', 1.2, 9, 2);
  windowGlow.position.set(0, 3.5, -2.85);
  scene.add(windowGlow);

  const monitorFill = new THREE.PointLight('#d5e8ed', 1.15, 4.8, 2);
  monitorFill.position.set(0, 2.58, -1.82);
  monitorFill.name = 'monitor-fill';
  scene.add(monitorFill);

  const onAirGlow = new THREE.PointLight('#ff493e', 0.55, 3.2, 2);
  onAirGlow.position.set(4.08, 4.05, -3.22);
  onAirGlow.visible = false;
  onAirGlow.name = 'on-air-glow';
  scene.add(onAirGlow);

  return { ambient, key, windowGlow, monitorFill, onAirGlow };
}

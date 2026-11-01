import * as THREE from 'three';
import { createStudioCanvas } from './studio-canvas.js';

export function createOnAirIndicator(materials) {
  const group = new THREE.Group();
  group.name = 'on-air-indicator';

  const housing = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.56, 0.2), materials.woodDark);
  housing.position.y = 0.28;
  group.add(housing);

  const face = new THREE.Mesh(new THREE.BoxGeometry(1.54, 0.4, 0.045), materials.onAirOff);
  face.position.set(0, 0.28, 0.12);
  face.name = 'on-air-face';
  group.add(face);

  const labelCanvas = createStudioCanvas(512, 128);
  const context = labelCanvas.getContext('2d');
  context.font = 'bold 76px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#fff7e8';
  context.shadowColor = '#54201d';
  context.shadowBlur = 8;
  context.fillText('ON AIR', 256, 68);
  const labelTexture = new THREE.CanvasTexture(labelCanvas);
  labelTexture.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(1.22, 0.31),
    new THREE.MeshBasicMaterial({ map: labelTexture, transparent: true }),
  );
  label.position.set(0, 0.28, 0.148);
  group.add(label);

  let isOnAir = false;
  function setOnAir(value) {
    isOnAir = Boolean(value);
    face.material = isOnAir ? materials.onAirOn : materials.onAirOff;
    return isOnAir;
  }

  return { group, setOnAir, getOnAir: () => isOnAir };
}

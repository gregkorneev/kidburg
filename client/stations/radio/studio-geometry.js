import * as THREE from 'three';
import { createMonitorMount } from './monitor-mount.js';
import { createOnAirIndicator } from './on-air.js';
import { createStudioCanvas } from './studio-canvas.js';

const geometryPools = new WeakMap();

function pooledGeometry(material, type, dimensions, createGeometry) {
  let pool = geometryPools.get(material);
  if (!pool) {
    pool = new Map();
    geometryPools.set(material, pool);
  }
  const key = `${type}:${dimensions.join(',')}`;
  if (!pool.has(key)) pool.set(key, createGeometry());
  return pool.get(key);
}

export function createStudioMaterials() {
  const standard = (color, roughness = 0.82, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
  return {
    wall: standard('#e7d7bd'), wallSide: standard('#cfbda2'), floor: standard('#8c715a'),
    wood: standard('#80533c'), woodDark: standard('#563c34'), woodLight: standard('#aa7955'),
    metal: standard('#586c72', 0.42, { metalness: 0.45 }), black: standard('#292f34', 0.56),
    monitorFrame: standard('#34424b', 0.48), speaker: standard('#46545a'),
    speakerCone: standard('#222c31', 0.7), panel: standard('#a36b53'), panelAlt: standard('#b67e61'),
    glass: standard('#50777e', 0.24, { metalness: 0.12, transparent: true, opacity: 0.42 }),
    glassFrame: standard('#536c70'), mint: standard('#8bc9b8', 0.4), yellow: standard('#edbd69'),
    red: standard('#ee594b', 0.42, { emissive: '#7f100b', emissiveIntensity: 0.4 }),
    onAirOff: standard('#331f21'), onAirOn: new THREE.MeshStandardMaterial({ color: '#e6493d', emissive: '#ff3023', emissiveIntensity: 1.7, roughness: 0.35 }),
    blue: standard('#5c91a0'), cream: standard('#f2e5c8'),
  };
}

function addBox(group, material, size, position, name = '') {
  const mesh = new THREE.Mesh(
    pooledGeometry(material, 'box', size, () => new THREE.BoxGeometry(...size)),
    material,
  );
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = name;
  group.add(mesh);
  return mesh;
}

function addCylinder(group, material, radiusTop, radiusBottom, height, position, segments = 10) {
  const dimensions = [radiusTop, radiusBottom, height, segments];
  const mesh = new THREE.Mesh(
    pooledGeometry(material, 'cylinder', dimensions, () => new THREE.CylinderGeometry(...dimensions)),
    material,
  );
  mesh.position.set(...position);
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

function addCylinderBetween(group, material, start, end, radius, name) {
  const startPoint = new THREE.Vector3(...start);
  const endPoint = new THREE.Vector3(...end);
  const direction = new THREE.Vector3().subVectors(endPoint, startPoint);
  const mesh = addCylinder(
    group,
    material,
    radius,
    radius,
    direction.length(),
    startPoint.clone().add(endPoint).multiplyScalar(0.5).toArray(),
    8,
  );
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.name = name;
  return mesh;
}

export function createStudioGeometry(scene, { overlayRoot, camera } = {}) {
  const group = new THREE.Group();
  group.name = 'radio-studio';
  const materials = createStudioMaterials();

  // Warm, compact room shell with a cutaway front for the preview camera.
  addBox(group, materials.floor, [10.4, 0.18, 7.4], [0, -0.09, -0.05], 'studio-floor');
  addBox(group, materials.wall, [10.4, 4.8, 0.2], [0, 2.3, -3.8], 'back-wall');
  addBox(group, materials.wallSide, [0.2, 4.8, 7.4], [-5.1, 2.3, -0.05], 'left-wall');
  addBox(group, materials.wallSide, [0.2, 4.8, 7.4], [5.1, 2.3, -0.05], 'right-wall');
  addBox(group, materials.woodDark, [10.2, 0.28, 0.22], [0, 0.18, -3.62]);
  addBox(group, materials.cream, [10.2, 0.09, 0.18], [0, 4.48, -3.62]);

  // Acoustic treatment sits to either side of the control-room window.
  for (const x of [-4.15, 4.15]) {
    for (const y of [1.55, 2.65]) {
      addBox(group, materials.woodDark, [1.16, 0.93, 0.1], [x, y, -3.71], 'acoustic-panel-frame');
      addBox(group, materials.panel, [1.05, 0.82, 0.12], [x, y, -3.67], 'acoustic-panel');
      for (let rib = -1; rib <= 1; rib++) addBox(group, materials.panelAlt, [0.08, 0.66, 0.04], [x + rib * 0.28, y, -3.585], 'acoustic-panel-rib');
    }
  }
  addBox(group, materials.glassFrame, [6.4, 1.55, 0.16], [0, 3.65, -3.63], 'control-room-window-frame');
  addBox(group, materials.glass, [6.17, 1.32, 0.04], [0, 3.65, -3.52], 'control-room-window');
  for (const x of [-2.9, 2.9]) addBox(group, materials.glassFrame, [0.07, 1.32, 0.06], [x, 3.65, -3.48], 'control-room-window-mullion');
  addBox(group, materials.glassFrame, [6.17, 0.06, 0.06], [0, 4.04, -3.48], 'control-room-window-transom');
  // Simple rack silhouettes remain visible in the narrow glass area beside the monitor.
  for (const x of [-2.91, 2.91]) {
    addBox(group, materials.speakerCone, [0.25, 0.53, 0.08], [x, 3.43, -3.62], 'control-room-rack');
    addBox(group, materials.blue, [0.16, 0.22, 0.02], [x, 3.5, -3.575], 'control-room-screen');
    addBox(group, materials.mint, [0.035, 0.035, 0.025], [x - 0.055, 3.19, -3.555], 'control-room-status-light');
    addBox(group, materials.yellow, [0.035, 0.035, 0.025], [x + 0.055, 3.19, -3.555], 'control-room-status-light');
  }

  // Broad desk and two modest storage pedestals create a clear workstation zone.
  addBox(group, materials.wood, [5.75, 0.22, 1.58], [0, 1.12, 0.32], 'host-desk');
  addBox(group, materials.woodLight, [5.62, 0.055, 1.48], [0, 1.25, 0.32], 'host-desk-surface');
  for (const x of [-2.12, 2.12]) {
    addBox(group, materials.woodDark, [0.28, 1.02, 1.22], [x, 0.53, 0.35]);
    addBox(group, materials.woodLight, [0.32, 0.08, 1.26], [x, 0.74, 0.35]);
    addBox(group, materials.woodLight, [0.32, 0.08, 1.26], [x, 0.37, 0.35]);
  }

  // Monitor, sound pair and compact mixing desk.
  const monitorMount = createMonitorMount(materials, { overlayRoot, camera });
  group.add(monitorMount.group);
  for (const x of [-2.48, 2.48]) {
    addBox(group, materials.speaker, [0.62, 0.86, 0.55], [x, 1.7075, -1.98], 'studio-speaker');
    for (const [y, radius] of [[1.8675, 0.17], [1.5275, 0.095]]) {
      const cone = new THREE.Mesh(
        pooledGeometry(materials.speakerCone, 'circle', [radius, 12], () => new THREE.CircleGeometry(radius, 12)),
        materials.speakerCone,
      );
      cone.position.set(x, y, -1.69);
      group.add(cone);
    }
  }
  const mixer = new THREE.Group();
  mixer.name = 'compact-mixer';
  mixer.position.set(0, 1.415, 0.05);
  mixer.rotation.x = -0.12;
  group.add(mixer);
  addBox(mixer, materials.black, [1.72, 0.16, 0.96], [0, 0, 0], 'mixer-base');
  for (const x of [-0.65, 0.65]) {
    addBox(group, materials.black, [0.16, 0.115, 0.16], [x, 1.335, 0.46], 'mixer-support-foot');
  }
  addBox(mixer, materials.metal, [1.55, 0.025, 0.8], [0, 0.094, 0]);
  const faderLevels = [-0.17, 0.08, -0.04, 0.18, -0.11];
  for (let i = 0; i < 5; i++) {
    const x = -0.58 + i * 0.29;
    addBox(mixer, materials.cream, [0.028, 0.012, 0.46], [x, 0.112, -0.025]);
    const fader = addBox(mixer, i === 1 ? materials.mint : materials.yellow, [0.11, 0.045, 0.14], [x, 0.14, faderLevels[i]]);
    fader.name = 'mixer-fader';
    fader.rotation.x = -0.12;
  }
  for (let i = 0; i < 7; i++) {
    const x = -0.63 + i * 0.21;
    const material = i === 4 ? materials.red : materials.blue;
    const dimensions = [0.045, 0.05, 0.045, 8];
    const button = new THREE.Mesh(
      pooledGeometry(material, 'cylinder', dimensions, () => new THREE.CylinderGeometry(...dimensions)),
      material,
    );
    button.name = 'mixer-button';
    button.position.set(x, 0.129, 0.38);
    mixer.add(button);
  }
  for (const [index, x] of [-0.54, 0, 0.54].entries()) {
    const knob = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.085, 0.075, 8),
      [materials.woodLight, materials.mint, materials.yellow][index],
    );
    knob.name = 'mixer-knob';
    knob.position.set(x, 0.144, -0.36);
    mixer.add(knob);
  }

  // Articulated broadcast microphone on the host's left, kept clear of the monitor.
  const mic = new THREE.Group();
  mic.name = 'broadcast-microphone';
  mic.position.set(-1.92, 1.305, 0.72);
  group.add(mic);
  addBox(mic, materials.metal, [0.5, 0.055, 0.38], [0, 0, 0], 'microphone-table-base');
  const basePivot = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6), materials.metal);
  basePivot.position.set(0.12, 0.06, 0);
  basePivot.name = 'microphone-base-pivot';
  mic.add(basePivot);
  const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.095, 8, 6), materials.metal);
  elbow.position.set(-0.36, 0.62, 0);
  elbow.name = 'microphone-boom-joint';
  mic.add(elbow);
  const hingePin = addCylinder(mic, materials.woodDark, 0.045, 0.045, 0.19, [-0.36, 0.62, 0], 8);
  hingePin.rotation.x = Math.PI / 2;
  hingePin.name = 'microphone-hinge-pin';
  addCylinderBetween(mic, materials.metal, [0.12, 0.06, 0], [-0.36, 0.62, 0], 0.045, 'microphone-boom-lower');
  addCylinderBetween(mic, materials.metal, [-0.36, 0.62, 0], [-0.56, 1.0, -0.08], 0.04, 'microphone-boom-upper');
  const micBody = addCylinder(mic, materials.black, 0.105, 0.105, 0.5, [-0.72, 1.0, -0.08], 10);
  micBody.rotation.z = Math.PI / 2;
  micBody.name = 'microphone-body';
  const micMount = addCylinder(mic, materials.metal, 0.13, 0.13, 0.12, [-0.58, 1.0, -0.08], 10);
  micMount.rotation.z = Math.PI / 2;
  micMount.name = 'microphone-holder';
  const grille = addCylinder(mic, materials.speakerCone, 0.13, 0.13, 0.14, [-0.44, 1.0, -0.08], 10);
  grille.rotation.z = Math.PI / 2;
  grille.name = 'microphone-grille';

  // Headphones rest on a small stand at the right edge of the desk.
  const headphoneStand = new THREE.Group();
  headphoneStand.position.set(1.78, 1.3, 0.45);
  group.add(headphoneStand);
  addCylinder(headphoneStand, materials.metal, 0.045, 0.065, 0.44, [0, 0.23, 0], 8);
  addBox(headphoneStand, materials.woodDark, [0.36, 0.045, 0.25], [0, 0, 0]);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.045, 6, 12, Math.PI), materials.black);
  band.position.set(0, 0.56, 0);
  band.rotation.z = Math.PI;
  headphoneStand.add(band);
  for (const x of [-0.22, 0.22]) {
    addBox(headphoneStand, materials.blue, [0.15, 0.24, 0.13], [x, 0.43, 0]);
  }

  // Desk clock with locally painted face, plus the recording lamp sign.
  addBox(group, materials.woodDark, [0.54, 0.32, 0.1], [2.32, 1.438, -0.45], 'digital-clock');
  const clockCanvas = createStudioCanvas(256, 96);
  const clockCtx = clockCanvas.getContext('2d');
  clockCtx.fillStyle = '#17282c'; clockCtx.fillRect(0, 0, 256, 96);
  clockCtx.fillStyle = '#9fe0c6'; clockCtx.font = 'bold 58px monospace';
  clockCtx.textAlign = 'center'; clockCtx.textBaseline = 'middle'; clockCtx.fillText('09:41', 128, 51);
  const clockTexture = new THREE.CanvasTexture(clockCanvas);
  clockTexture.colorSpace = THREE.SRGBColorSpace;
  const clockFace = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.2), new THREE.MeshBasicMaterial({ map: clockTexture }));
  clockFace.position.set(2.32, 1.448, -0.39);
  group.add(clockFace);

  const onAir = createOnAirIndicator(materials);
  onAir.group.position.set(4.08, 3.82, -3.55);
  group.add(onAir.group);

  // A framed wall plaque uses one clean, locally painted broadcast icon.
  addBox(group, materials.woodDark, [0.98, 0.78, 0.16], [-4.08, 3.78, -3.63], 'radio-wall-plaque-frame');
  addBox(group, materials.blue, [0.86, 0.66, 0.035], [-4.08, 3.78, -3.535], 'radio-wall-plaque-face');
  const plaqueCanvas = createStudioCanvas(256, 192);
  const plaqueContext = plaqueCanvas.getContext('2d');
  plaqueContext.strokeStyle = '#a9dfd0';
  plaqueContext.fillStyle = '#a9dfd0';
  plaqueContext.lineWidth = 8;
  plaqueContext.lineCap = 'round';
  plaqueContext.beginPath();
  plaqueContext.arc(67, 94, 25, -0.9, 0.9);
  plaqueContext.stroke();
  plaqueContext.beginPath();
  plaqueContext.arc(67, 94, 47, -0.9, 0.9);
  plaqueContext.stroke();
  plaqueContext.beginPath();
  plaqueContext.arc(67, 94, 69, -0.9, 0.9);
  plaqueContext.stroke();
  plaqueContext.beginPath();
  plaqueContext.arc(67, 94, 8, 0, Math.PI * 2);
  plaqueContext.fill();
  plaqueContext.fillStyle = '#f2e5c8';
  plaqueContext.font = 'bold 29px system-ui, sans-serif';
  plaqueContext.fillText('RADIO', 142, 91);
  plaqueContext.font = 'bold 15px system-ui, sans-serif';
  plaqueContext.fillStyle = '#a9dfd0';
  plaqueContext.fillText('ON AIR', 144, 119);
  const plaqueTexture = new THREE.CanvasTexture(plaqueCanvas);
  plaqueTexture.colorSpace = THREE.SRGBColorSpace;
  const plaqueIcon = new THREE.Mesh(
    new THREE.PlaneGeometry(0.86, 0.66),
    new THREE.MeshBasicMaterial({ map: plaqueTexture, transparent: true }),
  );
  plaqueIcon.position.set(-4.08, 3.78, -3.515);
  plaqueIcon.name = 'radio-wall-plaque-icon';
  group.add(plaqueIcon);
  addCylinder(group, materials.woodDark, 0.43, 0.46, 0.22, [3.8, 0.62, 0.75], 10);
  for (const [x, z] of [[3.5, 0.45], [4.1, 0.45], [3.5, 1.05], [4.1, 1.05]]) {
    addCylinder(group, materials.metal, 0.035, 0.045, 0.62, [x, 0.31, z], 6);
  }
  addBox(group, materials.wood, [0.94, 0.2, 0.18], [3.8, 1.33, 1.15], 'host-chair-back');
  addBox(group, materials.blue, [0.83, 0.08, 0.15], [3.8, 1.33, 1.05]);

  scene.add(group);
  return { group, materials, monitorMount, onAir };
}

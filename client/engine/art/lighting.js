// Общая световая схема Kidburg: тёплое солнце, мягкий небесный свет, холодный контровой свет,
// градиентное небо и туман того же цвета, что и горизонт. Используется и пожарной частью, и городом.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { QUALITY_PRESETS } from './quality.js';

function createSky(radius) {
  const geometry = new THREE.SphereGeometry(radius, 24, 16);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const horizon = new THREE.Color(PALETTE.fog);
  const mid = new THREE.Color(PALETTE.skyMid);
  const top = new THREE.Color(PALETTE.skyTop);
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const h = Math.max(0, position.getY(i) / radius);
    if (h < 0.35) color.copy(horizon).lerp(mid, THREE.MathUtils.smoothstep(h, 0, 0.35));
    else color.copy(mid).lerp(top, THREE.MathUtils.smoothstep(h, 0.35, 1));
    colors.set([color.r, color.g, color.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

function createClouds(radius) {
  const group = new THREE.Group();
  const geometry = new THREE.SphereGeometry(1, 10, 7);
  const material = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.92, fog: false, depthWrite: false });
  const count = 9;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.sin(i * 12.9) * 0.25;
    const cloud = new THREE.Group();
    for (let j = 0; j < 4; j++) {
      const puff = new THREE.Mesh(geometry, material);
      puff.position.set((j - 1.5) * 9 + Math.sin(i + j) * 2, Math.sin(j * 1.7 + i) * 1.8, Math.cos(j * 2.3) * 2.5);
      puff.scale.set(8 + (j % 2) * 3, 3.1 + (j % 3) * 0.7, 5);
      cloud.add(puff);
    }
    const distance = radius * 0.72;
    cloud.position.set(Math.cos(angle) * distance, radius * (0.2 + (i % 3) * 0.06), Math.sin(angle) * distance);
    cloud.lookAt(0, cloud.position.y, 0);
    group.add(cloud);
  }
  group.renderOrder = -9;
  return { group, geometry, material };
}

/**
 * @param {object} options
 * @param {THREE.WebGLRenderer} options.renderer
 * @param {THREE.Scene} options.scene
 * @param {THREE.PerspectiveCamera} options.camera
 * @param {[number, number]} [options.fog] ближняя и дальняя границы тумана, м
 * @param {number} [options.shadowExtent] полуширина теневой камеры, м (0 — город без теней)
 * @param {number} [options.exposure]
 */
export function applyStylizedLook({ renderer, scene, camera, fog = [48, 125], shadowExtent = 26, exposure = 1.02 }) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;

  scene.background = new THREE.Color(PALETTE.fog);
  scene.fog = new THREE.Fog(PALETTE.fog, fog[0], fog[1]);

  const hemi = new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 1.45);
  const sun = new THREE.DirectionalLight(PALETTE.sun, 2.7);
  const sunOffset = new THREE.Vector3(-15, 25, 17);
  sun.position.copy(sunOffset);
  // Холодный контровой свет отделяет силуэты от фона, теней не отбрасывает.
  const rim = new THREE.DirectionalLight(PALETTE.rim, 0.55);
  rim.position.set(14, 9, -20);
  scene.add(hemi, sun, sun.target, rim);

  if (shadowExtent > 0) {
    sun.castShadow = true;
    Object.assign(sun.shadow.camera, { left: -shadowExtent, right: shadowExtent, top: shadowExtent, bottom: -shadowExtent, near: 1, far: 90 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.035;
  }

  const skyRadius = camera.far * 0.9;
  const sky = createSky(skyRadius);
  const clouds = createClouds(skyRadius);
  scene.add(sky, clouds.group);

  let quality = 'medium';
  let shadowsWanted = shadowExtent > 0;

  const look = {
    sun,
    hemi,
    rim,
    sky,
    /** Каждый кадр: небо следует за камерой, облака медленно плывут, тени фокусируются на игроке. */
    update(focus, elapsed = 0) {
      sky.position.copy(camera.position);
      clouds.group.position.copy(camera.position);
      clouds.group.rotation.y = elapsed * 0.004;
      if (shadowsWanted && focus) {
        // Привязка к метровой сетке не даёт теням «плыть» при движении игрока.
        sun.target.position.set(Math.round(focus.x), 0, Math.round(focus.z));
        sun.position.copy(sun.target.position).add(sunOffset);
      }
    },
    setQuality(level) {
      const preset = QUALITY_PRESETS[level] ?? QUALITY_PRESETS.medium;
      quality = level in QUALITY_PRESETS ? level : 'medium';
      renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, preset.pixelRatio));
      shadowsWanted = shadowExtent > 0 && preset.shadowSize > 0;
      sun.castShadow = shadowsWanted;
      if (shadowsWanted && sun.shadow.mapSize.x !== preset.shadowSize) {
        sun.shadow.mapSize.set(preset.shadowSize, preset.shadowSize);
        sun.shadow.map?.dispose();
        sun.shadow.map = null;
      }
      return preset;
    },
    get quality() { return quality; },
    dispose() {
      scene.remove(hemi, sun, sun.target, rim, sky, clouds.group);
      sun.shadow.map?.dispose();
      sky.geometry.dispose();
      sky.material.dispose();
      clouds.geometry.dispose();
      clouds.material.dispose();
    },
  };
  return look;
}

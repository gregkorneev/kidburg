import * as THREE from 'three';
import { createStudioCamera } from './studio-camera.js';
import { createStudioGeometry } from './studio-geometry.js';
import { createStudioLighting } from './studio-lighting.js';

export function createRadioStudio({
  container,
  rendererFactory = (options) => new THREE.WebGLRenderer(options),
  window: windowObject = globalThis.window ?? globalThis,
} = {}) {
  if (!container) throw new TypeError('Нужен контейнер превью Radio Studio');
  const scene = new THREE.Scene();
  const camera = createStudioCamera(1);
  const renderer = rendererFactory({ antialias: true, alpha: false, powerPreference: 'low-power' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setPixelRatio?.(Math.min(windowObject.devicePixelRatio || 1, 1.5));
  renderer.domElement.setAttribute?.('aria-label', 'Неподвижный вид от рабочего места радиоведущего.');
  container.appendChild(renderer.domElement);

  const lighting = createStudioLighting(scene);
  const studio = createStudioGeometry(scene, { overlayRoot: container, camera });
  let disposed = false;

  function renderScene() {
    if (disposed) return;
    studio.monitorMount.update(camera);
    renderer.render(scene, camera);
  }

  const resize = () => {
    if (disposed) return;
    const width = Math.max(1, container.clientWidth || windowObject.innerWidth || 1);
    const height = Math.max(1, container.clientHeight || windowObject.innerHeight || 1);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    renderScene();
  };
  const resizeObserver = typeof globalThis.ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  if (resizeObserver) resizeObserver.observe(container);
  else windowObject.addEventListener?.('resize', resize);
  resize();

  function dispose() {
    if (disposed) return;
    disposed = true;
    let mountDisposeError;
    try {
      studio.monitorMount.dispose();
    } catch (error) {
      mountDisposeError = error;
    }
    resizeObserver?.disconnect();
    windowObject.removeEventListener?.('resize', resize);
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    scene.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!material) continue;
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    textures.forEach((texture) => texture.dispose());
    materials.forEach((material) => material.dispose());
    geometries.forEach((geometry) => geometry.dispose());
    renderer.dispose?.();
    renderer.forceContextLoss?.();
    renderer.domElement.remove?.();
    while (scene.children.length) scene.remove(scene.children[0]);
    if (mountDisposeError) throw mountDisposeError;
  }

  function setOnAir(value) {
    const previous = studio.onAir.getOnAir();
    const isOnAir = studio.onAir.setOnAir(value);
    lighting.onAirGlow.visible = isOnAir;
    if (previous !== isOnAir) renderScene();
    return isOnAir;
  }

  return {
    scene,
    camera,
    monitorMount: studio.monitorMount,
    getMonitorMount: () => studio.monitorMount,
    setOnAir,
    getOnAir: studio.onAir.getOnAir,
    resize,
    dispose,
  };
}

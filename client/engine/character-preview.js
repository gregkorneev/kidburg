import * as THREE from 'three';
import { animateCharacter, createCharacter, disposeCharacter } from './art/character.js';
import { resolvePlayerAppearance } from './player-appearance.js';

// Box3.setFromObject includes invisible equipment and facial meshes. Frame only what is drawn.
function visibleBounds(object) {
  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  object.traverseVisible((part) => {
    if (part.isMesh && part.geometry) {
      if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
      bounds.union(part.geometry.boundingBox.clone().applyMatrix4(part.matrixWorld));
    }
  });
  return bounds;
}

/** A self-contained preview using the same character and appearance as the city. */
export function createCharacterPreview(container, { createRenderer = (options) => new THREE.WebGLRenderer(options), ResizeObserverImpl = globalThis.ResizeObserver } = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8797a1, 2));
  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(3, 5, 4);
  scene.add(light);
  const renderer = createRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  container.append(renderer.domElement);
  let person = null;
  let disposed = false;
  let width = 240;
  let height = 200;

  function render() {
    if (!person || disposed) return;
    const bounds = visibleBounds(person);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
    const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
    const distance = Math.max(size.y / 2 / Math.tan(vertical), size.x / 2 / Math.tan(horizontal)) * 1.15;
    camera.position.set(center.x, center.y, bounds.max.z + distance);
    camera.lookAt(center);
    camera.updateMatrixWorld();
    renderer.render(scene, camera);
  }
  function resize() {
    if (disposed) return;
    width = container.clientWidth || 240;
    height = container.clientHeight || 200;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    render();
  }
  const observer = ResizeObserverImpl ? new ResizeObserverImpl(resize) : null;
  observer?.observe(container);
  resize();
  return {
    setAvatar(avatar) {
      if (disposed) return;
      if (person) { scene.remove(person); disposeCharacter(person); }
      person = createCharacter({ appearance: resolvePlayerAppearance({ id: 0, appearance: avatar }), equipped: false, helmet: false, holding: null });
      // The first animation frame initializes face meshes (including the smile arc).
      animateCharacter(person, 0, 0);
      scene.add(person);
      render();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      observer?.disconnect();
      if (person) { scene.remove(person); disposeCharacter(person); person = null; }
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

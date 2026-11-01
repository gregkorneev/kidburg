import * as THREE from 'three';
import { createCharacter, disposeCharacter } from './art/character.js';
import { resolvePlayerAppearance } from './player-appearance.js';

/** A self-contained preview using the same character and appearance as the city. */
export function createCharacterPreview(container, { createRenderer = (options) => new THREE.WebGLRenderer(options) } = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 240 / 200, 0.1, 100);
  camera.position.set(0, 1.15, 4.8);
  camera.lookAt(0, 1, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8797a1, 2));
  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(3, 5, 4);
  scene.add(light);
  const renderer = createRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  renderer.setSize(240, 200);
  container.append(renderer.domElement);
  let person = null;
  let disposed = false;
  return {
    setAvatar(avatar) {
      if (disposed) return;
      if (person) { scene.remove(person); disposeCharacter(person); }
      person = createCharacter({ appearance: resolvePlayerAppearance({ id: 0, appearance: avatar }) });
      scene.add(person);
      renderer.render(scene, camera);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (person) { scene.remove(person); disposeCharacter(person); person = null; }
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

import * as THREE from 'three';
import { createInput } from '../../engine/input.js';
import { createPlayer, setPlayerPosition, stepPlayer } from '../../engine/player.js';
import { applyStylizedLook } from '../../engine/art/lighting.js';
import { createCharacter, animateCharacter, triggerGesture, disposeCharacter } from '../../engine/art/character.js';
import { stdMat } from '../../engine/art/materials.js';
import { readQuality } from '../../engine/art/quality.js';
import { buildFloristLayout } from './layout.js';
import { createFlower, disposeFlower, createWrapping, disposeWrapping } from './flowers.js';
import { FLOWERS, ORDER } from './state.js';

const INTERACTION_RADIUS = 1.72;
const MOUSE_SENSITIVITY = 0.0024;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function addApron(person) {
  const group = new THREE.Group();
  const body = person.userData.body;
  const apron = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.64, 0.08), stdMat('#3f8a68', { roughness: 0.82 }));
  apron.position.set(0, 0.88, 0.34);
  apron.castShadow = true;
  group.add(apron);
  const bib = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.28, 0.075), stdMat('#4b9974', { roughness: 0.82 }));
  bib.position.set(0, 1.29, 0.28);
  bib.castShadow = true;
  group.add(bib);
  const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.035), stdMat('#f4c94d', { roughness: 0.65 }));
  pocket.position.set(0, 0.92, 0.395);
  group.add(pocket);
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.44, 0.06), stdMat('#2b6350', { roughness: 0.82 }));
  strap.position.set(0, 1.43, 0.20);
  group.add(strap);
  body.add(group);
  person.userData.floristApron = group;
}

function disposeSubtree(root) {
  root.traverse((node) => {
    if (node.geometry && !node.geometry.userData.shared) node.geometry.dispose();
    const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    for (const material of materials) if (!material.userData.shared) material.dispose();
  });
}

export function createFloristScene({ container, onPrompt = () => {}, onAction = () => {} }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 110);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', 'Интерьер цветочной лавки. Кликните, чтобы управлять камерой.');
  container.appendChild(renderer.domElement);

  const look = applyStylizedLook({ renderer, scene, camera, fog: [32, 78], shadowExtent: 18, exposure: 1.03 });
  look.setQuality(readQuality());

  const layout = buildFloristLayout();
  scene.add(layout.root);

  const player = createPlayer();
  setPlayerPosition(player, 3.2, 0, 3.3);
  const avatar = createCharacter({ appearance: { outfit: '#6d9fa0', hairStyle: 'curly', hair: '#523b30' } });
  avatar.scale.setScalar(0.68);
  avatar.position.set(player.x, 0, player.z);
  scene.add(avatar);

  const lilia = createCharacter({
    name: 'Лилия',
    subtitle: 'флорист-наставник',
    appearance: { outfit: '#f2dfc8', hairStyle: 'ponytail', hair: '#704833', skin: '#f2c9a3' },
    outfit: '#f2dfc8',
  });
  lilia.scale.setScalar(0.72);
  lilia.position.set(7, 0, 1.45);
  addApron(lilia);
  scene.add(lilia);
  triggerGesture(lilia, 'wave');

  const carried = new THREE.Group();
  avatar.userData.arms[1].shoulder.add(carried);
  carried.position.set(0, -0.92, 0.18);
  carried.rotation.x = -0.18;
  carried.visible = false;

  const bouquet = new THREE.Group();
  scene.add(bouquet);
  let state = null;
  let heldModel = null;
  let bouquetModels = [];
  let wrappingModel = null;
  let talking = false;
  let uiBlocked = false;
  let currentTarget = null;
  let lastPrompt = '';
  let lastActionTime = 0;
  const focus = new THREE.Vector3();

  function clearHeldFlower() {
    if (!heldModel) return;
    carried.remove(heldModel);
    disposeFlower(heldModel);
    heldModel = null;
    carried.visible = false;
  }

  function clearBouquet() {
    for (const flower of bouquetModels) {
      bouquet.remove(flower);
      disposeFlower(flower);
    }
    bouquetModels = [];
    if (wrappingModel) {
      disposeWrapping(wrappingModel);
      wrappingModel = null;
    }
  }

  function syncBouquet(next) {
    clearHeldFlower();
    clearBouquet();
    if (next.heldFlower) {
      heldModel = createFlower(next.heldFlower.type, { id: next.heldFlower.id });
      heldModel.scale.setScalar(0.62);
      carried.add(heldModel);
      carried.visible = true;
    }
    next.stems.forEach((stem, index) => {
      const flower = createFlower(stem.type, { id: stem.id });
      const angle = index * (Math.PI * 2 / Math.max(1, next.stems.length)) + 0.3;
      const radius = next.stems.length === 1 ? 0 : 0.19 + (index % 2) * 0.06;
      flower.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius * 0.65);
      flower.rotation.set(0.08 * ((index % 3) - 1), angle * 0.25, 0.10 * ((index % 2) ? 1 : -1));
      bouquet.add(flower);
      bouquetModels.push(flower);
    });
    const packed = next.wrapped;
    bouquet.position.copy(packed
      ? layout.wrappedBouquetPositions.handoff
      : next.stage === 'wrapping' ? layout.wrappedBouquetPositions.wrapping : layout.bouquetPosition);
    if (packed) wrappingModel = createWrapping(bouquet, next.ribbon);
  }

  function updatePrompt(target) {
    let prompt = '';
    if (target) {
      if (target.kind === 'lilia') prompt = 'E — Поговорить с Лилией';
      else if (target.kind === 'take') prompt = `E — Взять: ${FLOWERS[target.flower].label.toLowerCase()}`;
      else if (target.kind === 'add') prompt = 'E — Поставить цветок в букет';
      else if (target.kind === 'remove') prompt = 'E — Убрать последний стебель';
      else if (target.kind === 'wrap') prompt = state?.ribbon ? 'E — Упаковать букет' : 'Выберите ленту в карточке заказа';
      else if (target.kind === 'handoff') prompt = 'E — Сдать заказ Лилии';
    }
    if (prompt !== lastPrompt) {
      lastPrompt = prompt;
      onPrompt(prompt);
    }
    currentTarget = target;
  }

  function getTargets() {
    if (!state || uiBlocked) return [];
    if (['not_started', 'briefing', 'completed'].includes(state.stage)) return [{ kind: 'lilia', position: layout.stations.lilia }];
    if (state.stage === 'collecting') {
      const targets = [];
      if (!state.heldFlower && state.stems.length < ORDER.total) {
        for (const [flower, bucket] of Object.entries(layout.buckets)) targets.push({ kind: 'take', flower, position: bucket.position });
      }
      if (state.heldFlower) targets.push({ kind: 'add', position: layout.stations.workbench });
      else if (state.stems.length) targets.push({ kind: 'remove', position: layout.stations.workbench });
      return targets;
    }
    if (state.stage === 'wrapping') return [{ kind: 'wrap', position: layout.stations.wrapping }];
    if (state.stage === 'handoff') return [{ kind: 'handoff', position: layout.stations.handoff }];
    return [];
  }

  function findTarget() {
    const targets = getTargets();
    let nearest = null;
    let distance = INTERACTION_RADIUS;
    for (const target of targets) {
      const d = Math.hypot(player.x - target.position.x, player.z - target.position.z);
      if (d < distance) { nearest = target; distance = d; }
    }
    return nearest;
  }

  const input = createInput({
    target: renderer.domElement,
    document,
    window,
    onInteract: () => {
      if (!currentTarget) return;
      if (performance.now() - lastActionTime < 180) return;
      lastActionTime = performance.now();
      onAction(currentTarget);
    },
    onChat: () => {},
  });

  function setTaskState(next) {
    const previous = state?.stage;
    state = next;
    syncBouquet(next);
    if (next.stage === 'briefing' && previous !== 'briefing') triggerGesture(lilia, 'wave');
    if (next.stage === 'completed' && previous !== 'completed') triggerGesture(lilia, 'nod');
    if (next.stage !== 'briefing') talking = false;
  }

  function setTalking(value) { talking = Boolean(value); }

  function setUiBlocked(value) {
    const blocked = Boolean(value);
    if (blocked === uiBlocked) return;
    uiBlocked = blocked;
    if (blocked) input.unlockPointer();
    else input.lockPointer();
    if (blocked) updatePrompt(null);
  }

  function resize() {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }
  window.addEventListener('resize', resize);
  resize();

  let animationFrame = 0;
  let previous = performance.now();
  const started = previous;
  function animate(now) {
    animationFrame = window.requestAnimationFrame(animate);
    const dt = Math.min(0.05, Math.max(0, (now - previous) / 1000));
    previous = now;
    if (!uiBlocked) {
      const lookDelta = input.consumeLook();
      player.yaw -= lookDelta.dx * MOUSE_SENSITIVITY;
      player.pitch = clamp(player.pitch - lookDelta.dy * MOUSE_SENSITIVITY, -0.42, 0.58);
      stepPlayer(player, input.keys(), dt, {
        heightAt: () => 0,
        collidersNear: () => layout.colliders,
      });
    }

    avatar.position.set(player.x, player.y, player.z);
    avatar.rotation.y = player.yaw;
    const forwardX = -Math.sin(player.yaw);
    const forwardZ = -Math.cos(player.yaw);
    const cameraDistance = 4.8;
    camera.position.set(
      player.x - forwardX * cameraDistance,
      player.y + 2.65 + player.pitch * 1.2,
      player.z - forwardZ * cameraDistance,
    );
    camera.lookAt(player.x + forwardX * 0.6, player.y + 1.2 + player.pitch * 1.4, player.z + forwardZ * 0.6);

    const elapsed = (now - started) / 1000;
    animateCharacter(avatar, dt, elapsed, { speed: player.moving ? (player.running ? 2 : 1) : 0 });
    animateCharacter(lilia, dt, elapsed, { talking, lookYaw: Math.sin(elapsed * 0.6) * 0.08 });
    const target = findTarget();
    if (!uiBlocked) updatePrompt(target);
    look.update(focus.set(player.x, 0, player.z), elapsed);
    renderer.render(scene, camera);
  }
  animationFrame = window.requestAnimationFrame(animate);

  function dispose() {
    window.cancelAnimationFrame(animationFrame);
    window.removeEventListener('resize', resize);
    input.dispose();
    clearHeldFlower();
    clearBouquet();
    disposeCharacter(avatar);
    disposeCharacter(lilia);
    disposeSubtree(lilia.userData.floristApron);
    layout.dispose();
    look.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return {
    setTaskState,
    setTalking,
    setUiBlocked,
    getPosition: () => ({ x: player.x, y: player.y, z: player.z }),
    getQuality: () => look.quality,
    dispose,
  };
}

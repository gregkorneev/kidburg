import * as THREE from 'three';
import { PALETTE } from '../../engine/art/palette.js';
import { applyStylizedLook } from '../../engine/art/lighting.js';
import { animateCharacter, createCharacter, disposeCharacter, triggerGesture } from '../../engine/art/character.js';
import { stdMat } from '../../engine/art/materials.js';
import { QUALITY_PRESETS, readQuality, saveQuality } from '../../engine/art/quality.js';
import { SPAWN, ZONES, collidesWithFurniture, isInsideRoom } from './layout.js';
import { activeZone, interactionPrompt, resolveInteraction } from './interactions.js';
import { createBakeryInterior } from './station-art.js';

const INPUT_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
const isTyping = (target) => Boolean(target?.closest?.('input, textarea, select, button, [contenteditable="true"]'));

export function createBakeryScene({
  container, onPrompt = () => {}, onAction = () => {}, onNotice = () => {},
  rendererFactory = (options) => new THREE.WebGLRenderer(options),
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis) ?? (() => 0),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis) ?? (() => {}),
} = {}) {
  if (!container) throw new TypeError('Нужен контейнер сцены Bakery');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);
  const renderer = rendererFactory({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute?.('aria-label', 'Сцена пекарни. Используй WASD и E.');
  container.appendChild(renderer.domElement);

  const look = applyStylizedLook({ renderer, scene, camera, fog: [30, 90], shadowExtent: 18, exposure: 1.02 });
  let quality = readQuality();
  look.setQuality(quality);
  const interior = createBakeryInterior({ quality });
  scene.add(interior.group);

  const player = createCharacter({ name: 'Пекарь', appearance: { skin: '#f4c8a2', hair: '#5b3a2b', hairStyle: 'short', outfit: PALETTE.green, pants: '#5b6770' } });
  player.position.set(SPAWN.x, 0, SPAWN.z);
  const mentor = createCharacter({
    name: 'Мастер-пекарь', subtitle: 'Наставник', nameScale: 1.08,
    appearance: { skin: '#e9ae83', hair: '#6b4631', hairStyle: 'bob', outfit: '#8f4a37', pants: '#5b5149' },
  });
  const apron = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.58, 0.06), stdMat(PALETTE.trim, { roughness: 0.9 }),
  );
  apron.position.set(0, 1.28, 0.34);
  mentor.userData.body.add(apron);
  const bakerCap = new THREE.Group();
  const capMaterial = stdMat('#fff6df', { roughness: 0.88 });
  const capBand = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.28, 0.12, 9), capMaterial);
  capBand.position.y = 0.42;
  const capTop = new THREE.Mesh(new THREE.SphereGeometry(0.29, 9, 6), capMaterial);
  capTop.position.set(0, 0.58, -0.01);
  capTop.scale.y = 0.78;
  bakerCap.add(capBand, capTop);
  mentor.userData.head.add(bakerCap);
  const mentorZone = ZONES.find((zone) => zone.id === 'mentor');
  mentor.position.set(mentorZone.x, 0, mentorZone.z);
  mentor.rotation.y = Math.PI;
  scene.add(player, mentor);

  const keys = new Set();
  const host = globalThis.window ?? globalThis;
  let frameId = 0;
  let disposed = false;
  let uiBlocked = false;
  let state = { stage: 'waiting_order', completedOrders: 0 };
  let lastPrompt = '';
  let lastNotice = '';
  let elapsed = 0;
  let lastFrame = 0;

  const bounds = (x, z) => isInsideRoom(x, z, 0.42) && !collidesWithFurniture(x, z, 0.42);
  const setPrompt = (value) => {
    if (value === lastPrompt) return;
    lastPrompt = value;
    onPrompt(value);
  };
  const position = () => ({ x: player.position.x, z: player.position.z });
  const setState = (next) => {
    state = next;
    interior.setStage(state.stage);
    const zone = activeZone(state);
    interior.setTarget(zone ? { x: zone.x, z: zone.z } : null);
    if (state.stage === 'completed') triggerGesture(mentor, 'wave');
  };

  function onKeyDown(event) {
    if (isTyping(event.target) || uiBlocked || event.repeat) return;
    if (event.code === 'KeyE') {
      event.preventDefault();
      const result = resolveInteraction(state, position());
      if (result.action) onAction(result.action);
      else if (result.feedback && result.feedback !== lastNotice) { lastNotice = result.feedback; onNotice(result.feedback); }
      return;
    }
    if (INPUT_CODES.has(event.code)) { event.preventDefault(); keys.add(event.code); }
  }
  function onKeyUp(event) { keys.delete(event.code); }
  function onBlur() { keys.clear(); }

  host.addEventListener?.('keydown', onKeyDown);
  host.addEventListener?.('keyup', onKeyUp);
  host.addEventListener?.('blur', onBlur);

  function resize() {
    const width = Math.max(1, container.clientWidth || globalThis.innerWidth || 1);
    const height = Math.max(1, container.clientHeight || globalThis.innerHeight || 1);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }
  const resizeObserver = typeof globalThis.ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  if (resizeObserver) resizeObserver.observe(container);
  else host.addEventListener?.('resize', resize);
  resize();

  function stepMovement(dt) {
    if (uiBlocked) return 0;
    const dx = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
    const dz = Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp'));
    const length = Math.hypot(dx, dz);
    if (length < 0.01) return 0;
    const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? 5.2 : 3.7;
    const mx = (dx / length) * speed * dt;
    const mz = (dz / length) * speed * dt;
    const nextX = player.position.x + mx;
    const nextZ = player.position.z + mz;
    if (bounds(nextX, player.position.z)) player.position.x = nextX;
    if (bounds(player.position.x, nextZ)) player.position.z = nextZ;
    player.rotation.y = Math.atan2(mx, mz);
    return speed;
  }

  function animate(now = 0) {
    if (disposed) return;
    frameId = requestFrame(animate);
    const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 1 / 60;
    lastFrame = now;
    elapsed += dt;
    const speed = stepMovement(dt);
    animateCharacter(player, dt, elapsed, { speed: speed ? 1 : 0 });
    animateCharacter(mentor, dt, elapsed, { speed: 0 });
    mentor.rotation.y += Math.sin(elapsed * 0.7) * 0.0008;
    const target = new THREE.Vector3(player.position.x, 1.2, player.position.z);
    camera.position.set(player.position.x + 0.4, 8.2, player.position.z + 10.5);
    camera.lookAt(target);
    interior.update(dt, elapsed);
    const prompt = interactionPrompt(state, position());
    setPrompt(prompt);
    look.update(player.position, elapsed);
    renderer.render(scene, camera);
  }
  frameId = requestFrame(animate);

  return {
    setState,
    getState: () => state,
    getQuality: () => quality,
    getPosition: position,
    setPosition({ x, z }) {
      if (bounds(x, z)) player.position.set(x, 0, z);
    },
    setUiBlocked(value) { uiBlocked = Boolean(value); if (uiBlocked) keys.clear(); },
    setQuality(level) {
      quality = QUALITY_PRESETS[level] ? level : 'medium';
      look.setQuality(quality);
      interior.setQuality(quality);
      saveQuality(quality);
      resize();
      return quality;
    },
    debug: { scene, camera, renderer, player, mentor, interior, bounds },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelFrame(frameId);
      resizeObserver?.disconnect();
      host.removeEventListener?.('keydown', onKeyDown);
      host.removeEventListener?.('keyup', onKeyUp);
      host.removeEventListener?.('blur', onBlur);
      if (!resizeObserver) host.removeEventListener?.('resize', resize);
      interior.dispose();
      scene.remove(player, mentor);
      disposeCharacter(player);
      disposeCharacter(mentor);
      look.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
      renderer.domElement.remove?.();
    },
  };
}

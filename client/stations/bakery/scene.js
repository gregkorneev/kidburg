import * as THREE from 'three';
import { createInput } from '../../engine/input.js';
import { PALETTE } from '../../engine/art/palette.js';
import { applyStylizedLook } from '../../engine/art/lighting.js';
import { CITY_CHARACTER_SCALE, animateCharacter, createCharacter, disposeCharacter, triggerGesture } from '../../engine/art/character.js';
import { stdMat } from '../../engine/art/materials.js';
import { QUALITY_PRESETS, readQuality, saveQuality } from '../../engine/art/quality.js';
import { MIN_VISIBLE_ARM, createCameraArm } from '../../engine/third-person-camera.js';
import { ROOM, SPAWN, ZONES, OBSTACLES, collidesWithFurniture, isInsideRoom } from './layout.js';
import { activeZone, interactionPrompt, resolveInteraction } from './interactions.js';
import { createBakeryInterior } from './station-art.js';
import { turnNpcToward } from '../../engine/npc-facing.js';

const MOUSE_SENSITIVITY = 0.0024;
const PLAYER_RADIUS = 0.42;
const CAMERA_BLOCKERS = [
  ...OBSTACLES.map((box) => ({ ...box, minY: 0, maxY: ({ oven: 2.3, 'cooling-rack': 2.6, 'delivery-counter': 2.2 })[box.id] ?? 1.15 })),
  { minX: ROOM.minX, maxX: ROOM.minX + 0.32, minY: 0, maxY: ROOM.wallHeight, minZ: ROOM.minZ, maxZ: ROOM.maxZ },
  { minX: ROOM.maxX - 0.32, maxX: ROOM.maxX, minY: 0, maxY: ROOM.wallHeight, minZ: ROOM.minZ, maxZ: ROOM.maxZ },
  { minX: ROOM.minX, maxX: ROOM.maxX, minY: 0, maxY: ROOM.wallHeight, minZ: ROOM.minZ, maxZ: ROOM.minZ + 0.32 },
  { minX: ROOM.minX, maxX: ROOM.maxX, minY: 0, maxY: ROOM.wallHeight, minZ: ROOM.maxZ - 0.32, maxZ: ROOM.maxZ },
  { minX: ROOM.minX, maxX: ROOM.maxX, minY: 5.24, maxY: ROOM.wallHeight, minZ: ROOM.minZ, maxZ: ROOM.maxZ },
];

export function createBakeryScene({
  container, appearance = null, onPrompt = () => {}, onAction = () => {}, onNotice = () => {},
  rendererFactory = (options) => new THREE.WebGLRenderer(options),
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis) ?? (() => 0),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis) ?? (() => {}),
  window: windowObject = globalThis.window ?? globalThis,
  document: documentObject = globalThis.document,
} = {}) {
  if (!container) throw new TypeError('Нужен контейнер сцены Bakery');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 60);
  camera.rotation.order = 'YXZ';
  const renderer = rendererFactory({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute?.('aria-label', 'Сцена пекарни. WASD — движение, мышь — обзор, E — действие.');
  container.appendChild(renderer.domElement);

  const look = applyStylizedLook({ renderer, scene, camera, fog: [24, 58], shadowExtent: 16, exposure: 1.02 });
  let quality = readQuality();
  look.setQuality(quality);
  const interior = createBakeryInterior({ quality });
  scene.add(interior.group);

  const player = createCharacter({ appearance: appearance ?? { skin: '#f4c8a2', hair: '#5b3a2b', hairStyle: 'short', outfit: PALETTE.green, pants: '#5b6770' } });
  player.scale.setScalar(CITY_CHARACTER_SCALE);
  player.position.set(SPAWN.x, 0, SPAWN.z);
  const mentor = createCharacter({
    name: 'Мастер-пекарь', subtitle: 'Наставник', nameScale: 0.74,
    appearance: { skin: '#e9ae83', hair: '#6b4631', hairStyle: 'bob', outfit: '#8f4a37', pants: '#5b5149' },
  });
  mentor.scale.setScalar(CITY_CHARACTER_SCALE);
  mentor.userData.nameTag.position.y = 3.22;
  const apron = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.58, 0.06), stdMat(PALETTE.trim, { roughness: 0.9 }));
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
  const startYaw = Math.atan2(SPAWN.x - mentorZone.x, SPAWN.z - mentorZone.z);
  player.rotation.y = startYaw + Math.PI;

  const host = windowObject;
  let frameId = 0;
  let disposed = false;
  let uiBlocked = false;
  let state = { stage: 'waiting_order', completedOrders: 0 };
  let cameraYaw = startYaw;
  let cameraPitch = 0;
  const cameraArm = createCameraArm({ distance: Math.hypot(4.8, 1.15) });
  const cameraFocus = new THREE.Vector3();
  const cameraGoal = new THREE.Vector3();
  camera.rotation.set(0, cameraYaw, 0);
  let lastPrompt = '';
  let lastNotice = '';
  let elapsed = 0;
  let lastFrame = 0;

  const bounds = (x, z) => isInsideRoom(x, z, PLAYER_RADIUS) && !collidesWithFurniture(x, z, PLAYER_RADIUS);
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

  const input = createInput({
    target: renderer.domElement,
    document: documentObject ?? { pointerLockElement: null, addEventListener() {}, removeEventListener() {} },
    window: host,
    onInteract: () => {
      if (uiBlocked) return;
      const result = resolveInteraction(state, position());
      if (result.action) onAction(result.action);
      else if (result.feedback && result.feedback !== lastNotice) { lastNotice = result.feedback; onNotice(result.feedback); }
    },
    onChat: () => {},
  });

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
    const keys = input.keys();
    const forwardInput = Number(keys.forward) - Number(keys.back);
    const sideInput = Number(keys.right) - Number(keys.left);
    const length = Math.hypot(forwardInput, sideInput);
    if (length < 0.01) return 0;
    const forwardX = -Math.sin(cameraYaw);
    const forwardZ = -Math.cos(cameraYaw);
    const rightX = Math.cos(cameraYaw);
    const rightZ = -Math.sin(cameraYaw);
    const dx = (rightX * sideInput + forwardX * forwardInput) / length;
    const dz = (rightZ * sideInput + forwardZ * forwardInput) / length;
    const speed = keys.run ? 8 : 5;
    const nextX = player.position.x + dx * speed * dt;
    const nextZ = player.position.z + dz * speed * dt;
    if (bounds(nextX, player.position.z)) player.position.x = nextX;
    if (bounds(player.position.x, nextZ)) player.position.z = nextZ;
    return keys.run ? 2 : 1;
  }

  function animate(now = 0) {
    if (disposed) return;
    frameId = requestFrame(animate);
    const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 1 / 60;
    lastFrame = now;
    elapsed += dt;
    const lookDelta = input.consumeLook();
    cameraYaw -= lookDelta.dx * MOUSE_SENSITIVITY;
    cameraPitch = THREE.MathUtils.clamp(cameraPitch - lookDelta.dy * MOUSE_SENSITIVITY, -0.42, 0.58);
    const speed = stepMovement(dt);
    player.rotation.y = cameraYaw + Math.PI;
    animateCharacter(player, dt, elapsed, { speed });
    animateCharacter(mentor, dt, elapsed, { speed: 0 });
    turnNpcToward(mentor, mentor.position, player.position, dt, Math.PI);
    updateCamera(dt);
    interior.update(dt, elapsed);
    setPrompt(interactionPrompt(state, position()));
    look.update(player.position, elapsed);
    renderer.render(scene, camera);
  }

  function updateCamera(dt) {
    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);
    cameraFocus.set(player.position.x, 1.5, player.position.z);
    cameraGoal.set(player.position.x + sin * 4.8, 2.65 + cameraPitch * 1.2, player.position.z + cos * 4.8);
    const position = cameraArm.resolve(cameraFocus, cameraGoal, CAMERA_BLOCKERS, dt, () => 0);
    camera.position.set(position.x, position.y, position.z);
    camera.lookAt(cameraFocus);
    player.visible = cameraArm.length >= MIN_VISIBLE_ARM;
  }
  frameId = requestFrame(animate);

  return {
    setState,
    getState: () => state,
    getQuality: () => quality,
    getPosition: position,
    setPosition({ x, z }) { if (bounds(x, z)) player.position.set(x, 0, z); },
    setUiBlocked(value) { uiBlocked = Boolean(value); if (uiBlocked) input.unlockPointer(); else input.lockPointer(); },
    setQuality(level) {
      quality = QUALITY_PRESETS[level] ? level : 'medium';
      look.setQuality(quality);
      interior.setQuality(quality);
      saveQuality(quality);
      resize();
      return quality;
    },
    debug: {
      scene, camera, renderer, player, mentor, interior, input,
      bounds,
      cameraState: () => ({ yaw: cameraYaw, pitch: cameraPitch, locked: input.locked, position: camera.position.toArray() }),
      setCameraLook(yaw, pitch = 0) { cameraYaw = yaw; cameraPitch = THREE.MathUtils.clamp(pitch, -1.3, 1.3); },
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelFrame(frameId);
      resizeObserver?.disconnect();
      if (!resizeObserver) host.removeEventListener?.('resize', resize);
      input.dispose();
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

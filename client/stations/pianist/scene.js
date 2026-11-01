import * as THREE from 'three';
import { createInput } from '../../engine/input.js';
import { createPlayer, setPlayerPosition, stepPlayer } from '../../engine/player.js';
import { applyStylizedLook } from '../../engine/art/lighting.js';
import { animateCharacter, createCharacter, disposeCharacter, triggerGesture } from '../../engine/art/character.js';
import { QUALITY_LABELS, QUALITY_PRESETS, readQuality, saveQuality } from '../../engine/art/quality.js';
import { buildPianistLayout } from './layout.js';
import { createPiano } from './piano.js';
import { noteByKey } from './melody.js';
import { pianistGroundHeight, pianoCollider, PIANIST_PLAN } from './layout-plan.js';
import { getPianoSeatPose, PIANIST_PLAYING_ARM_ANGLE, PIANIST_SEATED_LEG_ANGLE } from './pianist-pose.js';
import { approachCameraDistance, safeCameraDistance } from './camera-collision.js';

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
const radius = 1.85;
const LOOK_SENSITIVITY = 0.0018;

function addMaestroDetails(person) {
  const body = person.userData.body;
  const add = (size, position, color, rotation = null) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
    mesh.position.set(...position); if (rotation) mesh.rotation.set(...rotation); mesh.castShadow = true; body.add(mesh);
    (person.userData.pianistOwned ??= []).push(mesh);
  };
  add([0.48, 0.58, 0.1], [0, 0.9, 0.36], '#bf5261');
  add([0.07, 0.45, 0.08], [0, 1.15, 0.43], '#f0c56d');
  add([0.16, 0.13, 0.05], [0.05, 1.28, 0.43], '#f0c56d');
  add([0.14, 0.12, 0.08], [-0.25, 1.2, 0.31], '#f0c56d');
}

function disposeAdded(root) {
  root.traverse((node) => {
    if (node.geometry && !node.geometry.userData.shared) node.geometry.dispose();
    const items = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    for (const material of items) if (!material.userData.shared) { material.map?.dispose(); material.dispose(); }
  });
}

export function createPianistScene({ container, onPrompt = () => {}, onAction = () => {}, onNote = () => {} }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#cde4e6');
  const camera = new THREE.PerspectiveCamera(54, 1, 0.1, 90);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', 'Музыкальная школа. Нажмите, чтобы осмотреть класс.');
  container.appendChild(renderer.domElement);
  const look = applyStylizedLook({ renderer, scene, camera, fog: [25, 58], shadowExtent: 18, exposure: 1.04 });
  const layout = buildPianistLayout(); scene.add(layout.root);

  const player = createPlayer();
  setPlayerPosition(player, PIANIST_PLAN.spawn.x, 0, PIANIST_PLAN.spawn.z);
  player.yaw = Math.PI;
  const avatar = createCharacter({ appearance: { outfit: '#6d9fa0', hairStyle: 'curly', hair: '#523b30' } });
  avatar.scale.setScalar(0.68); scene.add(avatar);
  const maestro = createCharacter({ name: 'Маэстро Артём', subtitle: 'преподаватель музыки', appearance: { outfit: '#e3b868', hairStyle: 'short', hair: '#533a31', skin: '#efc19c' }, outfit: '#e3b868' });
  maestro.scale.setScalar(0.72); maestro.position.set(PIANIST_PLAN.maestro.x, 0, PIANIST_PLAN.maestro.z); maestro.rotation.y = Math.PI; addMaestroDetails(maestro); scene.add(maestro); triggerGesture(maestro, 'wave');
  const pianos = [
    createPiano({ position: PIANIST_PLAN.practicePiano, rotationY: PIANIST_PLAN.practicePiano.rotationY, name: 'practice-piano' }),
    createPiano({ position: { ...PIANIST_PLAN.stagePiano, y: PIANIST_PLAN.stage.height }, rotationY: Math.PI, name: 'concert-piano' }),
  ];
  for (const piano of pianos) scene.add(piano.root);
  const pianoColliders = pianos.map((piano) => pianoCollider(piano.position, piano.rotationY));
  layout.colliders.push(...pianoColliders);
  layout.cameraBlockers.push(...pianoColliders);
  const instrumentCameraBlockers = layout.cameraBlockers.filter((box) => !pianoColliders.includes(box));

  const focus = new THREE.Vector3(); const desired = new THREE.Vector3(); const ray = new THREE.Vector3();
  const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2();
  let state = null; let uiBlocked = false; let currentTarget = null; let lastPrompt = ''; let lastInteract = 0;
  let cameraArmDistance = 5.2; let activePiano = pianos[0]; let instrumentMode = false; let instrumentReturn = null; let quality = readQuality();
  const keyTimers = new Set();
  const input = createInput({
    target: renderer.domElement, document, window,
    onInteract: () => {
      if (!currentTarget || performance.now() - lastInteract < 180) return;
      lastInteract = performance.now(); onAction(currentTarget);
    },
    onChat: () => {},
  });

  function findTarget() {
    if (uiBlocked || instrumentMode || !state) return null;
    const candidates = [
      { kind: 'maestro', position: PIANIST_PLAN.maestro, text: 'E — Поговорить с Маэстро Артёмом' },
      { kind: 'practice-piano', position: PIANIST_PLAN.practicePiano, text: 'E — Сесть за пианино' },
      { kind: 'stage-piano', position: PIANIST_PLAN.stagePiano, text: 'E — Выйти на сцену и сыграть' },
    ];
    let best = null; let bestDistance = radius;
    for (const candidate of candidates) {
      const distance = Math.hypot(player.x - candidate.position.x, player.z - candidate.position.z);
      if (distance < bestDistance) {
        if (candidate.kind === 'maestro' && !['not_started', 'completed'].includes(state.stage)) continue;
        if (candidate.kind === 'practice-piano' && !['learning', 'practice'].includes(state.stage)) continue;
        if (candidate.kind === 'stage-piano' && state.stage !== 'concert') continue;
        best = candidate; bestDistance = distance;
      }
    }
    return best;
  }
  function updatePrompt(target) {
    const prompt = target?.text ?? '';
    if (prompt !== lastPrompt) { lastPrompt = prompt; onPrompt(prompt); }
    currentTarget = target;
  }
  function setInstrumentMode(value) {
    const enabled = Boolean(value);
    if (enabled === instrumentMode) return;
    instrumentMode = enabled;
    if (instrumentMode) {
      instrumentReturn = { x: player.x, y: player.y, z: player.z, yaw: player.yaw };
      activePiano = state?.stage === 'concert' ? pianos[1] : pianos[0];
      Object.assign(player, getPianoSeatPose(activePiano.position, activePiano.rotationY));
      player.moving = false;
    } else if (instrumentReturn) {
      Object.assign(player, instrumentReturn, { moving: false, running: false });
      instrumentReturn = null;
    }
    if (instrumentMode) input.unlockPointer();
    else if (!uiBlocked) input.lockPointer();
  }
  function setTaskState(next) {
    const oldStage = state?.stage; state = next;
    if (oldStage !== 'completed' && next.stage === 'completed') triggerGesture(maestro, 'nod');
    if (next.stage === 'briefing') triggerGesture(maestro, 'wave');
    setInstrumentMode(next.pianoMode);
    layout.setConcertMode(['concert', 'completed'].includes(next.stage));
    updatePrompt(null);
  }
  function setUiBlocked(value) {
    uiBlocked = Boolean(value);
    if (uiBlocked || instrumentMode) input.unlockPointer(); else input.lockPointer();
    if (uiBlocked) updatePrompt(null);
  }
  function setQuality(level) {
    if (!QUALITY_PRESETS[level]) return { level: quality, label: QUALITY_LABELS[quality] };
    quality = level; saveQuality(level); look.setQuality(level);
    return { level, label: QUALITY_LABELS[level] };
  }
  function notePress(noteId) {
    activePiano.press(noteId, true);
    if (state?.soundEnabled !== false) onNote(noteId);
    const timer = window.setTimeout(() => { activePiano.press(noteId, false); keyTimers.delete(timer); }, 145);
    keyTimers.add(timer);
  }
  function onKeyDown(event) {
    if (!instrumentMode || event.repeat) return;
    if (event.code === 'Escape') { event.preventDefault(); onAction({ kind: 'leave-piano' }); return; }
    const note = noteByKey(event.code);
    if (note) { event.preventDefault(); event.stopImmediatePropagation(); notePress(note.id); onAction({ kind: 'note', note: note.id, at: performance.now() }); }
  }
  function onPointerDown(event) {
    if (!instrumentMode) return;
    event.preventDefault();
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const allKeys = [...pianos.flatMap((piano) => [...piano.keys.values()])];
    const hit = raycaster.intersectObjects(allKeys, false)[0];
    if (!hit) return;
    const piano = pianos.find((item) => item.keys.get(hit.object.userData.note) === hit.object);
    activePiano = piano ?? activePiano;
    notePress(hit.object.userData.note);
    onAction({ kind: 'note', note: hit.object.userData.note, at: performance.now() });
  }
  window.addEventListener('keydown', onKeyDown, true);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);

  function resize() {
    const width = Math.max(1, container.clientWidth); const height = Math.max(1, container.clientHeight);
    camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY_PRESETS[quality].pixelRatio));
  }
  window.addEventListener('resize', resize); resize(); setQuality(quality);
  let raf = 0; let previous = performance.now(); const started = previous;
  function animate(now) {
    raf = window.requestAnimationFrame(animate);
    const dt = Math.min(0.05, Math.max(0, (now - previous) / 1000)); previous = now;
    if (!uiBlocked && !instrumentMode) {
      const lookDelta = input.consumeLook();
      player.yaw -= lookDelta.dx * LOOK_SENSITIVITY;
      player.pitch = clamp(player.pitch - lookDelta.dy * LOOK_SENSITIVITY, -0.42, 0.58);
      stepPlayer(player, input.keys(), dt, { heightAt: pianistGroundHeight, collidersNear: () => layout.colliders });
    }
    avatar.position.set(player.x, player.y, player.z); avatar.rotation.y = player.yaw + Math.PI;
    const elapsed = (now - started) / 1000;
    if (instrumentMode && state) {
      activePiano = state.stage === 'concert' ? pianos[1] : pianos[0];
      const frontX = Math.sin(activePiano.rotationY); const frontZ = Math.cos(activePiano.rotationY);
      focus.set(activePiano.position.x + frontX * 0.18, 1.02 + activePiano.position.y, activePiano.position.z + frontZ * 0.18);
      const cameraOffset = state.stage === 'concert' ? PIANIST_PLAN.instrumentCamera.concert : PIANIST_PLAN.instrumentCamera.practice;
      const cameraLocalX = cameraOffset.x; const cameraLocalZ = cameraOffset.z;
      desired.set(
        activePiano.position.x + Math.cos(activePiano.rotationY) * cameraLocalX + Math.sin(activePiano.rotationY) * cameraLocalZ,
        2.8 + activePiano.position.y,
        activePiano.position.z - Math.sin(activePiano.rotationY) * cameraLocalX + Math.cos(activePiano.rotationY) * cameraLocalZ,
      );
      ray.subVectors(desired, focus);
      const desiredDistance = ray.length();
      cameraArmDistance = approachCameraDistance(cameraArmDistance, safeCameraDistance(focus, desired, instrumentCameraBlockers, { radius: 0.2, clearance: 0.12 }), dt);
      camera.position.copy(focus).addScaledVector(ray, desiredDistance > 0 ? cameraArmDistance / desiredDistance : 0); camera.lookAt(focus);
    } else {
      const nearbyPiano = pianos
        .map((piano) => ({ piano, distance: Math.hypot(player.x - piano.position.x, player.z - piano.position.z) }))
        .sort((a, b) => a.distance - b.distance)[0];
      if (nearbyPiano?.distance < 3.5) {
        const piano = nearbyPiano.piano;
        const frontX = Math.sin(piano.rotationY); const frontZ = Math.cos(piano.rotationY);
        focus.set(piano.position.x + frontX * 0.35, piano.position.y + 1.12, piano.position.z + frontZ * 0.35);
        desired.set(piano.position.x - 3.3 + frontX * 3.0, piano.position.y + 4.0, piano.position.z + frontZ * 3.0);
        camera.position.lerp(desired, 1 - Math.exp(-4 * dt)); camera.lookAt(focus);
      } else {
      const forwardX = -Math.sin(player.yaw); const forwardZ = -Math.cos(player.yaw);
      const rightX = Math.cos(player.yaw); const rightZ = -Math.sin(player.yaw);
      focus.set(player.x + forwardX * 1.35, player.y + 1.22 + player.pitch * 1.1, player.z + forwardZ * 1.35);
      desired.set(player.x - forwardX * 4.75 + rightX * 2.65, player.y + 2.9 + player.pitch, player.z - forwardZ * 4.75 + rightZ * 2.65);
      const targetDistance = safeCameraDistance(focus, desired, layout.cameraBlockers, { radius: 0.2, clearance: 0.1 });
      cameraArmDistance = approachCameraDistance(cameraArmDistance, targetDistance, dt);
      ray.subVectors(desired, focus); const length = ray.length();
      camera.position.copy(focus).addScaledVector(ray, length > 0 ? cameraArmDistance / length : 0); camera.lookAt(focus);
      }
    }
    animateCharacter(avatar, dt, elapsed, { speed: player.moving ? (player.running ? 2 : 1) : 0 });
    animateCharacter(maestro, dt, elapsed, { talking: state?.stage === 'briefing', lookYaw: Math.sin(elapsed * 0.55) * 0.08 });
    if (instrumentMode) {
      avatar.userData.body.rotation.x = 0.08;
      avatar.userData.legs.forEach(({ pivot }) => { pivot.rotation.x = PIANIST_SEATED_LEG_ANGLE; });
      avatar.userData.arms.forEach((arm, side) => {
        arm.shoulder.position.x = arm.side * (arm.side > 0 ? 0.82 : 0.68);
        arm.shoulder.position.z = 0.14;
        arm.shoulder.rotation.x = PIANIST_PLAYING_ARM_ANGLE;
        arm.shoulder.rotation.z = side ? 0.85 : -0.75;
      });
    } else {
      avatar.userData.arms.forEach((arm) => {
        arm.shoulder.position.x = arm.side * 0.53;
        arm.shoulder.position.z = 0;
      });
    }
    updatePrompt(findTarget());
    look.update(focus.set(player.x, 0, player.z), elapsed);
    renderer.render(scene, camera);
  }
  raf = window.requestAnimationFrame(animate);

  function dispose() {
    window.cancelAnimationFrame(raf); window.removeEventListener('resize', resize);
    window.removeEventListener('keydown', onKeyDown, true); renderer.domElement.removeEventListener('pointerdown', onPointerDown);
    for (const timer of keyTimers) window.clearTimeout(timer); keyTimers.clear(); input.dispose();
    pianos.forEach((piano) => piano.dispose());
    disposeAdded(maestro); disposeCharacter(maestro); disposeCharacter(avatar); layout.dispose(); look.dispose();
    renderer.dispose(); renderer.domElement.remove();
  }
  function getKeyScreenPositions() {
    camera.updateMatrixWorld();
    activePiano.root.updateMatrixWorld(true);
    return [...activePiano.keys].map(([note, key]) => {
      const point = key.getWorldPosition(new THREE.Vector3()).project(camera);
      return { note, x: Math.round((point.x + 1) * 0.5 * renderer.domElement.clientWidth), y: Math.round((1 - point.y) * 0.5 * renderer.domElement.clientHeight), visible: point.z >= -1 && point.z <= 1 };
    });
  }
  return {
    setTaskState, setUiBlocked, setInstrumentMode, setQuality,
    getQuality: () => quality,
    getPosition: () => ({ x: player.x, y: player.y, z: player.z, yaw: player.yaw }),
    getRenderStats: () => ({ ...renderer.info.render, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }),
    getKeyScreenPositions,
    dispose,
  };
}

import * as THREE from 'three';
import { WINDOW_HIT_LIMIT } from './state.js';
import { LOCAL_POINTS, LOCAL_WINDOWS, START, WALL, WINDOW_DEPTH } from './layout.js';
import { SAFETY_ZONE, blockedBySafetyZone } from './safety-zone.js';
import { canMoveWithHose } from './hose-length.js';
import { advanceReel, REEL_RADIUS, woundTurns } from './reel-motion.js';
import { PALETTE } from '../../engine/art/palette.js';
import { applyStylizedLook } from '../../engine/art/lighting.js';
import { isSharedResource, stdMat } from '../../engine/art/materials.js';
import { QUALITY_PRESETS, readQuality, saveQuality } from '../../engine/art/quality.js';
import {
  animateCharacter, appearanceFromSeed, createCharacter, reactToEvent, resetArms, setArmReach, setCarry, setCharacterQuality, setPersonEquipment, triggerGesture, yawToward,
} from '../../engine/art/character.js';
import { buildFireTruck, buildHoseStand, buildLocker, buildMannequin, buildSafeZone, buildSafetyBarriers, buildStation, buildTrainingWall, createObjectiveMarker } from './station-art.js';
import { createScenery } from './scenery.js';

export { setPersonEquipment };

// Дальность клавиши E у стойки рукава. С рукавом в руках игрок удаляется от стойки не дальше HOSE_REACH (hose-length.js).
const HOSE_USE_DISTANCE = 2.8;
// Маруся здоровается, когда игрок подходит ближе этого расстояния, и поворачивается к нему.
const NPC_GREET_DISTANCE = 6.5;
const NPC_NOTICE_DISTANCE = 11;

/**
 * Персонаж Kidburg. `player` оставлен для совместимости: любой человек может сменить экипировку.
 * @param {{name?: string, outfit?: THREE.Material|string, helmet?: boolean, player?: boolean, appearance?: object}} options
 */
export function createPerson({ name, outfit, helmet = false, appearance, id = 0, color = null } = {}) {
  return createCharacter({
    name,
    outfit,
    helmet,
    appearance: appearance ?? appearanceFromSeed(id, color),
  });
}

/** Маруся Громова: наставница пожарной части. Узнаётся по белой каске, бордовой куртке, хвосту и планшету. */
export function createMarusya() {
  return createCharacter({
    name: 'Маруся Громова',
    subtitle: 'Наставник',
    gear: 'mentor',
    equipped: true,
    helmet: true,
    holding: 'clipboard',
    nameScale: 1.12,
    // Индивидуальная внешность Маруси задана явно: лицо, причёска и характер не зависят от id.
    appearance: {
      seed: 4107, skin: '#f4c8a2', hair: '#5b3a2b', hairStyle: 'ponytail', outfit: '#9c3a31', pants: '#2f3e4a',
      build: 'standard', faceShape: 'oval', eyeShape: 'round', eyeSize: 1.02, eyeColor: '#4f7d4a', browStyle: 'arched', noseStyle: 'button', mouthStyle: 'small',
      earHeight: 1, accessory: 'none', shoes: 'boot', bootColor: '#6b4a38',
    },
    personality: { expression: 'happy', intensity: 0.3 },
  });
}

// Игровая площадка (земля 90×90) ограничена этим расстоянием от начала локальных координат.
export const WALK_LIMIT = 43;

/** Освобождает ресурсы модели, кроме общих (геометрии, материалы и текстуры art/ живут всю сессию). */
function disposeModel(root) {
  root.traverse((node) => {
    if (node.geometry && !isSharedResource(node.geometry)) node.geometry.dispose();
    const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    for (const material of materials) {
      if (isSharedResource(material)) continue;
      if (material.map && !isSharedResource(material.map)) material.map.dispose();
      material.dispose();
    }
  });
}

export function createFirefighterScene({ container, onPrompt, onAction, onNotice, onHoseMode, onTarget = () => {}, onPosition = () => {} }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 260);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', 'Игровая сцена пожарной части. Кликните, чтобы управлять камерой.');
  container.appendChild(renderer.domElement);

  const look = applyStylizedLook({ renderer, scene, camera, fog: [46, 135], shadowExtent: 26, exposure: 1.02 });
  let quality = readQuality();
  setCharacterQuality(quality);
  let detail = look.setQuality(quality).detail;
  const scenery = createScenery({ detail });
  scene.add(scenery.group);

  const station = buildStation();
  station.position.set(-9, 0, -4);
  scene.add(station);
  const truck = buildFireTruck();
  truck.position.set(5.7, 0, -4.4);
  scene.add(truck);

  const player = createPerson({ id: 1, outfit: PALETTE.green });
  player.userData.appearanceSeed = 1;
  player.position.set(START.x, 0, START.z);
  scene.add(player);
  const remotePlayers = new Map();
  const npc = createMarusya();
  npc.position.set(LOCAL_POINTS.npc.x, 0, LOCAL_POINTS.npc.z);
  const npcRestYaw = 0;
  npc.rotation.y = npcRestYaw;
  scene.add(npc);

  const locker = buildLocker();
  locker.position.set(LOCAL_POINTS.locker.x, 0, LOCAL_POINTS.locker.z);
  scene.add(locker);

  // Учебная стена: четыре окна с безобидным условным огнём, каждое тушится независимо.
  // Центры окон берутся из layout.js — их же проверяет сервер.
  const wall = buildTrainingWall({ center: WALL, windows: LOCAL_WINDOWS, windowDepth: WINDOW_DEPTH });
  scene.add(wall.group);
  const { windows, flameParts } = wall;
  scene.add(buildSafetyBarriers(WALL.x));

  const hoseModel = buildHoseStand();
  const hoseStand = hoseModel.group;
  const { reel, nozzle } = hoseModel;
  hoseStand.position.set(LOCAL_POINTS.hose.x, 0, LOCAL_POINTS.hose.z);
  scene.add(hoseStand);

  const hoseMaterial = stdMat(PALETTE.orange, { roughness: 0.6 });
  const heldHose = new THREE.Group();
  heldHose.position.set(0.25, 1.18, 0.48);
  const addHoseCylinder = (z, radiusTop, radiusBottom, length, material) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, length, 10), material);
    mesh.position.z = z;
    mesh.rotation.x = Math.PI / 2;
    mesh.castShadow = true;
    heldHose.add(mesh);
  };
  addHoseCylinder(0.35, 0.19, 0.19, 1.2, stdMat(PALETTE.charcoal, { roughness: 0.5 }));
  addHoseCylinder(1.03, 0.24, 0.16, 0.3, stdMat(PALETTE.yellow, { roughness: 0.4, metalness: 0.2 }));
  addHoseCylinder(-0.45, 0.16, 0.19, 0.5, hoseMaterial);
  player.userData.body.add(heldHose);
  heldHose.visible = false;

  // Фиксированный набор экземпляров: геометрия при движении не пересоздаётся.
  const hoseSegments = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.13, 1, 8), hoseMaterial, 24);
  hoseSegments.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  hoseSegments.frustumCulled = false;
  hoseSegments.castShadow = true;
  hoseSegments.visible = false;
  scene.add(hoseSegments);
  const coilSegments = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.13, 1, 8), hoseMaterial, 96);
  coilSegments.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  coilSegments.frustumCulled = false;
  coilSegments.castShadow = true;
  reel.add(coilSegments);
  const hoseCurve = new THREE.CatmullRomCurve3(Array.from({ length: 7 }, () => new THREE.Vector3()));
  const hoseStart = new THREE.Vector3();
  const hoseEnd = new THREE.Vector3();
  const hosePrevious = new THREE.Vector3();
  const hoseNext = new THREE.Vector3();
  const hoseDirection = new THREE.Vector3();
  const hoseDummy = new THREE.Object3D();
  const hoseAxis = new THREE.Vector3(0, 1, 0);
  const reelCenter = new THREE.Vector3();
  let reelAngle = 0;
  let previousHoseLength = null;

  function setSegment(instances, index, start, end) {
    hoseDirection.subVectors(end, start);
    const length = hoseDirection.length();
    hoseDummy.position.copy(start).add(end).multiplyScalar(0.5);
    if (length > 0) hoseDummy.quaternion.setFromUnitVectors(hoseAxis, hoseDirection.multiplyScalar(1 / length));
    hoseDummy.scale.set(1, length + 0.03, 1);
    hoseDummy.updateMatrix();
    instances.setMatrixAt(index, hoseDummy.matrix);
  }

  function updateCoil() {
    reel.rotation.z = reelAngle;
    const turns = woundTurns(reelAngle);
    const exitAngle = Math.PI / 2 - reelAngle;
    const point = (t, result) => {
      const angle = exitAngle + (1 - t) * turns * Math.PI * 2;
      return result.set(REEL_RADIUS * Math.cos(angle), REEL_RADIUS * Math.sin(angle), -0.45 + t * 0.9);
    };
    point(0, hosePrevious);
    for (let i = 0; i < coilSegments.count; i++) {
      point((i + 1) / coilSegments.count, hoseNext);
      setSegment(coilSegments, i, hosePrevious, hoseNext);
      hosePrevious.copy(hoseNext);
    }
    coilSegments.instanceMatrix.needsUpdate = true;
  }
  updateCoil();

  function updateHose() {
    heldHose.localToWorld(hoseEnd.set(0, 0, -0.7));
    hoseStand.localToWorld(reelCenter.set(0, 1.2, 0.28));
    const hoseLength = reelCenter.distanceTo(hoseEnd);
    // Видимый моток ограничен правдоподобным числом витков даже после многих подъёмов рукава.
    reelAngle = THREE.MathUtils.clamp(advanceReel(reelAngle, previousHoseLength, hoseLength), -Math.PI * 7, Math.PI * 5);
    previousHoseLength = hoseLength;
    updateCoil();
    // Спираль выходит с верхнего края катушки; первая касательная направлена вправо.
    hoseStart.copy(reelCenter).add(new THREE.Vector3(0, REEL_RADIUS, 0.45));
    hoseCurve.points[0].copy(hoseStart);
    const pitch = 0.9 / (Math.PI * 2 * woundTurns(reelAngle) * REEL_RADIUS);
    hoseCurve.points[1].copy(hoseStart).add(new THREE.Vector3(0.45, 0, 0.45 * pitch));
    hoseCurve.points[2].copy(hoseStart).add(new THREE.Vector3(0.8, -0.15, 0.45));
    hoseCurve.points[6].copy(hoseEnd);
    for (let i = 3; i < 6; i++) {
      const point = hoseCurve.points[i].lerpVectors(hoseCurve.points[2], hoseEnd, (i - 2) / 4);
      point.y = 0.16;
    }
    hoseCurve.getPoint(0, hosePrevious);
    for (let i = 0; i < hoseSegments.count; i++) {
      hoseCurve.getPoint((i + 1) / hoseSegments.count, hoseNext);
      hoseNext.y = Math.max(0.14, hoseNext.y);
      setSegment(hoseSegments, i, hosePrevious, hoseNext);
      hosePrevious.copy(hoseNext);
    }
    hoseSegments.instanceMatrix.needsUpdate = true;
  }

  const mannequin = buildMannequin();
  mannequin.position.set(LOCAL_POINTS.mannequin.x, 0, LOCAL_POINTS.mannequin.z);
  mannequin.rotation.y = -0.45;
  scene.add(mannequin);
  const carried = buildMannequin({ withSign: false });
  carried.scale.setScalar(0.55);
  carried.position.set(0, 1.2, 0.66);
  carried.rotation.set(0, 0, -Math.PI / 2.2);
  player.add(carried);
  carried.visible = false;

  const safeZone = buildSafeZone();
  safeZone.position.set(LOCAL_POINTS.safe_zone.x, 0.01, LOCAL_POINTS.safe_zone.z);
  scene.add(safeZone);

  const marker = createObjectiveMarker();
  scene.add(marker.group);

  const beamMaterial = new THREE.MeshBasicMaterial({ color: '#b9f4ff', transparent: true, opacity: 0.82 });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 1, 8), beamMaterial);
  beam.visible = false;
  scene.add(beam);

  const blockers = [
    { minX: WALL.x - 3.5, maxX: WALL.x + 3.5, minZ: WALL.z - 0.4, maxZ: WALL.z + 0.4 },
    { minX: -15.8, maxX: -2.2, minZ: -8.8, maxZ: 1.1 },
    { minX: 3.1, maxX: 8.3, minZ: -6.8, maxZ: -2.0 },
    { minX: -8.7, maxX: -6.5, minZ: 1.3, maxZ: 3.2 },
    { minX: -1.0, maxX: 1.0, minZ: 6.4, maxZ: 8.4 },
  ];
  const keys = new Set();
  const raycaster = new THREE.Raycaster();
  const centerScreen = new THREE.Vector2(0, 0);
  let state = null;
  let cameraYaw = 0;
  let cameraPitch = 0.1;
  let pointerLocked = false;
  let uiBlocked = false;
  let waterHeld = false;
  let hoseActive = false;
  let hitAccumulator = 0;
  let aim = null; // {end, index}: куда смотрит прицел, пока рукав в руках
  let targetWindow = null;
  let lastSafetyNotice = -Infinity;
  let prompt = '';
  let previousStage = '';
  let previousStageForReaction = '';
  let frameId = 0;
  let npcTalking = false;
  let npcGreeted = false;
  let debugCamera = null; // отладка: фиксированная поза камеры (?debug=1)

  const pointOf = (object) => object.getWorldPosition(new THREE.Vector3());
  const distanceTo = (object) => {
    const p = pointOf(object);
    return Math.hypot(player.position.x - p.x, player.position.z - p.z);
  };
  const setPrompt = (text) => {
    if (prompt !== text) {
      prompt = text;
      onPrompt(text);
    }
  };
  const stopHose = () => {
    if (!hoseActive) return;
    hoseActive = false;
    waterHeld = false;
    beam.visible = false;
    heldHose.visible = false;
    hoseSegments.visible = false;
    previousHoseLength = null;
    nozzle.visible = true;
    aim = null;
    resetArms(player);
    setTarget(null);
    onHoseMode(false);
    if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
  };

  function setTarget(index) {
    if (targetWindow === index) return;
    targetWindow = index;
    onTarget(index);
  }

  /** Куда смотрит маркер цели для текущего этапа; null — маркер скрыт. */
  function updateMarker() {
    const stage = state?.stage ?? 'not_started';
    let at = null;
    let height = 3.4;
    let radius = 1.5;
    if (uiBlocked) at = null;
    else if (stage === 'not_started' || stage === 'briefing' || stage === 'debrief') { at = npc.position; height = 3.7; radius = 1.2; }
    else if (stage === 'equipping' && !state?.equipped) { at = locker.position; height = 3.55; radius = 1.5; }
    else if (stage === 'fire_drill' && !hoseActive) { at = hoseStand.position; height = 3.2; radius = 1.55; }
    else if (stage === 'rescue') {
      if (state?.carryingMannequin) { at = safeZone.position; height = 3.2; radius = 1.9; }
      else if (mannequin.visible) { at = mannequin.position; height = 2.2; radius = 1.3; }
    }
    marker.setTarget(at, height, radius);
  }

  function setTaskState(next) {
    state = next;
    const stage = state?.stage ?? 'not_started';
    if (stage !== previousStage && stage !== 'fire_drill') stopHose();
    previousStage = stage;
    setPersonEquipment(player, state?.equipped);
    setCarry(player, state?.carryingMannequin);
    // Реакция наставницы на подтверждённый сервером прогресс: только внешний вид, логику не затрагивает.
    if (previousStageForReaction && stage !== previousStageForReaction) reactToEvent(npc, stage === 'completed' ? 'task_complete' : 'task_success');
    previousStageForReaction = stage;
    // Состояние окон приходит с сервера (task_state): огонь гаснет и уменьшается по числу подтверждённых попаданий.
    windows.forEach(({ flames }, index) => {
      const hits = state?.windows?.[index] ?? 0;
      flames.visible = stage === 'fire_drill' && hits < WINDOW_HIT_LIMIT;
      flames.scale.setScalar(1 - (0.7 * hits) / WINDOW_HIT_LIMIT);
    });
    mannequin.visible = stage === 'rescue' && !state?.carryingMannequin && !state?.mannequinDelivered;
    carried.visible = Boolean(state?.carryingMannequin);
    if (stage === 'completed') stopHose();
    updateMarker();
  }

  function updatePrompt() {
    if (!state || uiBlocked) return setPrompt('');
    let text = '';
    if (distanceTo(npc) < LOCAL_POINTS.npc.radius) {
      text = state.stage === 'debrief' ? 'Обсудить итог тренировки' : 'Поговорить с Марусей';
    }
    if (state.stage === 'equipping' && distanceTo(locker) < LOCAL_POINTS.locker.radius) text = 'Надеть экипировку';
    if (state.stage === 'fire_drill' && distanceTo(hoseStand) < HOSE_USE_DISTANCE) text = hoseActive ? 'Завершить упражнение с рукавом' : 'Взять учебный рукав';
    if (state.stage === 'rescue') {
      if (!state.carryingMannequin && distanceTo(mannequin) < LOCAL_POINTS.mannequin.radius) text = 'Поднять манекен';
      else if (state.carryingMannequin && distanceTo(safeZone) < LOCAL_POINTS.safe_zone.radius) text = 'Доставить манекен';
    }
    setPrompt(text ? `E · ${text}` : '');
  }

  function interact() {
    if (!state || uiBlocked) return;
    if (distanceTo(npc) < LOCAL_POINTS.npc.radius) {
      onAction('open_chat'); // разговор с Марусей: действия этапа — кнопки в панели, подтверждает их сервер
      return;
    }
    if (distanceTo(locker) < LOCAL_POINTS.locker.radius) {
      if (state.stage === 'equipping') onAction('equip');
      else onNotice(state.equipped ? 'Экипировка уже надета.' : 'Сначала поговорите с Марусей.');
      return;
    }
    if (distanceTo(hoseStand) < HOSE_USE_DISTANCE) {
      if (state.stage !== 'fire_drill') return onNotice('Сначала выполните предыдущий этап.');
      hoseActive = !hoseActive;
      waterHeld = false;
      heldHose.visible = hoseActive;
      hoseSegments.visible = hoseActive;
      previousHoseLength = null;
      nozzle.visible = !hoseActive;
      if (!hoseActive) {
        aim = null;
        resetArms(player);
        setTarget(null);
      }
      onHoseMode(hoseActive);
      updateMarker();
      if (hoseActive) {
        onNotice('Учебный рукав готов. Наведите прицел на окно и удерживайте левую кнопку мыши.');
        renderer.domElement.requestPointerLock?.();
      } else {
        beam.visible = false;
        onNotice('Упражнение приостановлено. Нажмите E у рукава, чтобы продолжить.');
        if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      }
      return;
    }
    if (state.stage === 'rescue') {
      if (!state.carryingMannequin && distanceTo(mannequin) < LOCAL_POINTS.mannequin.radius) return onAction('pickup_mannequin');
      if (state.carryingMannequin && distanceTo(safeZone) < LOCAL_POINTS.safe_zone.radius) return onAction('deliver_mannequin');
    }
  }

  const isTyping = (event) => Boolean(event.target?.closest?.('input, textarea, select, [contenteditable="true"]'));

  function onKeyDown(event) {
    if (isTyping(event)) return;
    if (event.code === 'Escape') {
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      return;
    }
    if (event.code === 'KeyE') {
      if (!event.repeat) interact();
      return;
    }
    if (uiBlocked) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
      keys.add(event.code);
      if (event.code !== 'ShiftLeft' && event.code !== 'ShiftRight') event.preventDefault();
    }
  }
  function onKeyUp(event) { keys.delete(event.code); }
  function onMouseMove(event) {
    if (!pointerLocked || uiBlocked) return;
    cameraYaw -= event.movementX * 0.0024;
    cameraPitch = THREE.MathUtils.clamp(cameraPitch + event.movementY * 0.0018, -0.8, 0.55);
  }
  function onPointerLockChange() {
    pointerLocked = document.pointerLockElement === renderer.domElement;
    if (!pointerLocked) waterHeld = false;
  }
  function onPointerDown(event) { if (event.button === 0 && hoseActive && !uiBlocked) waterHeld = true; }
  function onPointerUp(event) { if (event.button === 0) waterHeld = false; }
  function onBlur() { keys.clear(); waterHeld = false; }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onPointerDown);
  window.addEventListener('mouseup', onPointerUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  renderer.domElement.addEventListener('click', () => {
    if (!uiBlocked && !document.pointerLockElement) renderer.domElement.requestPointerLock?.();
  });

  const resizeObserver = new ResizeObserver(() => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  });
  resizeObserver.observe(container);

  function isBlocked(x, z) {
    const radius = 0.4;
    if (Math.abs(x) > WALK_LIMIT || Math.abs(z) > WALK_LIMIT) return true;
    return blockers.some((b) => x + radius > b.minX && x - radius < b.maxX && z + radius > b.minZ && z - radius < b.maxZ);
  }

  function movePlayer(delta) {
    if (uiBlocked) return;
    const forwardInput = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
    const sideInput = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
    const input = new THREE.Vector2(sideInput, forwardInput);
    if (input.lengthSq() < 0.01) return;
    input.normalize();
    const forwardX = -Math.sin(cameraYaw);
    const forwardZ = -Math.cos(cameraYaw);
    const rightX = Math.cos(cameraYaw);
    const rightZ = -Math.sin(cameraYaw);
    const dx = (rightX * input.x + forwardX * input.y);
    const dz = (rightZ * input.x + forwardZ * input.y);
    const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? 7.2 : 4.5;
    const nextX = player.position.x + dx * speed * delta;
    const nextZ = player.position.z + dz * speed * delta;
    // Линия безопасности закрывает зону перед стеной на время тушения; уже оказавшийся в ней игрок может выйти.
    const insideNow = blockedBySafetyZone(state?.stage, player.position.x, player.position.z);
    const blockedSafety = (x, z) => {
      if (insideNow || !blockedBySafetyZone(state?.stage, x, z)) return false;
      if (clock.elapsedTime - lastSafetyNotice > 2.8) {
        lastSafetyNotice = clock.elapsedTime;
        onNotice('Не пересекайте ограничительную линию!');
      }
      return true;
    };
    const canMove = (x, z) => canMoveWithHose(hoseActive, player.position, { x, z }, hoseStand.position);
    if (!isBlocked(nextX, player.position.z) && !blockedSafety(nextX, player.position.z) && canMove(nextX, player.position.z)) player.position.x = nextX;
    if (!isBlocked(player.position.x, nextZ) && !blockedSafety(player.position.x, nextZ) && canMove(player.position.x, nextZ)) player.position.z = nextZ;
    if (!hoseActive) player.rotation.y = Math.atan2(dx, dz);
  }

  // Камера: ближе и ниже прежней, чуть уже угол обзора — здания заполняют кадр, персонаж остаётся слева от центра.
  const CAMERA_DISTANCE = 7.4;
  const CAMERA_HEIGHT = 3.05;
  function updateCamera() {
    if (debugCamera) {
      camera.position.copy(debugCamera.position);
      camera.lookAt(debugCamera.target);
      return;
    }
    const target = new THREE.Vector3(
      player.position.x - Math.sin(cameraYaw) * 3.2,
      2.3 - cameraPitch * 7.5,
      player.position.z - Math.cos(cameraYaw) * 3.2,
    );
    camera.position.set(
      player.position.x + Math.sin(cameraYaw) * CAMERA_DISTANCE + Math.cos(cameraYaw) * 1.7,
      CAMERA_HEIGHT,
      player.position.z + Math.cos(cameraYaw) * CAMERA_DISTANCE - Math.sin(cameraYaw) * 1.7,
    );
    camera.lookAt(target);
  }

  function addRemotePlayer(id, name, equipped = false, color = null) {
    const known = remotePlayers.get(id);
    if (known) {
      setPersonEquipment(known.model, equipped);
      return known;
    }
    const model = createPerson({ name: name || `Игрок ${id}`, id, color });
    setPersonEquipment(model, equipped);
    model.visible = false;
    scene.add(model);
    const remote = { model, x: 0, z: 0, heading: 0, moving: false, ready: false, speed: 0 };
    remotePlayers.set(id, remote);
    return remote;
  }

  function removeRemotePlayer(id) {
    const remote = remotePlayers.get(id);
    if (!remote) return;
    scene.remove(remote.model);
    disposeModel(remote.model);
    remotePlayers.delete(id);
  }

  function setRemotePlayerEquipment(id, equipped) {
    const remote = remotePlayers.get(id);
    if (remote) setPersonEquipment(remote.model, equipped);
  }

  function clearRemotePlayers() {
    for (const id of [...remotePlayers.keys()]) removeRemotePlayer(id);
  }

  /** @param {Array<{id: number, x: number, z: number, heading: number, moving: boolean}>} list локальные координаты */
  function updateRemotePlayers(list) {
    for (const { id, x, z, heading, moving } of list) {
      const remote = addRemotePlayer(id);
      remote.x = x;
      remote.z = z;
      remote.heading = heading;
      remote.moving = moving;
      if (!remote.ready) {
        remote.model.position.set(x, 0, z);
        remote.model.rotation.y = heading;
        remote.model.visible = true;
        remote.ready = true;
      }
    }
  }

  /** Можно ли стоять в точке (локальные координаты). */
  function isWalkable(x, z) { return !isBlocked(x, z); }

  function setLocalPosition({ x, z, heading = 0 }) {
    player.position.set(x, 0, z);
    player.rotation.y = heading;
    cameraYaw = heading - Math.PI; // камера сзади игрока: модель смотрит вдоль направления движения
    keys.clear();
  }

  function localPosition() {
    const moving = keys.has('KeyW') || keys.has('KeyA') || keys.has('KeyS') || keys.has('KeyD');
    const fast = moving && (keys.has('ShiftLeft') || keys.has('ShiftRight'));
    return {
      x: player.position.x,
      z: player.position.z,
      heading: player.rotation.y,
      anim: fast ? 2 : moving ? 1 : 0,
    };
  }

  /**
   * Прицел из центра экрана по окнам. Пока рукав в руках, персонаж смотрит туда же, куда прицел:
   * сервер проверяет направление по ry из pos, поэтому поворот применяется до отправки позиции в кадре.
   */
  function updateHoseAim() {
    if (!hoseActive || state?.stage !== 'fire_drill') {
      aim = null;
      hitAccumulator = 0;
      setTarget(null);
      return;
    }
    updateCamera();
    raycaster.setFromCamera(centerScreen, camera);
    const hits = raycaster.intersectObjects(windows.map((window) => window.pane));
    const end = hits.length ? hits[0].point : raycaster.ray.at(18, new THREE.Vector3());
    player.rotation.y = Math.atan2(raycaster.ray.direction.x, raycaster.ray.direction.z);
    player.updateMatrixWorld(true);
    heldHose.lookAt(end);
    player.updateMatrixWorld(true);
    player.userData.armsLocked = true;
    player.userData.arms.forEach((arm, i) => {
      const { shoulder } = arm;
      const grip = heldHose.localToWorld(new THREE.Vector3(i ? 0.14 : -0.14, 0, i ? 0.05 : 0.55));
      const localGrip = shoulder.parent.worldToLocal(grip).sub(shoulder.position);
      const length = localGrip.length();
      shoulder.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), localGrip.normalize());
      setArmReach(arm, length);
    });
    player.updateMatrixWorld(true);
    updateHose();
    const index = hits.length ? hits[0].object.userData.windowIndex : null;
    if (index !== targetWindow) hitAccumulator = 0;
    setTarget(index);
    aim = { end, index };
  }

  /** Струя и серия попаданий: каждое отправляется на сервер, засчитывает его только task_state. */
  function updateWater(delta) {
    if (!aim || !waterHeld || uiBlocked) {
      beam.visible = false;
      hitAccumulator = 0;
      return;
    }
    const start = heldHose.localToWorld(new THREE.Vector3(0, 0, 1.18));
    const direction = aim.end.clone().sub(start);
    beam.position.copy(start).addScaledVector(direction, 0.5);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    beam.scale.set(1, direction.length(), 1);
    beam.visible = true;
    const { index } = aim;
    if (index === null || (state?.windows?.[index] ?? 0) >= WINDOW_HIT_LIMIT) {
      hitAccumulator = 0;
      return;
    }
    hitAccumulator += delta;
    if (hitAccumulator >= 0.16) {
      hitAccumulator = 0;
      onAction('window_hit', index);
    }
  }

  /** Маруся: поворачивается к игроку, здоровается на подходе, жестикулирует во время разговора. */
  function updateNpc(delta, elapsed) {
    const near = Math.hypot(player.position.x - npc.position.x, player.position.z - npc.position.z);
    const noticing = near < NPC_NOTICE_DISTANCE;
    if (near < NPC_GREET_DISTANCE && !npcGreeted) {
      npcGreeted = true;
      reactToEvent(npc, 'greet');
    } else if (near > NPC_NOTICE_DISTANCE) npcGreeted = false;
    const want = noticing ? Math.atan2(player.position.x - npc.position.x, player.position.z - npc.position.z) : npcRestYaw;
    const turn = ((((want - npc.rotation.y) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    npc.rotation.y += turn * Math.min(1, delta * 3.2);
    const lookYaw = noticing ? yawToward(npc, player.position.x, player.position.z) : 0;
    animateCharacter(npc, delta, elapsed, { speed: 0, talking: npcTalking, lookYaw });
  }

  let previousFrameTime = null;
  // Первый вызов — animate() без аргументов: без значения по умолчанию delta становилась NaN и портила поворот Маруси.
  function animate(timestamp = performance.now()) {
    frameId = requestAnimationFrame(animate);
    const delta = previousFrameTime === null ? 0 : Math.min((timestamp - previousFrameTime) / 1000, 0.05);
    const elapsed = timestamp / 1000;
    previousFrameTime = timestamp;
    movePlayer(delta);
    updateHoseAim();
    const position = localPosition();
    onPosition(position);
    animateCharacter(player, delta, elapsed, { speed: uiBlocked ? 0 : position.anim });
    for (const remote of remotePlayers.values()) {
      if (!remote.ready) continue;
      const amount = Math.min(1, delta * 12);
      const px = remote.model.position.x;
      const pz = remote.model.position.z;
      remote.model.position.x += (remote.x - px) * amount;
      remote.model.position.z += (remote.z - pz) * amount;
      const angle = ((((remote.heading - remote.model.rotation.y) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      remote.model.rotation.y += angle * amount;
      // Скорость берём из реального перемещения, чтобы походка совпадала с движением без новых полей протокола.
      const velocity = delta > 0 ? Math.hypot(remote.model.position.x - px, remote.model.position.z - pz) / delta : 0;
      remote.speed = remote.moving ? (velocity > 6 ? 2 : 1) : 0;
      animateCharacter(remote.model, delta, elapsed, { speed: remote.speed });
    }
    updateNpc(delta, elapsed);
    flameParts.forEach((flame, index) => {
      const pulse = 1 + Math.sin(elapsed * 6 + index * 1.3) * 0.09;
      flame.scale.y = flame.userData.baseY ??= flame.scale.y;
      flame.scale.y *= pulse;
      flame.rotation.z = Math.sin(elapsed * 3.1 + index) * 0.05;
    });
    safeZone.userData.flag.rotation.y = Math.sin(elapsed * 2.2) * 0.25;
    marker.update(elapsed);
    scenery.update(elapsed);
    if (!aim) updateCamera();
    look.update(player.position, elapsed);
    updatePrompt();
    updateWater(delta);
    renderer.render(scene, camera);
  }
  animate();

  const resizeNow = () => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };

  return {
    setTaskState,
    addRemotePlayer,
    setRemotePlayerEquipment,
    removeRemotePlayer,
    clearRemotePlayers,
    updateRemotePlayers,
    isWalkable,
    setLocalPosition,
    localPosition,
    /** Маруся «говорит»: открыт разговор с ней. Кивок и жест приветствия — при открытии. */
    setNpcTalking(value) {
      const next = Boolean(value);
      if (next && !npcTalking) reactToEvent(npc, 'talk_start');
      npcTalking = next;
    },
    getQuality: () => quality,
    /** Графика: low / medium / high; выбор запоминается в браузере игрока. */
    setQuality(level) {
      if (!QUALITY_PRESETS[level]) return quality;
      quality = level;
      setCharacterQuality(level);
      detail = look.setQuality(level).detail;
      scenery.setDetail(detail);
      saveQuality(level);
      resizeNow();
      return quality;
    },
    setUiBlocked(value) {
      uiBlocked = Boolean(value);
      if (!uiBlocked) return;
      keys.clear();
      waterHeld = false;
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
    },
    /** Инструменты проверки (?debug=1 в main.js): положение камеры, статистика отрисовки, прямой доступ к сцене. */
    debug: {
      scene, camera, renderer, player, npc,
      setCamera(position, target) { debugCamera = position ? { position: new THREE.Vector3(...position), target: new THREE.Vector3(...target) } : null; },
      stats() {
        const { render, memory } = renderer.info;
        return { calls: render.calls, triangles: render.triangles, geometries: memory.geometries, textures: memory.textures, quality };
      },
      gesture: (kind) => triggerGesture(npc, kind),
      // Только визуальная проверка: ничего не отправляет на сервер, следующее task_state перезапишет вид.
      showState: setTaskState,
      equipPlayer: (value) => setPersonEquipment(player, value),
      spawnRemote(id, x, z, { equipped = false, color = null, heading = Math.PI, moving = false } = {}) {
        addRemotePlayer(id, `Игрок ${id}`, equipped, color);
        updateRemotePlayers([{ id, x, z, heading, moving }]);
      },
    },
    dispose() {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('mouseup', onPointerUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      clearRemotePlayers();
      for (const root of [player, npc, station, truck, locker, wall.group, hoseStand, mannequin, safeZone]) disposeModel(root);
      hoseSegments.geometry.dispose();
      coilSegments.geometry.dispose();
      beam.geometry.dispose();
      beamMaterial.dispose();
      marker.dispose();
      scenery.dispose();
      look.dispose();
      wall.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}

// Спутниковая антенна радиостанции: неподвижная стойка (в геометрии здания), поворотная платформа, тарелка с
// держателем приёмника и мигающий маячок на мачте. Тарелка не крутится как вентилятор: она держит направление,
// плавно перенаводится на новую точку в ограниченных углах и снова замирает.
//
// Координаты — локальные координаты здания (как в radio-station.js); владелец оборачивает root в группу инстанса.
import * as THREE from 'three';
import { createPrefabKit } from '../art/prefab-kit.js';
import { createAnimatedObject, createStateMachine, easeInOutCubic, lerp } from '../animated.js';

export const DISH_LIMITS = Object.freeze({
  yaw: Object.freeze({ min: -1.15, max: 1.15 }), // рад от исходного направления
  tilt: Object.freeze({ min: 0.3, max: 1.0 }), // рад над горизонтом
  maxSpeed: 0.32, // рад/с: медленный поворот
  pause: Object.freeze({ min: 2.2, max: 5.5 }), // с
});

export const DISH_TRANSITIONS = Object.freeze({
  holding: ['slewing', 'stopped'],
  slewing: ['holding', 'stopped'],
  stopped: ['holding'],
});

// Минимальный детерминированный ГПСЧ: последовательность наведений повторяется для одной и той же точки мира.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let sharedMaterial = null;
const vertexMaterial = () => {
  if (!sharedMaterial) {
    sharedMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.6, metalness: 0.05 });
    sharedMaterial.userData.shared = true;
  }
  return sharedMaterial;
};

const C = { white: 0xffffff, rim: 0xe3e7ea, inner: 0xc4ccd2, metal: 0x506875, dark: 0x345568, red: 0xe0462f };

function build(fn) {
  const kit = createPrefabKit({ seed: 23, tint: 0.01 });
  fn(kit);
  const geometry = kit.build({ groundAO: null, underside: 1 });
  geometry.userData.owned = true;
  return geometry;
}

/**
 * @param {object} o
 * @param {[number, number, number]} o.position верх стойки в координатах здания
 * @param {[number, number, number]} [o.beaconPosition] шар маячка на мачте
 * @param {number} [o.seed]
 */
export function createSatelliteDish({ id = 'radio-dish', position, beaconPosition = null, seed = 1, baseYaw = 0 }) {
  const root = new THREE.Group();
  root.name = `dish:${id}`;
  const material = vertexMaterial();

  // Платформа: корпус привода, вращается вокруг вертикали.
  const platform = new THREE.Group();
  platform.position.set(...position);
  platform.rotation.y = baseYaw;
  const platformGeometry = build((k) => {
    k.cyl(0.26, 0.3, 0.2, 10, 0, 0.1, 0, C.metal);
    k.box(0.16, 0.5, 0.16, 0, 0.45, -0.1, C.dark);
  });
  platform.add(Object.assign(new THREE.Mesh(platformGeometry, material), { castShadow: true }));

  // Тарелка с держателем приёмника: поворачивается вокруг горизонтальной оси (угол места).
  const tiltPivot = new THREE.Group();
  tiltPivot.position.set(0, 0.62, 0);
  const dishGeometry = build((k) => {
    // Ось тарелки — локальный +Z: чаша, обод, два держателя и приёмник на конце.
    k.sphere(1.0, 0, 0, 0, C.white, { s: [1, 1, 0.3], w: 16, h: 8 });
    k.sphere(0.8, 0, 0, 0.07, C.inner, { s: [1, 1, 0.22], w: 14, h: 6, tinted: false });
    k.torus(1.0, 0.035, 0, 0, 0.03, C.rim, { radial: 5, tubular: 22, rot: [0, 0, 0] });
    for (const side of [-1, 1]) k.tube([[side * 0.04, -0.05, 0.05], [side * 0.3, -0.2, 0.7], [side * 0.05, 0, 1.15]], 0.025, C.metal, { radial: 4 });
    k.cyl(0.07, 0.1, 0.22, 7, 0, 0, 1.2, C.dark, { rot: [Math.PI / 2, 0, 0] });
    k.sphere(0.08, 0, 0, 1.33, C.red, { w: 6, h: 5, tinted: false });
  });
  tiltPivot.add(Object.assign(new THREE.Mesh(dishGeometry, material), { castShadow: true }));
  // Ось Z тарелки направлена вперёд и вверх на угол места (rotation.x < 0 поднимает +Z вверх).
  platform.add(tiltPivot);
  root.add(platform);

  // Маячок: шар со своим материалом, яркость меняется плавно.
  let beacon = null;
  let beaconMaterial = null;
  let beaconGeometry = null;
  if (beaconPosition) {
    beaconGeometry = new THREE.SphereGeometry(0.3, 12, 8);
    beaconMaterial = new THREE.MeshStandardMaterial({ color: 0x8a1f12, emissive: 0xff3b2a, emissiveIntensity: 0.2, roughness: 0.4 });
    beacon = new THREE.Mesh(beaconGeometry, beaconMaterial);
    beacon.position.set(...beaconPosition);
    beacon.name = `dish:${id}:beacon`;
    root.add(beacon);
  }

  const random = rng(seed);
  const pose = { yaw: 0, tilt: 0.55 };
  let from = { ...pose };
  let to = { ...pose };
  let slewTime = 0;
  let slewDuration = 1;
  let hold = lerp(DISH_LIMITS.pause.min, DISH_LIMITS.pause.max, random());
  let blinkQuality = 1;

  const machine = createStateMachine({ initial: 'holding', transitions: DISH_TRANSITIONS });

  const clampPose = (p) => ({
    yaw: Math.min(DISH_LIMITS.yaw.max, Math.max(DISH_LIMITS.yaw.min, p.yaw)),
    tilt: Math.min(DISH_LIMITS.tilt.max, Math.max(DISH_LIMITS.tilt.min, p.tilt)),
  });
  function apply() {
    const p = clampPose(pose);
    platform.rotation.y = baseYaw + p.yaw;
    tiltPivot.rotation.x = -p.tilt;
  }
  apply();

  function chooseTarget() {
    from = { ...pose };
    // Следующее направление заметно отличается от текущего, но остаётся в ограниченных углах.
    const yaw = lerp(DISH_LIMITS.yaw.min, DISH_LIMITS.yaw.max, random());
    const tilt = lerp(DISH_LIMITS.tilt.min, DISH_LIMITS.tilt.max, random());
    to = clampPose({ yaw, tilt });
    const arc = Math.max(Math.abs(to.yaw - from.yaw), Math.abs(to.tilt - from.tilt) * 1.4);
    slewDuration = Math.max(1.6, 3 * arc / DISH_LIMITS.maxSpeed);
    slewTime = 0;
  }

  const object = createAnimatedObject({
    id,
    root,
    parts: { platform, dish: tiltPivot, beacon },
    machine,
    update(dt, elapsed) {
      if (beaconMaterial) {
        const pulse = Math.max(0, Math.sin(elapsed * 2.6));
        beaconMaterial.emissiveIntensity = 0.12 + 1.4 * pulse * pulse * blinkQuality;
      }
      if (machine.state === 'stopped') return;
      if (machine.state === 'holding') {
        hold -= dt;
        if (hold > 0) return;
        chooseTarget();
        machine.set('slewing');
        return;
      }
      slewTime += dt;
      const t = Math.min(1, slewTime / slewDuration);
      const e = easeInOutCubic(t);
      pose.yaw = lerp(from.yaw, to.yaw, e);
      pose.tilt = lerp(from.tilt, to.tilt, e);
      apply();
      if (t >= 1) {
        hold = lerp(DISH_LIMITS.pause.min, DISH_LIMITS.pause.max, random());
        machine.set('holding');
      }
    },
    api: {
      get pose() { return { ...pose }; },
      /** Остановить/продолжить наведение (Control Center или тесты). */
      stop() { return machine.set('stopped'); },
      resume() { hold = 0.5; return machine.set('holding'); },
      setQuality(level) { blinkQuality = level === 'low' ? 0.6 : 1; },
    },
  });
  return object;
}

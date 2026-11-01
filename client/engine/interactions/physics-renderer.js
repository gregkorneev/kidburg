// Отрисовка серверных мячей. Физику считает только сервер (server/world/ball-physics.js); клиент получает снимки
// ball_snapshot (положение, скорость, флаги) примерно 10 раз в секунду и сглаживает их:
//   • между снимками мяч «доигрывается» от последнего снимка по скорости, гравитации и отскоку (не дольше MAX_EXTRAPOLATION_S);
//   • показываемая позиция догоняет целевую экспоненциально — без рывков; телепорт (возврат на старт) показывается сразу;
//   • вращение выводится из показываемого перемещения (качение без проскальзывания), по сети не передаётся.
// Меши создаются только для мячей в загруженных чанках и освобождаются при выгрузке; геометрия и материал общие.
import * as THREE from 'three';
import { BALL, FIELD } from '../../../shared/interaction-contracts.js';
import { createBallMesh, createPitch } from '../art/interactive-props.js';

export const MAX_EXTRAPOLATION_S = 0.4;
const FOLLOW_RATE = 16; // 1/с: скорость догона целевой позиции
const SNAP_DISTANCE = 4; // дальше — сразу на место
const R = BALL.radius;

/**
 * Положение мяча через `seconds` после снимка (чистая функция, проверяется тестом): горизонтально — качение
 * с замедлением, по вертикали — баллистика с отскоками от земли.
 */
export function extrapolateBall(s, seconds) {
  const t = Math.max(0, Math.min(MAX_EXTRAPOLATION_S, seconds));
  if (s.rest || t === 0) return { x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz };
  let { x, y, z, vx, vy, vz } = s;
  const steps = Math.max(1, Math.ceil(t * 60));
  const dt = t / steps;
  for (let i = 0; i < steps; i++) {
    vy -= BALL.gravity * dt;
    y += vy * dt;
    x += vx * dt;
    z += vz * dt;
    if (y <= R) {
      y = R;
      vy = vy < -BALL.groundBounceMin ? -vy * BALL.restitutionGround : 0;
    }
    if (y <= R + 1e-4 && vy === 0) {
      const speed = Math.hypot(vx, vz);
      if (speed > 0) {
        const next = Math.max(0, speed * Math.exp(-BALL.rollDamping * dt) - BALL.rollDecel * dt);
        vx *= next / speed;
        vz *= next / speed;
      }
    }
  }
  return { x, y, z, vx, vy, vz };
}

/**
 * @param {object} deps
 * @param {THREE.Scene} deps.scene
 * @param {(x: number, z: number) => boolean} deps.isLoaded загружен ли чанк в этой точке
 * @param {() => number} [deps.now] миллисекунды
 */
export function createBallRenderer({ scene, isLoaded, now = () => performance.now() }) {
  /** @type {Map<string, object>} */
  const balls = new Map();
  let pitch = null;
  let lastTick = -1;
  const axis = new THREE.Vector3();
  const spin = new THREE.Quaternion();

  function ensure(id) {
    let ball = balls.get(id);
    if (!ball) {
      ball = { id, auth: null, shown: null, mesh: null, at: 0, version: 0 };
      balls.set(id, ball);
    }
    return ball;
  }

  function show(ball) {
    if (ball.mesh) return;
    ball.mesh = createBallMesh();
    ball.mesh.position.set(ball.shown.x, ball.shown.y, ball.shown.z);
    scene.add(ball.mesh);
  }

  function hide(ball) {
    if (!ball.mesh) return;
    scene.remove(ball.mesh);
    ball.mesh = null;
  }

  return {
    get size() {
      return balls.size;
    },
    /** Снимок ball_snapshot: устаревшие (по tick) пропускаются. */
    snapshot({ tick, list }) {
      if (tick < lastTick - 2) return false; // снимок опоздал: уже применён более новый
      lastTick = Math.max(lastTick, tick);
      const t = now();
      for (const [id, x, y, z, vx, vy, vz, flags] of list) {
        const ball = ensure(id);
        ball.auth = { x, y, z, vx, vy, vz, rest: (flags & 1) === 1 };
        ball.at = t;
        if (!ball.shown || flags & 2) ball.shown = { x, y, z };
      }
      return true;
    },
    /** Новое соединение: серверный счётчик тиков начинается заново. */
    resetClock() {
      lastTick = -1;
    },
    /** ball_event: reset — мяч сразу на старте; kick обрабатывает вызывающий (анимация игрока). */
    event(ev) {
      const ball = balls.get(ev.id);
      if (!ball) return;
      if (ev.kind === 'reset') ball.shown = { x: ev.x, y: ev.y, z: ev.z };
    },
    /** Показываемые позиции мячей в загруженных чанках (цель клавиши E). */
    positions() {
      const out = [];
      for (const ball of balls.values()) if (ball.mesh && ball.shown) out.push({ id: ball.id, x: ball.shown.x, y: ball.shown.y, z: ball.shown.z });
      return out;
    },
    get(id) {
      return balls.get(id) ?? null;
    },
    update(dt) {
      const t = now();
      // Поле с разметкой и воротами живёт, пока загружен чанк в его центре.
      const fieldLoaded = isLoaded(FIELD.x, FIELD.z);
      if (fieldLoaded && !pitch) {
        pitch = createPitch();
        scene.add(pitch);
      } else if (!fieldLoaded && pitch) {
        scene.remove(pitch);
        pitch = null;
      }
      const k = 1 - Math.exp(-FOLLOW_RATE * Math.min(dt, 0.1));
      for (const ball of balls.values()) {
        if (!ball.auth) continue;
        const target = extrapolateBall(ball.auth, (t - ball.at) / 1000);
        const shown = ball.shown;
        const prevX = shown.x;
        const prevZ = shown.z;
        const gap = Math.hypot(target.x - shown.x, target.z - shown.z);
        if (gap > SNAP_DISTANCE) {
          shown.x = target.x;
          shown.y = target.y;
          shown.z = target.z;
        } else {
          shown.x += (target.x - shown.x) * k;
          shown.y += (target.y - shown.y) * k;
          shown.z += (target.z - shown.z) * k;
        }
        shown.y = Math.max(R, shown.y);
        if (isLoaded(shown.x, shown.z)) show(ball);
        else hide(ball);
        if (!ball.mesh) continue;
        ball.mesh.position.set(shown.x, shown.y, shown.z);
        const dx = shown.x - prevX;
        const dz = shown.z - prevZ;
        const d = Math.hypot(dx, dz);
        if (d > 1e-5 && d < 2) {
          // Качение без проскальзывания: ось ⟂ перемещению, угол = путь / радиус.
          axis.set(dz, 0, -dx).normalize();
          spin.setFromAxisAngle(axis, d / R);
          ball.mesh.quaternion.premultiply(spin);
        }
      }
    },
    dispose() {
      for (const ball of balls.values()) hide(ball);
      balls.clear();
      if (pitch) scene.remove(pitch);
      pitch = null;
    },
  };
}

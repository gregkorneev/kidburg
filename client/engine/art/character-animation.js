// Процедурная анимация персонажа без скелета: походка с коленями и стопами, бег, повороты, дыхание и перенос веса,
// жесты, речь и эмоции. Всё считается локально по тем же входным данным (speed 0/1/2, talking, lookYaw),
// поэтому новые поля протокола не нужны: удалённые игроки анимируются по реальному смещению, как раньше.
import { ANKLE_Y, ARM_LENGTH, SHIN_LEN, THIGH_LEN } from './character-geometry.js';
import { EXPRESSIONS, setFaceTarget, updateFace } from './character-face.js';

export const GESTURES = Object.freeze(['wave', 'nod', 'point', 'approve', 'think', 'surprise', 'lift']);
const GESTURE_SPEC = {
  wave: { len: 2.4, expr: 'happy' },
  nod: { len: 0.9, expr: null },
  point: { len: 1.8, expr: 'focused' },
  approve: { len: 1.7, expr: 'happy' },
  think: { len: 2.6, expr: 'thinking' },
  surprise: { len: 1.4, expr: 'surprised' },
  lift: { len: 1.9, expr: 'focused' },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const wrapAngle = (a) => ((((a) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
const approach = (value, target, rate, dt) => value + (target - value) * Math.min(1, dt * rate);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** Детерминированный генератор для таймингов (моргание, взгляды): состояние хранится в anim.rng. */
function rand(a) {
  let x = a.rng | 0 || 1;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  a.rng = x;
  return (x >>> 0) / 4294967296;
}

/** Начальное состояние анимации; seed делает походку, дыхание и моргание чуть разными у разных людей. */
export function createAnimState(seed = 0) {
  const s = Math.abs(Math.trunc(seed)) + 1;
  const h = (n) => ((((s * 2654435761) ^ (n * 40503)) >>> 0) % 1000) / 1000;
  return {
    gait: 0, phase: h(1) * 6.28, blinkAt: 1.5 + h(2) * 3, blink: 0, blinkT: 0,
    wave: 0, talk: 0, look: 0, nod: 0, gesture: null, gestureT: 0,
    seed: h(3) * 10, rng: (s * 7919) | 0 || 1, turn: 0, prevYaw: null,
    gw: { wave: 0, point: 0, approve: 0, think: 0, surprise: 0, lift: 0, carry: 0 },
    quirk: { breath: 1.7 + h(4) * 0.7, stride: 0.94 + h(5) * 0.14, fidget: 0.6 + h(6) * 0.8, sway: 0.7 + h(7) * 0.6 },
    glanceAt: 2 + h(8) * 4, glanceYaw: 0, glancePitch: 0, glance: 0,
    talkGate: 1, glanceHold: 0, glanceBlend: 0, expr: 'neutral', exprIntensity: 1, exprUntil: 0, exprApplied: '', clock: 0,
    gazeX: 0, gazeY: 0, carry: false, lean: 0, shake: 0,
  };
}

/** Короткий жест: 'wave', 'nod', 'point', 'approve', 'think', 'surprise', 'lift'. Неизвестный жест игнорируется. */
export function triggerGesture(person, kind) {
  if (!GESTURE_SPEC[kind]) return false;
  const anim = person.userData.anim;
  anim.gesture = kind;
  anim.gestureT = 0;
  return true;
}

/** Эмоция лица: name из EXPRESSIONS; duration>0 — через столько секунд вернётся к нейтральному. */
export function setExpression(person, name, { intensity = 1, duration = 0 } = {}) {
  if (!EXPRESSIONS.includes(name)) return false;
  const a = person.userData.anim;
  a.expr = name;
  a.exprIntensity = clamp(intensity, 0, 1);
  a.exprUntil = duration > 0 ? a.clock + duration : 0;
  return true;
}

export const getExpression = (person) => person.userData.anim.expr;

/** Поза «несу в руках»: обе руки впереди; не трогает armsLocked-механику рукава. */
export function setCarry(person, value) {
  person.userData.anim.carry = Boolean(value);
}

/** Рука тянется к точке на расстоянии `length` от плеча (хват рукава); возвращает всё к покою при length = ARM_LENGTH. */
export function setArmReach(arm, length) {
  const up = length / 2;
  arm.reach = length;
  const cover = arm.cover;
  const r = 0.14 * arm.girth;
  arm.sleeve.scale.set(r, up * cover * 1.02 + 0.0001, r);
  arm.sleeve.position.y = -up * cover * 0.5;
  arm.bare.visible = cover < 1;
  if (cover < 1) {
    arm.bare.scale.set(0.115 * arm.girth, up * (1 - cover) + 0.03, 0.115 * arm.girth);
    arm.bare.position.y = -up * (1 + cover) * 0.5 + 0.015;
  }
  arm.elbow.position.y = -up;
  arm.elbow.rotation.set(0, 0, 0);
  arm.forearm.scale.set(0.12 * arm.girth, up * 1.04, 0.12 * arm.girth);
  arm.forearm.position.y = -up * 0.5;
  arm.elbowBall.scale.setScalar(0.105 * arm.girth);
  arm.cuff.position.y = -up * 0.9;
  arm.bareHand.position.y = -up * 1.0;
  if (arm.hand) arm.hand.position.y = -up * 1.0;
  if (arm.stripe) arm.stripe.position.y = -up * 0.55;
  if (arm.item) arm.item.position.y = -up - 0.04;
}

export function resetArms(person) {
  person.userData.armsLocked = false;
  person.userData.arms.forEach((arm) => {
    arm.shoulder.rotation.set(0, 0, 0);
    setArmReach(arm, ARM_LENGTH);
  });
}

/** Угол от направления взгляда корпуса person к точке (x, z) в мире. */
export function yawToward(person, x, z) {
  return wrapAngle(Math.atan2(x - person.position.x, z - person.position.z) - person.rotation.y);
}

// Предвыделенные рабочие значения: анимация не создаёт объектов в кадре.
const pose = { x: 0, y: 0, z: 0, e: 0 };
const mixPose = (x, y, z, e, w) => {
  if (w < 0.002) return;
  pose.x = lerp(pose.x, x, w); pose.y = lerp(pose.y, y, w); pose.z = lerp(pose.z, z, w); pose.e = lerp(pose.e, e, w);
};

function armTarget(u, a, index, t, swing, walk, run, lookYaw) {
  const side = index ? 1 : -1;
  const idle = 1 - walk;
  const armSwing = -swing * (index ? 1 : -1) * (0.85 + run * 0.25);
  pose.x = armSwing + Math.sin(t * 0.9 * a.quirk.sway + a.seed + index * 2) * 0.035 * idle;
  pose.y = 0;
  pose.z = side * (0.065 + Math.sin(t * 1.4 + index) * 0.02 + walk * 0.05 + run * 0.1);
  pose.e = -(0.16 + 0.16 * walk + 0.5 * run + Math.max(0, -armSwing) * (0.4 + run * 0.15)) - Math.sin(t * 1.1 + index) * 0.03 * idle;

  const w = a.gw;
  const talkGate = a.talkGate * a.talk;
  if (u.holding === 'clipboard' && index === 0) {
    // Планшет у груди: рука согнута, во время речи чуть покачивается.
    mixPose(-0.55 + Math.sin(t * 1.2) * 0.03 - talkGate * 0.06, 0.1, -0.2, -1.25 + Math.sin(t * 1.5) * 0.04, 1);
  } else if (index === 1 || !u.holding) {
    const main = index === 1;
    const k = main ? 1 : 0.55;
    mixPose(-0.45 + Math.sin(t * 2.3) * 0.22, 0, side * (0.38 + Math.sin(t * 3.1) * 0.16), -(0.95 + Math.sin(t * 2.7) * 0.4), talkGate * k * (1 - w.wave) * (main ? 1 : 0.7));
  }
  mixPose(-0.75, 0, -side * 0.22, -0.35 - Math.sin(t * 1.5) * 0.02, w.carry);
  mixPose(-0.95, 0, -side * 0.3, -1.0, w.lift * (0.5 + 0.5 * Math.sin(Math.min(1, a.gestureT / 1.9) * Math.PI)));
  if (index === 1) {
    mixPose(-0.1, 0, 2.35 + Math.sin(t * 9) * 0.25, -0.45 + Math.sin(t * 9 + 1) * 0.35, w.wave);
    mixPose(-1.5, clamp(lookYaw, -0.6, 0.6) * 0.5, 0.15, -0.12, w.point);
    mixPose(-0.95, 0, 0.18, -1.5 + Math.sin(t * 11) * 0.1, w.approve);
    mixPose(-0.7, 0, -0.15, -2.15 + Math.sin(t * 1.5) * 0.04, w.think);
  }
  mixPose(-0.25, 0, side * 0.58, -0.45, w.surprise);
}

/**
 * Процедурная анимация одного кадра.
 * @param {object} state speed 0/1/2 (стоит/идёт/бежит, как поле anim в протоколе), talking, lookYaw (рад., относительно корпуса),
 *   turn (рад/с, угловая скорость корпуса; если не задана — берётся из изменения person.rotation.y)
 */
export function animateCharacter(person, dt, t, { speed = 0, talking = false, lookYaw = 0, turn = NaN } = {}) {
  const u = person.userData;
  const a = u.anim;
  const detail = u.detail;
  // Состояние накапливается между кадрами, поэтому одно нечисловое значение (первый кадр без timestamp) нельзя пускать внутрь.
  dt = dt > 0 ? Math.min(dt, 0.25) : 0;
  if (!Number.isFinite(t)) t = a.clock;
  if (!Number.isFinite(speed)) speed = 0;
  if (!Number.isFinite(lookYaw)) lookYaw = 0;
  a.clock += dt;
  a.gait = approach(a.gait, speed, 10, dt);
  a.phase += dt * (8.5 + Math.max(0, a.gait - 1) * 4) * a.quirk.stride;
  const walk = Math.min(a.gait, 1);
  const run = clamp(a.gait - 1, 0, 1);
  const idle = 1 - walk;
  const phase = a.phase;

  // Угловая скорость: из явного значения (удалённые игроки) или из изменения поворота модели.
  let rate = turn;
  if (!Number.isFinite(rate)) rate = dt > 0 && a.prevYaw !== null ? wrapAngle(person.rotation.y - a.prevYaw) / dt : 0;
  a.prevYaw = person.rotation.y;
  a.turn = approach(a.turn, clamp(rate, -7, 7), 8, dt);

  // Жесты и таймеры.
  if (a.gesture) {
    a.gestureT += dt;
    if (a.gestureT >= GESTURE_SPEC[a.gesture].len) a.gesture = null;
  }
  const g = a.gesture;
  const gp = g ? clamp(a.gestureT / GESTURE_SPEC[g].len, 0, 1) : 0;
  const w = a.gw;
  for (const key of GESTURES) if (key in w) w[key] = approach(w[key], g === key ? 1 : 0, 8, dt);
  w.carry = approach(w.carry, a.carry ? 1 : 0, 7, dt);
  a.wave = w.wave;
  a.talk = approach(a.talk, talking ? 1 : 0, 6, dt);
  const phrase = smoothstep(0.1, 0.45, 0.5 + 0.5 * Math.sin(t * 1.3 + a.seed));
  a.talkGate = lerp(1, phrase, 0.85);
  const beat = Math.sin(t * 2.6 + a.seed) * a.talkGate * a.talk;
  const syllable = Math.abs(Math.sin(t * 9.5 + Math.sin(t * 2.3) * 2)) ** 0.8 * (0.55 + 0.45 * Math.sin(t * 5.3 + a.seed));
  const talkOpen = a.talk * a.talkGate * (0.12 + syllable * 0.7);

  // Ноги: бедро, колено, стопа; опорная нога удерживает контакт с землёй.
  const hipAmp = 0.5 * walk + 0.42 * run;
  const kneeAmp = 0.7 * walk + 0.95 * run;
  const shiftWeight = Math.sin(t * 0.42 * a.quirk.sway + a.seed);
  const swing = Math.sin(phase) * (0.62 * walk + 0.45 * run);
  let lowest = Infinity;
  for (let i = 0; i < 2; i++) {
    const leg = u.legs[i];
    const phi = phase + (i ? 0 : Math.PI);
    const s = Math.sin(phi);
    const c = Math.cos(phi);
    const hip = hipAmp * s;
    const flex = kneeAmp * Math.max(0, -c) ** 1.15 + 0.1 * walk + (i ? Math.max(0, shiftWeight) : Math.max(0, -shiftWeight)) * 0.07 * idle;
    leg.pivot.rotation.x = hip;
    leg.knee.rotation.x = flex;
    const toeOff = 0.55 * Math.max(0, s) ** 2 * walk;
    const heel = 0.2 * Math.max(0, -s) * walk;
    leg.foot.rotation.x = -(hip + flex) * 0.92 + toeOff - heel;
    const h = THIGH_LEN * (1 - Math.cos(hip)) + SHIN_LEN * (1 - Math.cos(hip + flex));
    if (h < lowest) lowest = h;
  }
  const lift = run * 0.075 * Math.abs(Math.sin(phase));
  u.body.position.y = -lowest + lift;
  u.body.position.x = shiftWeight * 0.014 * idle * a.quirk.sway;

  // Корпус: наклон вперёд на ходу и бегу, крен в поворот, перекрутка плеч против бёдер.
  const accel = (speed - a.gait) * 0.02;
  const lean = 0.05 * walk + 0.13 * run + clamp(accel, -0.05, 0.05);
  const bend = g === 'lift' ? Math.sin(gp * Math.PI) ** 1.5 * 0.5 : 0;
  const pitchBack = g === 'surprise' ? -Math.sin(Math.min(1, gp * 3) * Math.PI) * 0.1 * (1 - gp) : 0;
  const moving = walk + run * 0.3;
  u.lean.rotation.set(lean + bend + pitchBack, 0, clamp(-a.turn * 0.04, -0.15, 0.15) * moving - shiftWeight * 0.02 * idle * a.quirk.sway);
  const look = a.look = approach(a.look, clamp(lookYaw, -0.95, 0.95), 7, dt);
  u.spine.rotation.set(0, Math.sin(phase) * 0.1 * walk * (1 + run * 0.6) + clamp(a.turn * 0.025, -0.14, 0.14) + look * 0.18, 0);
  const breath = Math.sin(t * a.quirk.breath + a.seed) * 0.012 * (0.4 + idle * 0.6);
  u.torso.scale.set(u.torsoBase.x, 1 + breath, u.torsoBase.z);

  // Глаза, эмоции, моргание.
  if (a.exprUntil && a.clock > a.exprUntil) { a.expr = 'neutral'; a.exprUntil = 0; }
  const implied = g && GESTURE_SPEC[g].expr;
  const wanted = a.expr !== 'neutral' ? a.expr : implied || 'neutral';
  const intensity = a.expr !== 'neutral' ? a.exprIntensity : implied ? 0.85 : 1;
  const key = `${wanted}:${intensity}`;
  if (key !== a.exprApplied) { a.exprApplied = key; setFaceTarget(u.face, wanted, intensity); }

  a.blinkAt -= dt;
  if (a.blinkAt < 0) {
    a.blinkT = 0.17;
    a.blinkAt = (a.exprUntil || wanted === 'focused' ? 3.5 : 2.2 + rand(a) * 3.8) * a.quirk.fidget + (rand(a) < 0.2 ? -1.6 : 0);
    a.blinkAt = Math.max(0.35, a.blinkAt);
  }
  a.blinkT = Math.max(0, a.blinkT - dt);
  const blink = a.blinkT > 0 ? Math.sin(Math.PI * (1 - a.blinkT / 0.17)) : 0;

  // Редкие взгляды по сторонам в покое (не при разговоре с игроком).
  if (detail > 0 && idle > 0.5) {
    a.glanceAt -= dt;
    if (a.glanceAt < 0) {
      a.glance = 1;
      a.glanceYaw = (rand(a) - 0.5) * 0.7;
      a.glancePitch = (rand(a) - 0.5) * 0.18;
      a.glanceAt = 3.5 + rand(a) * 6 / a.quirk.fidget;
      a.glanceHold = 0.9 + rand(a) * 1.1;
    } else if (a.glance && (a.glanceHold -= dt) < 0) a.glance = 0;
  } else a.glance = 0;
  const glance = approach(a.glanceBlend, a.glance && !a.talk && Math.abs(look) < 0.1 ? 1 : 0, 3.5, dt);
  a.glanceBlend = glance;

  const eyeX = a.glanceYaw * glance * 0.8 + clamp(lookYaw - look, -0.4, 0.4);
  const eyeY = a.glancePitch * glance;
  const facePose = updateFace(u.face, dt, { blink, talkBeat: beat, talkOpen, gazeX: eyeX, gazeY: eyeY });

  // Голова: ведёт поворот, добавляет кивки, наклон от эмоции и речь.
  const nodAmount = g === 'nod' ? Math.sin(gp * Math.PI) * 0.28 : 0;
  const approveNod = w.approve * Math.abs(Math.sin(a.gestureT * 6)) * 0.16;
  const thinkTilt = w.think * 0.1;
  const pitch = nodAmount + approveNod + facePose.headPitch + beat * 0.05 - (lean + bend) * 0.55 + a.glancePitch * glance * 0.5 + w.think * 0.05 + Math.sin(t * 1.1 + a.seed) * 0.015;
  const yaw = look * 0.72 + a.glanceYaw * glance * 0.35 + Math.sin(t * 0.7 * a.quirk.sway + a.seed) * 0.05 * idle + clamp(a.turn * 0.06, -0.3, 0.3) * moving + a.talk * Math.sin(t * 1.7) * 0.05 * a.talkGate - u.spine.rotation.y * 0.4;
  u.head.rotation.set(pitch, yaw, facePose.headTilt + thinkTilt + Math.sin(t * 0.9 + a.seed) * 0.02 - u.lean.rotation.z * 0.5);

  if (u.tail) u.tail.rotation.set(Math.sin(phase + 1) * 0.35 * walk + Math.sin(t * 1.6) * 0.04 + run * 0.2, 0, Math.sin(t * 1.3) * 0.05 + swing * 0.1 - a.turn * 0.02);
  if (detail > 1 && u.hairBack) u.hairBack.rotation.x = Math.sin(phase * 2 + 0.6) * 0.03 * walk * (1 + run) - lean * 0.2;

  if (u.armsLocked) return;
  for (let i = 0; i < 2; i++) {
    const arm = u.arms[i];
    armTarget(u, a, i, t, swing, walk, run, lookYaw);
    arm.shoulder.rotation.set(pose.x, pose.y, pose.z);
    arm.elbow.rotation.x = pose.e;
  }
}

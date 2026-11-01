// Единая система ветра. Один контроллер (направление, средняя сила, порывы) пишет общие uniforms, а вершинный
// шейдер каждого материала растения превращает их в смещение: чем выше вершина над землёй, тем сильнее изгиб.
// Все локации (город, площадь, пожарная часть, цветочная лавка) берут тот же контроллер, поэтому ветер везде дует
// в одну сторону и порывы приходят волной через весь мир. Фаза растения зависит только от его положения в мире.
//
// Смещение считается в мировых осях и переводится в локальные оси экземпляра, поэтому повёрнутые деревья и кусты
// наклоняются по ветру, а не каждое в свою сторону. Нижняя часть растения (h = 0) остаётся на месте.
import * as THREE from 'three';

/** Режимы для проверки и настройки: штиль, лёгкий (по умолчанию), умеренный, сильные порывы. */
export const WIND_PRESETS = Object.freeze({
  calm: Object.freeze({ strength: 0, gustiness: 0 }),
  light: Object.freeze({ strength: 0.35, gustiness: 0.25 }),
  moderate: Object.freeze({ strength: 0.7, gustiness: 0.45 }),
  gusty: Object.freeze({ strength: 1, gustiness: 0.9 }),
});
export const WIND_PRESET_IDS = Object.freeze(Object.keys(WIND_PRESETS));

/** Качество ветра: low — только основной изгиб, medium — плюс вторичные колебания, high — плюс трепет листвы. */
export const WIND_DETAIL = Object.freeze({ low: 0, medium: 0.5, high: 1 });

const DEFAULTS = Object.freeze({ strength: WIND_PRESETS.light.strength, gustiness: WIND_PRESETS.light.gustiness, direction: 0.9, quality: 'medium' });

/**
 * Профили растений (художественные параметры):
 *  H — высота, на которой изгиб максимален (м в локальных осях); amp — отклонение верхушки в долях H при единичной силе;
 *  exp — «жёсткость основания» (больше — ниже часть остаётся неподвижной); freq — частота качания; lag — запаздывание
 *  верхних частей (рад/с на единицу высоты); flutter — мелкий трепет (только medium/high); radial — доп. подвижность
 *  тонких веток вдали от оси; contour — деформация контура куста; tilt — наклон головки цветка.
 */
export const WIND_PROFILES = Object.freeze({
  grass: Object.freeze({ H: 0.7, amp: 0.5, exp: 1.8, freq: 2.4, lag: 0, flutter: 0.03, radial: 0, contour: 0, tilt: 0 }),
  flower: Object.freeze({ H: 0.5, amp: 0.42, exp: 1.7, freq: 2.0, lag: 0.3, flutter: 0.015, radial: 0, contour: 0, tilt: 0.12 }),
  'flower-held': Object.freeze({ H: 0.5, amp: 0.1, exp: 1.9, freq: 2.0, lag: 0.2, flutter: 0.004, radial: 0, contour: 0, tilt: 0.04 }),
  bush: Object.freeze({ H: 1.2, amp: 0.12, exp: 1.5, freq: 1.5, lag: 0.3, flutter: 0.02, radial: 0, contour: 0.035, tilt: 0 }),
  'tree-round': Object.freeze({ H: 5.5, amp: 0.07, exp: 2.2, freq: 1.0, lag: 0.35, flutter: 0.05, radial: 0.8, contour: 0, tilt: 0 }),
  'tree-pine': Object.freeze({ H: 6, amp: 0.045, exp: 2.6, freq: 0.8, lag: 0.25, flutter: 0.025, radial: 0.5, contour: 0, tilt: 0 }),
  'tree-birch': Object.freeze({ H: 5, amp: 0.09, exp: 1.9, freq: 1.25, lag: 0.45, flutter: 0.055, radial: 1.0, contour: 0, tilt: 0 }),
});

/** Профиль дерева по названию формы из art/flora.js. */
export const treeProfile = (variant) => (variant === 'pine' ? 'tree-pine' : variant === 'birch' ? 'tree-birch' : 'tree-round');

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const fract = (v) => v - Math.floor(v);

/** Индивидуальная фаза растения (0..2π) по мировым координатам; то же число считает шейдер. */
export function windPhase(x, z) {
  return fract(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) * Math.PI * 2;
}

function normalizeAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * Контроллер ветра. Значения setStrength/setDirection/setGustiness — цели: текущие значения плавно догоняют их,
 * поэтому смена режима не даёт рывка. Поверх целей идёт медленное естественное «блуждание» силы и направления.
 */
export function createWindController(initial = {}) {
  const config = { ...DEFAULTS, ...initial };
  const target = { strength: clamp(config.strength, 0, 1.5), gustiness: clamp(config.gustiness, 0, 1), direction: normalizeAngle(config.direction) };
  const current = { ...target };
  const uniforms = {
    uWindTime: { value: 0 },
    uWindDir: { value: new THREE.Vector2(Math.cos(target.direction), Math.sin(target.direction)) },
    uWindStrength: { value: target.strength },
    uWindGust: { value: target.gustiness },
    uWindDetail: { value: WIND_DETAIL[config.quality] ?? WIND_DETAIL.medium },
  };
  let quality = WIND_DETAIL[config.quality] === undefined ? 'medium' : config.quality;
  let preset = null;
  let lastElapsed = null;

  const api = {
    uniforms,
    /** Один вызов за кадр с общим временем сцены (секунды). Повторный вызов с тем же временем безвреден. */
    update(elapsed) {
      if (!Number.isFinite(elapsed)) return;
      const first = lastElapsed === null;
      const dt = first ? 0 : clamp(elapsed - lastElapsed, 0, 0.25);
      lastElapsed = elapsed;
      const kStrength = first ? 1 : 1 - Math.exp(-dt * 1.4);
      const kDirection = first ? 1 : 1 - Math.exp(-dt * 0.8);
      current.strength += (target.strength - current.strength) * kStrength;
      current.gustiness += (target.gustiness - current.gustiness) * kStrength;
      current.direction += normalizeAngle(target.direction - current.direction) * kDirection;
      // Естественное блуждание: сила дышит на ±20%, направление уходит на десятые доли радиана.
      const breathe = 1 + 0.14 * Math.sin(elapsed * 0.13) + 0.08 * Math.sin(elapsed * 0.047 + 2);
      const wander = 0.2 * Math.sin(elapsed * 0.037) + 0.1 * Math.sin(elapsed * 0.11 + 1);
      const angle = current.direction + wander * (0.4 + current.strength);
      uniforms.uWindTime.value = elapsed;
      uniforms.uWindStrength.value = current.strength * breathe;
      uniforms.uWindGust.value = current.gustiness;
      uniforms.uWindDir.value.set(Math.cos(angle), Math.sin(angle));
    },
    setStrength(value) { target.strength = clamp(Number(value) || 0, 0, 1.5); preset = null; },
    /** Направление ветра в радианах: куда дует (0 — вдоль +X, π/2 — вдоль +Z). */
    setDirection(radians) { if (Number.isFinite(radians)) target.direction = normalizeAngle(radians); },
    setGustiness(value) { target.gustiness = clamp(Number(value) || 0, 0, 1); preset = null; },
    setPreset(name) {
      const p = WIND_PRESETS[name];
      if (!p) return false;
      target.strength = p.strength;
      target.gustiness = p.gustiness;
      preset = name;
      return true;
    },
    setQuality(level) {
      if (WIND_DETAIL[level] === undefined) return quality;
      quality = level;
      uniforms.uWindDetail.value = WIND_DETAIL[level];
      return quality;
    },
    /** Мгновенно применяет цели (для тестов и первого кадра после смены режима администратором). */
    snap() {
      Object.assign(current, target);
      lastElapsed = null;
    },
    getState: () => ({ strength: target.strength, gustiness: target.gustiness, direction: target.direction, preset, quality }),
  };
  api.update(0);
  return api;
}

/** Общий контроллер страницы: все материалы растений читают его uniforms. */
export const wind = createWindController();

export function updateWind(elapsed) {
  wind.update(elapsed);
}

export function setWindQuality(level) {
  return wind.setQuality(level);
}

// ── Шейдер ──────────────────────────────────────────────────────────────────

const f = (v) => Number(v).toFixed(4);

function shaderFunction(p) {
  return `
uniform float uWindTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uWindGust;
uniform float uWindDetail;
float windPhaseOf(vec2 anchor) {
  return fract(sin(dot(anchor, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
}
// Мировое горизонтальное смещение изгиба стебля, ствола или кроны (метры, в осях мира).
vec2 windBend(vec3 p, vec2 anchor) {
  float h01 = clamp(p.y / ${f(p.H)}, 0.0, 1.6);
  float rad = length(p.xz);
  float bend = pow(h01, ${f(p.exp)}) * (1.0 + ${f(p.radial)} * smoothstep(0.1, 1.5, rad));
  float phase = windPhaseOf(anchor);
  float along = dot(anchor, uWindDir);
  float tt = uWindTime - h01 * ${f(p.lag)};
  float fq = ${f(p.freq)};
  float slow = sin(tt * fq + along * 0.11 + phase * 0.6);
  float mid = sin(tt * fq * 2.3 + along * 0.23 + phase) * 0.35 * smoothstep(0.2, 0.6, uWindDetail);
  float osc = slow + mid;
  float front = sin(along * 0.045 - uWindTime * 0.9) * 0.6 + sin(along * 0.019 - uWindTime * 0.41 + 1.3) * 0.4;
  float gust = smoothstep(0.1, 0.95, front) * uWindGust;
  float push = uWindStrength * (0.65 + 0.35 * osc) + gust * (0.9 + 0.25 * osc);
  float side = sin(tt * fq * 0.8 + phase * 1.7) * (0.25 * uWindStrength + 0.3 * gust);
  vec2 perp = vec2(-uWindDir.y, uWindDir.x);
  vec2 world = (uWindDir * push + perp * side) * ${f(p.amp * p.H)} * bend;
  float activity = uWindStrength + gust;
  world += uWindDir * ${f(p.tilt)} * smoothstep(0.75, 1.0, h01) * sin(tt * fq * 1.4 + phase) * activity;
  return world;
}
// Мелкий трепет листвы и деформация контура куста (локальные оси экземпляра, метры).
vec3 windJitter(vec3 p, vec2 anchor) {
  float h01 = clamp(p.y / ${f(p.H)}, 0.0, 1.6);
  float rad = length(p.xz);
  float bend = pow(h01, ${f(p.exp)}) * (1.0 + ${f(p.radial)} * smoothstep(0.1, 1.5, rad));
  float phase = windPhaseOf(anchor);
  float along = dot(anchor, uWindDir);
  float front = sin(along * 0.045 - uWindTime * 0.9) * 0.6 + sin(along * 0.019 - uWindTime * 0.41 + 1.3) * 0.4;
  float activity = uWindStrength + smoothstep(0.1, 0.95, front) * uWindGust;
  float fq = ${f(p.freq)};
  float flutter = sin(uWindTime * fq * 5.0 + p.x * 7.1 + p.z * 5.3 + p.y * 3.7 + phase) * ${f(p.flutter)} * bend * activity * smoothstep(0.7, 1.0, uWindDetail);
  vec2 outward = rad > 0.001 ? p.xz / rad : vec2(0.0);
  float contour = sin(p.x * 4.1 + uWindTime * 1.9 + phase) * sin(p.z * 3.7 + uWindTime * 1.4) * ${f(p.contour)} * h01 * activity * smoothstep(0.2, 0.6, uWindDetail);
  return vec3(flutter * 0.8 + outward.x * contour, flutter * 0.5, -flutter + outward.y * contour);
}`;
}

function vertexChunk() {
  return `
#ifdef USE_INSTANCING
  vec4 wAnchor = modelMatrix * vec4(instanceMatrix[3].xyz, 1.0);
  mat3 wM = mat3(modelMatrix) * mat3(instanceMatrix);
#else
  vec4 wAnchor = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mat3 wM = mat3(modelMatrix);
#endif
  float wScale = max(length(wM[0]), 0.0001);
  mat3 wR = wM / wScale;
  vec2 wBend = windBend(position, wAnchor.xz);
  vec3 wLocal = transpose(wR) * vec3(wBend.x, 0.0, wBend.y) + windJitter(position, wAnchor.xz);
  wLocal.y -= min(0.5 * dot(wLocal.xz, wLocal.xz) / max(position.y, 0.3), 0.12 * position.y);
  transformed += wLocal;`;
}

const materials = new Map();
const depthMaterials = new Map();
const distanceMaterials = new Map();

function profileFor(key) {
  if (typeof key === 'string') {
    const p = WIND_PROFILES[key];
    if (!p) throw new RangeError(`Неизвестный профиль ветра: ${key}`);
    return { id: key, ...p };
  }
  return key;
}

/**
 * MeshStandardMaterial с вершинными цветами и ветром профиля `profile` (имя из WIND_PROFILES).
 * Материалы общие для страницы (userData.shared): их не освобождают владельцы экземпляров.
 */
export function windMaterial(profile, { roughness = 0.88, side = THREE.FrontSide } = {}) {
  const p = profileFor(profile);
  const key = `${p.id}|${roughness}|${side}`;
  let material = materials.get(key);
  if (material) return material;
  material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0, side });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, wind.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${shaderFunction(p)}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertexChunk()}`);
  };
  material.customProgramCacheKey = () => `wind-${p.id}`;
  material.userData.shared = true;
  material.userData.windProfile = p.id;
  materials.set(key, material);
  return material;
}

function windShadowMaterial(profile, distance = false, side = THREE.FrontSide) {
  const p = profileFor(profile);
  const cache = distance ? distanceMaterials : depthMaterials;
  const key = `${p.id}|${side}`;
  if (cache.has(key)) return cache.get(key);
  const material = distance
    ? new THREE.MeshDistanceMaterial({ side })
    : new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, wind.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${shaderFunction(p)}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertexChunk()}`);
  };
  material.customProgramCacheKey = () => `wind-shadow-${distance ? 'distance' : 'depth'}-${p.id}-${side}`;
  material.userData.shared = true;
  material.userData.windProfile = p.id;
  cache.set(key, material);
  return material;
}

/** Добавляет такую же деформацию в карты теней, что и в основной материал. */
export function applyWindShadows(mesh) {
  const profile = mesh?.material?.userData?.windProfile;
  if (!profile) return mesh;
  mesh.customDepthMaterial = windShadowMaterial(profile, false, mesh.material.side);
  mesh.customDistanceMaterial = windShadowMaterial(profile, true, mesh.material.side);
  return mesh;
}

/** Совместимость: числовая сила — прежний линейный изгиб; строка — профиль. Новый код зовёт windMaterial(). */
export function swayMaterial(strength = 0.05, options = {}) {
  if (typeof strength === 'string') return windMaterial(strength, options);
  const id = `legacy-${strength}`;
  const profile = { id, H: 1, amp: strength, exp: 1, freq: 1.5, lag: 0, flutter: 0, radial: 0, contour: 0, tilt: 0 };
  return windMaterial(profile, options);
}

/**
 * Геометрия растения с запасом в ограничивающей сфере и коробке: вершины уходят от исходных границ на
 * величину изгиба, и без запаса дальние экземпляры исчезали бы на краю кадра раньше времени.
 */
export function padWindBounds(geometry, profile) {
  const p = profileFor(profile);
  const margin = p.amp * p.H * 2.2 + p.flutter * 2 + p.contour * 2 + 0.1;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.boundingBox.expandByScalar(margin);
  geometry.boundingSphere.radius += margin;
  geometry.userData.windPadded = margin;
  return geometry;
}

export function disposeWind() {
  for (const m of materials.values()) m.dispose();
  for (const m of depthMaterials.values()) m.dispose();
  for (const m of distanceMaterials.values()) m.dispose();
  materials.clear();
  depthMaterials.clear();
  distanceMaterials.clear();
}

// ── Эталон на CPU ───────────────────────────────────────────────────────────

/**
 * То же вычисление на CPU для единичного масштаба и поворота экземпляра вокруг Y.
 * x/z — мировая опора растения, y и point — локальная позиция вершины; rotation — поворот экземпляра в радианах.
 * Возвращает мировое смещение, включая наклон, трепет, контур и вертикальную компенсацию изгиба.
 * @param {{strength: number, gustiness: number, dirX: number, dirZ: number, time: number, detail?: number}} state
 */
export function windDisplacement(profile, x, z, y, state, point = {}, rotation = 0) {
  const p = profileFor(profile);
  const h01 = clamp(y / p.H, 0, 1.6);
  const radius = Math.hypot(point.x ?? 0, point.z ?? 0);
  const bend = Math.pow(h01, p.exp) * (1 + p.radial * smoothstep(0.1, 1.5, radius));
  const phase = windPhase(x, z);
  const along = x * state.dirX + z * state.dirZ;
  const tt = state.time - h01 * p.lag;
  const detail = state.detail ?? 0.5;
  const slow = Math.sin(tt * p.freq + along * 0.11 + phase * 0.6);
  const mid = Math.sin(tt * p.freq * 2.3 + along * 0.23 + phase) * 0.35 * smoothstep(0.2, 0.6, detail);
  const osc = slow + mid;
  const front = Math.sin(along * 0.045 - state.time * 0.9) * 0.6 + Math.sin(along * 0.019 - state.time * 0.41 + 1.3) * 0.4;
  const gust = smoothstep(0.1, 0.95, front) * state.gustiness;
  const push = state.strength * (0.65 + 0.35 * osc) + gust * (0.9 + 0.25 * osc);
  const side = Math.sin(tt * p.freq * 0.8 + phase * 1.7) * (0.25 * state.strength + 0.3 * gust);
  const amplitude = p.amp * p.H * bend;
  const tilt = p.tilt * smoothstep(0.75, 1, h01) * Math.sin(tt * p.freq * 1.4 + phase) * (state.strength + gust);
  const worldX = state.dirX * (push * amplitude + tilt) - state.dirZ * side * amplitude;
  const worldZ = state.dirZ * (push * amplitude + tilt) + state.dirX * side * amplitude;
  const flutter = Math.sin(state.time * p.freq * 5 + (point.x ?? 0) * 7.1 + (point.z ?? 0) * 5.3 + y * 3.7 + phase)
    * p.flutter * bend * (state.strength + gust) * smoothstep(0.7, 1, detail);
  const outwardX = radius > 0.001 ? (point.x ?? 0) / radius : 0;
  const outwardZ = radius > 0.001 ? (point.z ?? 0) / radius : 0;
  const contour = Math.sin((point.x ?? 0) * 4.1 + state.time * 1.9 + phase)
    * Math.sin((point.z ?? 0) * 3.7 + state.time * 1.4) * p.contour * h01
    * (state.strength + gust) * smoothstep(0.2, 0.6, detail);
  const localX = Math.cos(rotation) * worldX - Math.sin(rotation) * worldZ + flutter * 0.8 + outwardX * contour;
  const localZ = Math.sin(rotation) * worldX + Math.cos(rotation) * worldZ - flutter + outwardZ * contour;
  const sag = Math.min(0.5 * (localX * localX + localZ * localZ) / Math.max(y, 0.3), 0.12 * y);
  return {
    x: Math.cos(rotation) * localX + Math.sin(rotation) * localZ,
    y: flutter * 0.5 - sag,
    z: -Math.sin(rotation) * localX + Math.cos(rotation) * localZ,
  };
}

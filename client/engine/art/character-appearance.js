// Детерминированная внешность персонажа: всё выводится из числа (id игрока / agentId наставника),
// поэтому любой клиент видит одного и того же человека без новых полей протокола. Math.random здесь не используется.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const HAIR_STYLES = Object.freeze([
  'short', 'sidePart', 'bob', 'long', 'curly', 'wavy', 'spiky', 'messy', 'bun', 'updo', 'ponytail', 'lowTail', 'sweep',
]);
/** Хвост ('ponytail') оставлен наставнику; остальные стили выдаются по id. */
export const MENTOR_HAIR_STYLES = Object.freeze(['ponytail']);
export const GENERATED_HAIR_STYLES = Object.freeze(HAIR_STYLES.filter((style) => !MENTOR_HAIR_STYLES.includes(style)));
export const BUILDS = Object.freeze(['standard', 'compact', 'broad']);
export const FACE_SHAPES = Object.freeze(['round', 'oval', 'wide', 'heart']);
export const EYE_SHAPES = Object.freeze(['round', 'wide', 'tall', 'almond']);
export const BROW_STYLES = Object.freeze(['soft', 'arched', 'thick', 'flat']);
export const NOSE_STYLES = Object.freeze(['button', 'round', 'pointy']);
export const MOUTH_STYLES = Object.freeze(['small', 'wide', 'smirk']);
export const TOP_STYLES = Object.freeze(['tee', 'hoodie', 'jacket', 'sweater', 'shirt']);
export const SHOE_STYLES = Object.freeze(['sneaker', 'boot', 'safety']);
export const ACCESSORIES = Object.freeze(['none', 'backpack', 'glasses', 'cap', 'headband', 'bag']);
const CASUAL_SHOES = Object.freeze(['sneaker', 'sneaker', 'boot']);

/** Целочисленный хеш (mulberry-стиль): соседние id дают несвязанные результаты. */
export function hash32(n) {
  let t = (Math.trunc(n) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

const slot = (seed, salt, list) => list[hash32(seed * 977 + salt * 7919) % list.length];
const unit = (seed, salt) => hash32(seed * 1291 + salt * 6007) / 4294967296;

/** Цвет темнее/светлее базового (для швов, манжет и воротников). */
export function shade(color, amount) {
  const c = new THREE.Color(color);
  const target = amount < 0 ? 0x1c2326 : 0xffffff;
  c.lerp(new THREE.Color(target), Math.abs(amount));
  return `#${c.getHexString()}`;
}

/** Внешность по числу. `color` — число-цвет от сервера (поле appearance.color), если есть. */
export function appearanceFromSeed(seed = 0, color = null) {
  const s = Math.abs(Math.trunc(seed)) || 0;
  const outfit = typeof color === 'number' ? `#${new THREE.Color(color).getHexString()}` : slot(s, 4, PALETTE.outfit);
  const accessory = unit(s, 20) < 0.4 ? slot(s, 21, ACCESSORIES.slice(1)) : 'none';
  return {
    seed: s,
    skin: slot(s, 1, PALETTE.skin),
    hair: slot(s, 2, PALETTE.hair),
    hairStyle: slot(s, 3, GENERATED_HAIR_STYLES),
    outfit,
    pants: slot(s, 5, ['#4d6478', '#6b7a5a', '#6a5f78', '#5b6770', '#7a6a58']),
    build: slot(s, 6, BUILDS),
    faceShape: slot(s, 7, FACE_SHAPES),
    eyeShape: slot(s, 8, EYE_SHAPES),
    eyeSize: 0.92 + unit(s, 9) * 0.2,
    eyeColor: slot(s, 10, PALETTE.eye),
    browStyle: slot(s, 11, BROW_STYLES),
    noseStyle: slot(s, 12, NOSE_STYLES),
    mouthStyle: slot(s, 13, MOUTH_STYLES),
    earHeight: unit(s, 14) < 0.5 ? 0 : 1,
    top: slot(s, 15, TOP_STYLES),
    topAccent: slot(s, 16, PALETTE.accent),
    shoes: slot(s, 17, CASUAL_SHOES),
    shoeColor: slot(s, 18, PALETTE.shoe),
    bootColor: slot(s, 19, PALETTE.bootCasual),
    accessory,
    accessoryColor: slot(s, 22, ['#e8725c', '#5f9fb0', '#e2b94f', '#3f8a68', '#8d7bb8']),
  };
}

/** Полная внешность из частичной: недостающие поля берутся из seed 0 (или из `appearance.seed`). */
export function resolveAppearance(partial = {}) {
  const base = appearanceFromSeed(Number.isFinite(partial.seed) ? partial.seed : 0);
  return { ...base, ...partial };
}

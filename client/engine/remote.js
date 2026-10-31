// Другие игроки: персонажи общей системы art/character.js, подписи и интерполяция по буферу снимков `players`.
// Отображаем с задержкой INTERP_DELAY_MS, чтобы почти всегда было два снимка вокруг момента показа.

import * as THREE from 'three';
import { CITY_CHARACTER_SCALE, animateCharacter, appearanceFromSeed, createCharacter, disposeCharacter } from './art/character.js';

const LABEL_HEIGHT = 2.15;
const RUN_SPEED = 6; // м/с: быстрее считаем бегом, как в пожарной части

export const INTERP_DELAY_MS = 100;
const MAX_SNAPSHOTS = 24;

const lerp = (a, b, t) => a + (b - a) * t;
function lerpAngle(a, b, t) {
  const diff = ((((b - a) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI; // кратчайший путь
  return a + diff * t;
}

/**
 * Позиция в момент `time` по снимкам, отсортированным по `t`. Экстраполяции нет:
 * после последнего снимка игрок стоит на месте.
 * @returns {{x: number, y: number, z: number, ry: number, anim: number} | null}
 */
export function sampleSnapshots(snaps, time) {
  if (snaps.length === 0) return null;
  if (time <= snaps[0].t) return { ...snaps[0] };
  const last = snaps[snaps.length - 1];
  if (time >= last.t) return { ...last };
  let i = 1;
  while (snaps[i].t < time) i++;
  const a = snaps[i - 1];
  const b = snaps[i];
  const k = (time - a.t) / (b.t - a.t);
  return {
    x: lerp(a.x, b.x, k),
    y: lerp(a.y, b.y, k),
    z: lerp(a.z, b.z, k),
    ry: lerpAngle(a.ry, b.ry, k),
    anim: b.anim,
  };
}

function colorOf(appearance) {
  return typeof appearance?.color === 'number' ? appearance.color : null;
}

/**
 * @param {object} deps
 * @param {THREE.Scene} deps.scene
 * @param {(text: string) => THREE.Object3D & {element: HTMLElement}} deps.createLabel
 */
export function createRemotePlayers({ scene, createLabel }) {
  /** @type {Map<number, {group: THREE.Group, avatar: THREE.Group, label: any, snaps: object[], name: string, last: object | null, lastNow: number | null}>} */
  const players = new Map();

  function create(id, name, appearance) {
    const group = new THREE.Group();
    // Персонаж смотрит в +Z, а игрок в городе — в −Z: разворачиваем внутри группы.
    const avatar = createCharacter({ appearance: appearanceFromSeed(id, colorOf(appearance)) });
    avatar.scale.setScalar(CITY_CHARACTER_SCALE);
    avatar.rotation.y = Math.PI;
    group.add(avatar);
    const label = createLabel(name);
    label.position.set(0, LABEL_HEIGHT, 0);
    group.add(label);
    group.visible = false; // до первого снимка позиция неизвестна
    scene.add(group);
    return { group, avatar, label, snaps: [], name, last: null, lastNow: null };
  }

  function destroy(p) {
    scene.remove(p.group);
    p.label.removeFromParent();
    p.label.element.remove();
    disposeCharacter(p.avatar);
  }

  return {
    get size() {
      return players.size;
    },
    join(id, name, appearance) {
      if (players.has(id)) destroy(players.get(id));
      players.set(id, create(id, name, appearance));
    },
    leave(id) {
      const p = players.get(id);
      if (!p) return;
      players.delete(id);
      destroy(p);
    },
    /** Снимок `players`: list = [[id, x, y, z, ry, anim], ...], now — performance.now() прихода. */
    snapshot(list, now) {
      for (const [id, x, y, z, ry, anim] of list) {
        let p = players.get(id);
        if (!p) {
          // Страховка: players без player_join (не должно случаться по протоколу).
          p = create(id, `#${id}`, {});
          players.set(id, p);
        }
        p.snaps.push({ t: now, x, y, z, ry, anim });
        if (p.snaps.length > MAX_SNAPSHOTS) p.snaps.shift();
      }
    },
    update(now) {
      const time = now - INTERP_DELAY_MS;
      for (const p of players.values()) {
        // Старые снимки не нужны, но один «до» момента показа оставляем.
        while (p.snaps.length > 2 && p.snaps[1].t < time) p.snaps.shift();
        const s = sampleSnapshots(p.snaps, time);
        if (!s) continue;
        p.group.visible = true;
        p.group.position.set(s.x, s.y, s.z);
        p.group.rotation.y = s.ry;
        // Походка по реальному смещению: после последнего снимка игрок стоит, и руки не машут.
        const dt = p.lastNow === null ? 0 : Math.min(0.1, (now - p.lastNow) / 1000);
        let speed = 0;
        if (p.last && dt > 0) {
          const velocity = Math.hypot(s.x - p.last.x, s.z - p.last.z) / dt;
          speed = velocity > RUN_SPEED ? 2 : velocity > 0.3 ? 1 : 0;
        }
        p.last = s;
        p.lastNow = now;
        animateCharacter(p.avatar, dt, now / 1000, { speed });
      }
    },
    clear() {
      for (const p of players.values()) destroy(p);
      players.clear();
    },
    dispose() {
      this.clear();
    },
  };
}

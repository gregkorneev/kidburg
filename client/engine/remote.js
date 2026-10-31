// Другие игроки: простые аватары, подписи и интерполяция по буферу снимков `players`.
// Отображаем с задержкой INTERP_DELAY_MS, чтобы почти всегда было два снимка вокруг момента показа.

import * as THREE from 'three';

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

function colorOf(id, appearance) {
  if (typeof appearance?.color === 'number') return appearance.color;
  return new THREE.Color().setHSL(((id * 47) % 360) / 360, 0.55, 0.5).getHex();
}

/**
 * @param {object} deps
 * @param {THREE.Scene} deps.scene
 * @param {ReturnType<import('./pool.js').createPool>} deps.pool
 * @param {(text: string) => THREE.Object3D & {element: HTMLElement}} deps.createLabel
 */
export function createRemotePlayers({ scene, pool, createLabel }) {
  /** @type {Map<number, {group: THREE.Group, label: any, keys: string[], snaps: object[], name: string}>} */
  const players = new Map();

  function create(id, name, appearance) {
    const keys = [];
    const acquire = (key, factory) => {
      keys.push(key);
      return pool.acquire(key, factory);
    };
    const color = colorOf(id, appearance);
    const bodyGeo = acquire('avatar:body', () => new THREE.CylinderGeometry(0.32, 0.32, 1.1, 8).translate(0, 0.65, 0));
    const headGeo = acquire('avatar:head', () => new THREE.SphereGeometry(0.22, 8, 6).translate(0, 1.45, 0));
    const noseGeo = acquire('avatar:nose', () => new THREE.BoxGeometry(0.1, 0.1, 0.2).translate(0, 1.45, -0.22));
    const mat = acquire(`avatar:mat:${color}`, () => new THREE.MeshLambertMaterial({ color }));
    const group = new THREE.Group();
    group.add(new THREE.Mesh(bodyGeo, mat), new THREE.Mesh(headGeo, mat), new THREE.Mesh(noseGeo, mat));
    const label = createLabel(name);
    label.position.set(0, 2.0, 0);
    group.add(label);
    group.visible = false; // до первого снимка позиция неизвестна
    scene.add(group);
    return { group, label, keys, snaps: [], name };
  }

  function destroy(p) {
    scene.remove(p.group);
    p.label.removeFromParent();
    p.label.element.remove();
    for (const key of p.keys) pool.release(key);
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

// Переносимые предметы (ящик, конус, горшок). Состояние приходит с сервера: prop_snapshot при входе и prop_state при
// каждом взятии/постановке. Предмет в руках привязывается к модели держащего игрока (своей или удалённого) и ведёт себя
// как часть его тела; стоящий — к земле в мире. Меши создаются только для предметов в загруженных чанках или в руках
// у видимого игрока и освобождаются без утечек (геометрия и материал общие).
import * as THREE from 'three';
import { PROP_TYPES } from '../../../shared/interaction-contracts.js';
import { createPropMesh } from '../art/interactive-props.js';

const TAKE_S = 0.22;
const PLACE_S = 0.28;
const HOP = 0.18; // высота дуги при постановке (м)
const easeOut = (t) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

/**
 * @param {object} deps
 * @param {THREE.Scene} deps.scene
 * @param {(x: number, z: number) => boolean} deps.isLoaded
 * @param {(playerId: number) => {parent: THREE.Object3D, scale: number, forward: 1|-1} | null} deps.anchorOf
 *   куда крепить предмет игрока: parent — его модель/группа, scale — масштаб родителя, forward — знак оси «вперёд»
 * @param {() => number} deps.selfId id локального игрока
 * @param {(x: number, z: number) => number} [deps.heightAt]
 */
export function createCarrySystem({ scene, isLoaded, anchorOf, selfId, heightAt = () => 0 }) {
  /** @type {Map<string, {row: object, mesh: THREE.Mesh|null, tween: object|null, parent: THREE.Object3D|null}>} */
  const props = new Map();
  const tmp = new THREE.Vector3();

  const groundPoint = (row) => new THREE.Vector3(row.x, heightAt(row.x, row.z) ?? 0, row.z);

  function place(entry) {
    const { row, mesh } = entry;
    if (entry.parent) {
      scene.attach(mesh);
      entry.parent = null;
    }
    mesh.scale.setScalar(1);
    mesh.position.copy(groundPoint(row));
    mesh.rotation.set(0, row.ry, 0);
  }

  function create(entry) {
    entry.mesh = createPropMesh(entry.row.type);
    scene.add(entry.mesh);
    place(entry);
  }

  function release(entry) {
    if (!entry.mesh) return;
    entry.mesh.removeFromParent();
    entry.mesh = null;
    entry.parent = null;
    entry.tween = null;
  }

  function startTake(entry, anchor) {
    const { mesh } = entry;
    anchor.parent.attach(mesh); // мировое положение сохраняется
    entry.parent = anchor.parent;
    entry.tween = { kind: 'take', t: 0, from: mesh.position.clone(), fromQuat: mesh.quaternion.clone() };
  }

  function startPlace(entry) {
    // Предмет в руках → на землю: показываем дугу от текущего мирового положения.
    const { mesh } = entry;
    const from = mesh.getWorldPosition(new THREE.Vector3());
    const quat = mesh.getWorldQuaternion(new THREE.Quaternion());
    scene.attach(mesh);
    entry.parent = null;
    mesh.scale.setScalar(1);
    mesh.position.copy(from);
    mesh.quaternion.copy(quat);
    entry.tween = { kind: 'place', t: 0, from, fromQuat: quat };
  }

  const carryTarget = (entry, anchor) => {
    const c = PROP_TYPES[entry.row.type].carry;
    return tmp.set(c.x / anchor.scale, c.y / anchor.scale, (c.z * anchor.forward) / anchor.scale);
  };

  function apply(row) {
    let entry = props.get(row.id);
    if (!entry) {
      entry = { row, mesh: null, tween: null, parent: null };
      props.set(row.id, entry);
    }
    if (entry.row.rev > row.rev) return false;
    const wasHeld = entry.row.state === 'held';
    entry.row = row;
    if (!entry.mesh) return true;
    if (row.state === 'held' && !wasHeld) {
      const anchor = anchorOf(row.holder);
      if (anchor) startTake(entry, anchor);
      else release(entry);
    } else if (row.state !== 'held' && wasHeld) {
      if (entry.parent) startPlace(entry);
      else place(entry);
    } else if (row.state !== 'held') {
      place(entry);
    }
    return true;
  }

  return {
    snapshot(list) {
      const ids = new Set(list.map((r) => r.id));
      for (const [id, entry] of [...props]) {
        if (!ids.has(id)) {
          release(entry);
          props.delete(id);
        }
      }
      for (const row of list) {
        const entry = props.get(row.id);
        // Полный снимок после (пере)подключения: состояние берётся как есть, без анимации.
        if (entry) {
          release(entry);
          props.delete(row.id);
        }
        props.set(row.id, { row, mesh: null, tween: null, parent: null });
      }
    },
    state: apply,
    /** Предмет, который несёт локальный игрок. */
    heldByMe() {
      for (const { row } of props.values()) if (row.state === 'held' && row.holder === selfId()) return row;
      return null;
    },
    /** Предметы вне рук с положением (цели клавиши E). */
    groundProps() {
      const out = [];
      for (const { row, mesh } of props.values()) if (row.state !== 'held' && mesh) out.push(row);
      return out;
    },
    rows: () => [...props.values()].map((e) => e.row),
    holderOf: (id) => props.get(id)?.row.holder ?? 0,
    get(id) {
      return props.get(id)?.row ?? null;
    },
    get size() {
      return props.size;
    },
    update(dt) {
      for (const entry of props.values()) {
        const { row } = entry;
        const held = row.state === 'held';
        const anchor = held ? anchorOf(row.holder) : null;
        const visible = held ? Boolean(anchor) : isLoaded(row.x, row.z);
        if (!visible) {
          release(entry);
          continue;
        }
        if (!entry.mesh) {
          create(entry);
          if (held) {
            anchor.parent.attach(entry.mesh);
            entry.parent = anchor.parent;
            entry.mesh.scale.setScalar(1 / anchor.scale);
            entry.mesh.position.copy(carryTarget(entry, anchor));
            entry.mesh.rotation.set(0, 0, 0);
          }
          continue;
        }
        if (held && anchor && entry.parent !== anchor.parent) {
          // Модель игрока пересоздана (другой чанк/аватар): переносим предмет на новую.
          anchor.parent.attach(entry.mesh);
          entry.parent = anchor.parent;
        }
        const { mesh, tween } = entry;
        if (held && anchor) {
          const target = carryTarget(entry, anchor);
          const scale = 1 / anchor.scale;
          if (tween?.kind === 'take') {
            tween.t += dt / TAKE_S;
            const k = easeOut(tween.t);
            mesh.position.lerpVectors(tween.from, target, k);
            mesh.scale.setScalar(THREE.MathUtils.lerp(mesh.scale.x, scale, k));
            mesh.quaternion.slerpQuaternions(tween.fromQuat, new THREE.Quaternion(), k);
            if (tween.t >= 1) entry.tween = null;
          } else {
            mesh.position.copy(target);
            mesh.scale.setScalar(scale);
            mesh.rotation.set(0, 0, 0);
          }
        } else if (tween?.kind === 'place') {
          tween.t += dt / PLACE_S;
          const k = easeOut(tween.t);
          const to = groundPoint(row);
          mesh.position.lerpVectors(tween.from, to, k);
          mesh.position.y += Math.sin(Math.min(1, tween.t) * Math.PI) * HOP;
          mesh.quaternion.slerpQuaternions(tween.fromQuat, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, row.ry, 0)), k);
          if (tween.t >= 1) {
            entry.tween = null;
            place(entry);
          }
        }
      }
    },
    dispose() {
      for (const entry of props.values()) release(entry);
      props.clear();
    },
  };
}

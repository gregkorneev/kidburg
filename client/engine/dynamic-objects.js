// Динамические объекты мира на клиенте (редактор Control Center). Сервер присылает их отдельными сообщениями
// dyn_snapshot / dyn_upsert / dyn_remove только для чанков из кеша клиента. Здесь они превращаются в меши,
// получают коллайдеры, а при выгрузке чанка или удалении полностью освобождаются: геометрии и материалы идут
// через общий пул со счётчиком ссылок, подписи таблиц снимаются из DOM.
import * as THREE from 'three';
import { CHUNK_SIZE } from '../../shared/constants.js';
import { WORLD_OBJECT_TYPES } from '../../shared/world-objects.js';
import { instanceBox } from './chunks.js';
import { DYNAMIC_TYPES, isDynamicType } from './dynamic-types.js';
import { applyWindShadows, windMaterial, treeProfile, padWindBounds } from './art/wind.js';

const MATERIAL_KEY = 'dyn-mat';
const chunkOf = (x, z) => ({ cx: Math.floor(x / CHUNK_SIZE), cz: Math.floor(z / CHUNK_SIZE) });
const LABEL_HEIGHT = 2.6;

/**
 * @param {object} deps
 * @param {THREE.Scene} deps.scene
 * @param {ReturnType<import('./pool.js').createPool>} deps.pool
 * @param {(x: number, z: number) => number|null} [deps.heightAt] высота рельефа (null — чанк не загружен)
 * @param {(text: string) => THREE.Object3D & {element: HTMLElement}} [deps.createLabel] подпись таблички
 * @param {number} [deps.maxObjects] страховка от неограниченного роста списка на клиенте
 */
export function createDynamicObjects({ scene, pool, heightAt = () => null, createLabel = null, maxObjects = 200 }) {
  /** @type {Map<string, object>} */
  const entries = new Map();

  function colliderFor(o, y) {
    const spec = WORLD_OBJECT_TYPES[o.type];
    return spec.collider ? instanceBox(spec.collider, o.x, y, o.z, o.ry, o.scale) : null;
  }

  function place(entry, o) {
    const y = heightAt(o.x, o.z) ?? 0;
    entry.mesh.position.set(o.x, y, o.z);
    entry.mesh.rotation.y = o.ry;
    entry.mesh.scale.setScalar(o.scale);
    entry.collider = colliderFor(o, y);
    entry.cx = chunkOf(o.x, o.z).cx;
    entry.cz = chunkOf(o.x, o.z).cz;
  }

  function setLabel(entry, text) {
    if (entry.label && entry.labelText === text) return;
    if (entry.label) {
      entry.label.removeFromParent();
      entry.label.element.remove();
      entry.label = null;
    }
    entry.labelText = text;
    if (!text || !createLabel) return;
    entry.label = createLabel(text);
    entry.label.position.set(0, LABEL_HEIGHT / entry.obj.scale, 0); // подпись в мировых метрах независимо от масштаба
    entry.mesh.add(entry.label);
  }

  function release(entry) {
    scene.remove(entry.mesh);
    if (entry.label) {
      entry.label.removeFromParent();
      entry.label.element.remove();
    }
    for (const key of entry.keys) pool.release(key);
  }

  function create(o) {
    const def = DYNAMIC_TYPES[o.type];
    const geoKey = `dyn-geo:${o.type}:${def.key(o.params)}`;
    const profile = o.type === 'tree' ? treeProfile(o.params?.variant) : o.type === 'bush' ? 'bush' : null;
    const geometry = pool.acquire(geoKey, () => {
      const result = def.build(o.params);
      return profile ? padWindBounds(result, profile) : result;
    });
    const material = profile ? windMaterial(profile) : pool.acquire(MATERIAL_KEY, () => new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.86, metalness: 0 }));
    const mesh = new THREE.Mesh(geometry, material);
    applyWindShadows(mesh);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `dyn:${o.id}`;
    scene.add(mesh);
    const entry = { obj: o, mesh, keys: profile ? [geoKey] : [geoKey, MATERIAL_KEY], geoKey, label: null, labelText: null, collider: null, cx: 0, cz: 0 };
    place(entry, o);
    if (o.type === 'sign') setLabel(entry, o.params?.text ?? '');
    entries.set(o.id, entry);
    return entry;
  }

  const api = {
    get size() {
      return entries.size;
    },
    has: (id) => entries.has(id),
    ids: () => [...entries.keys()],
    get: (id) => entries.get(id)?.obj ?? null,
    /** Создаёт или обновляет объект. Более старая ревизия игнорируется (устаревшее сообщение не заменяет новое). */
    upsert(o) {
      if (!o || typeof o.id !== 'string' || !isDynamicType(o.type)) return false;
      const existing = entries.get(o.id);
      if (existing && existing.obj.rev >= o.rev) return false;
      if (!existing && entries.size >= maxObjects) return false;
      if (existing) {
        const def = DYNAMIC_TYPES[o.type];
        const sameShape = existing.obj.type === o.type && `dyn-geo:${o.type}:${def.key(o.params)}` === existing.geoKey;
        if (!sameShape) {
          release(existing);
          entries.delete(o.id);
          create(o);
          return true;
        }
        existing.obj = o;
        place(existing, o);
        if (o.type === 'sign') setLabel(existing, o.params?.text ?? '');
        return true;
      }
      create(o);
      return true;
    },
    /** Снимок чанка: объекты чанка, которых в нём больше нет, убираются. */
    snapshot(cx, cz, objects) {
      const ids = new Set();
      for (const o of objects) {
        ids.add(o.id);
        api.upsert(o);
      }
      for (const [id, entry] of [...entries]) {
        if (entry.cx === cx && entry.cz === cz && !ids.has(id)) api.remove(id);
      }
    },
    remove(id, rev = Infinity) {
      const entry = entries.get(id);
      if (!entry || entry.obj.rev > rev) return false;
      release(entry);
      entries.delete(id);
      return true;
    },
    /** Чанк выгружен: его динамические объекты освобождаются вместе с ним. */
    unloadChunk(cx, cz) {
      for (const [id, entry] of [...entries]) {
        if (entry.cx === cx && entry.cz === cz) {
          release(entry);
          entries.delete(id);
        }
      }
    },
    /** AABB объектов из чанка игрока и соседних (как у world.collidersNear). */
    collidersNear(x, z) {
      const here = chunkOf(x, z);
      const out = [];
      for (const entry of entries.values()) {
        if (entry.collider && Math.abs(entry.cx - here.cx) <= 1 && Math.abs(entry.cz - here.cz) <= 1) out.push(entry.collider);
      }
      return out;
    },
    clear() {
      for (const entry of entries.values()) release(entry);
      entries.clear();
    },
    dispose() {
      api.clear();
    },
  };
  return api;
}

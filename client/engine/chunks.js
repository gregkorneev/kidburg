// Чанки мира: разбор MessagePack, рельеф по высотам, InstancedMesh по префабам,
// AABB-коллайдеры и NPC. Ресурсы выгруженного чанка освобождаются (shared/chunk-format.md).

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { CHUNK_SIZE, WORLD_CHUNKS_X, WORLD_CHUNKS_Z } from '../../shared/constants.js';
import { decode } from '../../shared/protocol.js';
import { getPrefab } from './prefabs.js';

const GRID = 17; // узлов на сторону чанка
const CELL = CHUNK_SIZE / (GRID - 1); // 4 м
const ZONE_COLORS = { hospital: 0xcfd8dc, park: 0x5fa35a, plain: 0x7a9a58 };

const chunkKey = (cx, cz) => cx + cz * WORLD_CHUNKS_X;

/** Разбирает байты файла чанка; бросает ошибку, если формат неверный. */
export function parseChunk(bytes) {
  const chunk = decode(bytes);
  if (!chunk || chunk.v !== 1 || !Number.isInteger(chunk.cx) || !Number.isInteger(chunk.cz)) {
    throw new Error('чанк: неверный формат');
  }
  let heights = chunk.heights;
  if (heights instanceof Uint8Array) {
    // heights приходит как bin: копируем в выровненный буфер (смещение во view может быть любым).
    heights = new Float32Array(heights.buffer.slice(heights.byteOffset, heights.byteOffset + heights.byteLength));
  }
  if (!(heights instanceof Float32Array) || heights.length !== GRID * GRID) {
    throw new Error('чанк: heights должен содержать 17×17 значений');
  }
  return {
    cx: chunk.cx,
    cz: chunk.cz,
    zone: chunk.zone,
    heights,
    instances: Array.isArray(chunk.instances) ? chunk.instances : [],
    npcs: Array.isArray(chunk.npcs) ? chunk.npcs : [],
  };
}

/**
 * Высота рельефа в точке чанка (локальные координаты 0..64).
 * Совпадает с треугольниками меша: клетка делится диагональю от (ix+1, iz) к (ix, iz+1).
 */
export function heightInChunk(heights, lx, lz) {
  const fx = Math.min(Math.max(lx / CELL, 0), GRID - 1 - 1e-9);
  const fz = Math.min(Math.max(lz / CELL, 0), GRID - 1 - 1e-9);
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const u = fx - ix;
  const v = fz - iz;
  const a = heights[iz * GRID + ix];
  const b = heights[iz * GRID + ix + 1];
  const c = heights[(iz + 1) * GRID + ix];
  const d = heights[(iz + 1) * GRID + ix + 1];
  return u + v <= 1 ? a + u * (b - a) + v * (c - a) : d + (1 - u) * (c - d) + (1 - v) * (b - d);
}

function buildTerrain(chunk, material) {
  const positions = new Float32Array(GRID * GRID * 3);
  const colors = new Float32Array(GRID * GRID * 3);
  for (let iz = 0; iz < GRID; iz++) {
    for (let ix = 0; ix < GRID; ix++) {
      const i = iz * GRID + ix;
      positions.set([ix * CELL, chunk.heights[i], iz * CELL], i * 3);
      const shade = (ix + iz) % 2 ? 0.94 : 1; // лёгкая «шахматка», чтобы было видно движение
      colors.fill(shade, i * 3, i * 3 + 3);
    }
  }
  const indices = [];
  for (let iz = 0; iz < GRID - 1; iz++) {
    for (let ix = 0; ix < GRID - 1; ix++) {
      const a = iz * GRID + ix;
      indices.push(a, a + GRID, a + 1, a + 1, a + GRID, a + GRID + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

export function makeLabel(text) {
  const el = document.createElement('div');
  el.className = 'city-label';
  el.textContent = text;
  return new CSS2DObject(el);
}

/** AABB инстанса с учётом поворота и масштаба. */
function instanceBox(collider, x, y, z, ry, scale) {
  const [w, h, d] = collider;
  const cos = Math.abs(Math.cos(ry));
  const sin = Math.abs(Math.sin(ry));
  const hx = ((cos * w + sin * d) * scale) / 2;
  const hz = ((sin * w + cos * d) * scale) / 2;
  return { minX: x - hx, maxX: x + hx, minY: y, maxY: y + h * scale, minZ: z - hz, maxZ: z + hz };
}

/**
 * @param {object} deps
 * @param {THREE.Scene} deps.scene
 * @param {ReturnType<import('./pool.js').createPool>} deps.pool
 * @param {(text: string) => THREE.Object3D & {element: HTMLElement}} [deps.createLabel] подпись над NPC (для тестов без DOM)
 */
export function createChunkManager({ scene, pool, createLabel = makeLabel }) {
  /** @type {Map<number, object>} */
  const chunks = new Map();

  function build(chunk) {
    const group = new THREE.Group();
    group.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
    const keys = [];
    const acquire = (key, factory) => {
      keys.push(key);
      return pool.acquire(key, factory);
    };

    const terrainMat = acquire(`terrain:${chunk.zone}`, () =>
      new THREE.MeshLambertMaterial({ color: ZONE_COLORS[chunk.zone] ?? ZONE_COLORS.plain, vertexColors: true }),
    );
    const terrain = buildTerrain(chunk, terrainMat);
    group.add(terrain);

    // Инстансы группируются по префабу: одна InstancedMesh на префаб в чанке.
    const byPrefab = new Map();
    for (const inst of chunk.instances) {
      if (!Array.isArray(inst) || inst.length < 6) continue;
      const list = byPrefab.get(inst[0]);
      if (list) list.push(inst);
      else byPrefab.set(inst[0], [inst]);
    }
    const instanced = [];
    const colliders = [];
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    for (const [prefabId, list] of byPrefab) {
      const prefab = getPrefab(prefabId);
      const geometry = acquire(`prefab-geo:${prefabId}`, prefab.build);
      const material = acquire(`prefab-mat:${prefabId}`, () => new THREE.MeshLambertMaterial({ color: prefab.color }));
      const mesh = new THREE.InstancedMesh(geometry, material, list.length);
      list.forEach(([, x, y, z, ry, scale], i) => {
        // Координаты инстансов мировые, а группа смещена на чанк.
        pos.set(x - group.position.x, y, z - group.position.z);
        quat.setFromAxisAngle(up, ry);
        scl.setScalar(scale);
        mesh.setMatrixAt(i, matrix.compose(pos, quat, scl));
        if (prefab.collider) colliders.push(instanceBox(prefab.collider, x, y, z, ry, scale));
      });
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
      instanced.push(mesh);
    }

    const npcGeo = acquire('npc:body', () => new THREE.CylinderGeometry(0.35, 0.35, 1.7, 8).translate(0, 0.85, 0));
    const npcMat = acquire('npc:mat', () => new THREE.MeshLambertMaterial({ color: 0x3f8fd6 }));
    const npcs = chunk.npcs.map((n) => {
      const mesh = new THREE.Mesh(npcGeo, npcMat);
      mesh.position.set(n.x - group.position.x, n.y, n.z - group.position.z);
      mesh.rotation.y = n.ry;
      const name = n.name ?? n.agentId;
      const label = createLabel(name);
      label.position.set(0, 2.1, 0);
      mesh.add(label);
      group.add(mesh);
      return { id: n.id, agentId: n.agentId, name, x: n.x, y: n.y, z: n.z, mesh, label };
    });

    scene.add(group);
    return { chunk, group, terrain, instanced, colliders, npcs, keys };
  }

  function disposeEntry(entry) {
    scene.remove(entry.group);
    entry.terrain.geometry.dispose();
    for (const mesh of entry.instanced) mesh.dispose(); // освобождает буфер instanceMatrix
    for (const npc of entry.npcs) {
      npc.label.removeFromParent();
      npc.label.element.remove();
    }
    for (const key of entry.keys) pool.release(key);
  }

  return {
    get size() {
      return chunks.size;
    },
    has: (cx, cz) => chunks.has(chunkKey(cx, cz)),
    /** Строит чанк из байт файла; повторная загрузка того же чанка заменяет старый. */
    load(cx, cz, bytes) {
      const chunk = parseChunk(bytes);
      if (chunk.cx !== cx || chunk.cz !== cz) throw new Error(`чанк ${cx},${cz}: в данных ${chunk.cx},${chunk.cz}`);
      this.unload(cx, cz);
      chunks.set(chunkKey(cx, cz), build(chunk));
    },
    unload(cx, cz) {
      const key = chunkKey(cx, cz);
      const entry = chunks.get(key);
      if (!entry) return;
      chunks.delete(key);
      disposeEntry(entry);
    },
    clear() {
      for (const entry of chunks.values()) disposeEntry(entry);
      chunks.clear();
    },
    /** Высота рельефа или null, если чанк не загружен. */
    heightAt(x, z) {
      const cx = Math.floor(x / CHUNK_SIZE);
      const cz = Math.floor(z / CHUNK_SIZE);
      if (cx < 0 || cz < 0 || cx >= WORLD_CHUNKS_X || cz >= WORLD_CHUNKS_Z) return null;
      const entry = chunks.get(chunkKey(cx, cz));
      return entry ? heightInChunk(entry.chunk.heights, x - cx * CHUNK_SIZE, z - cz * CHUNK_SIZE) : null;
    },
    /** AABB из чанка игрока и соседних. */
    collidersNear(x, z) {
      const cx = Math.floor(x / CHUNK_SIZE);
      const cz = Math.floor(z / CHUNK_SIZE);
      const out = [];
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const entry = chunks.get(chunkKey(cx + dx, cz + dz));
          if (entry) out.push(...entry.colliders);
        }
      }
      return out;
    },
    /** Ближайший NPC в радиусе по горизонтали или null. */
    nearestNpc(x, y, z, radius, maxDy = 3) {
      let best = null;
      let bestDist = radius;
      for (const entry of chunks.values()) {
        for (const npc of entry.npcs) {
          if (Math.abs(npc.y - y) > maxDy) continue;
          const dist = Math.hypot(npc.x - x, npc.z - z);
          if (dist <= bestDist) {
            best = npc;
            bestDist = dist;
          }
        }
      }
      return best;
    },
    dispose() {
      this.clear();
    },
  };
}

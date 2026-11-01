// Чанки мира: разбор MessagePack, рельеф по высотам, InstancedMesh по префабам,
// коллайдеры и NPC. Ресурсы выгруженного чанка освобождаются (shared/chunk-format.md).

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { CHUNK_SIZE, WORLD_CHUNKS_X, WORLD_CHUNKS_Z } from '../../shared/constants.js';
import { decode } from '../../shared/protocol.js';
import { CITY_CHARACTER_SCALE, animateCharacter, appearanceFromSeed, createCharacter, disposeCharacter } from './art/character.js';
import { updateWind } from './art/wind.js';
import { getPrefabVariant, variantKey } from './prefabs.js';

const GRID = 17; // узлов на сторону чанка
const CELL = CHUNK_SIZE / (GRID - 1); // 4 м
const ZONE_COLORS = { hospital: 0xcfd8dc, park: 0x5fa35a, plain: 0x7a9a58 };

const NPC_LOOK_DISTANCE = 10; // м: ближе этого NPC провожает игрока взглядом

function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

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

// Низкочастотный «шум» цвета земли: пятна светлее и темнее вместо шахматки. Зависит от мировых координат,
// поэтому стыки чанков не заметны.
function groundTint(wx, wz) {
  const broad = Math.sin(wx * 0.045 + Math.sin(wz * 0.031) * 2.1) * Math.sin(wz * 0.052 + Math.cos(wx * 0.027) * 1.7);
  const fine = Math.sin(wx * 0.31 + wz * 0.17) * Math.sin(wz * 0.27 - wx * 0.13);
  return 1 + broad * 0.07 + fine * 0.025;
}

function buildTerrain(chunk, material) {
  const positions = new Float32Array(GRID * GRID * 3);
  const colors = new Float32Array(GRID * GRID * 3);
  for (let iz = 0; iz < GRID; iz++) {
    for (let ix = 0; ix < GRID; ix++) {
      const i = iz * GRID + ix;
      positions.set([ix * CELL, chunk.heights[i], iz * CELL], i * 3);
      const shade = groundTint(chunk.cx * CHUNK_SIZE + ix * CELL, chunk.cz * CHUNK_SIZE + iz * CELL);
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
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

export function makeLabel(text) {
  const el = document.createElement('div');
  el.className = 'city-label';
  el.textContent = text;
  return new CSS2DObject(el);
}

/** Коллайдер инстанса с AABB-границами и локальной формой для точной проверки поворота. */
function instanceBox(collider, x, y, z, ry, scale) {
  const [w, h, d] = collider;
  const cos = Math.abs(Math.cos(ry));
  const sin = Math.abs(Math.sin(ry));
  const hx = ((cos * w + sin * d) * scale) / 2;
  const hz = ((sin * w + cos * d) * scale) / 2;
  return {
    x,
    z,
    halfWidth: (w * scale) / 2,
    halfDepth: (d * scale) / 2,
    rotationY: ry,
    minX: x - hx,
    maxX: x + hx,
    minY: y,
    maxY: y + h * scale,
    minZ: z - hz,
    maxZ: z + hz,
  };
}

/**
 * @param {object} deps
 * @param {THREE.Scene} deps.scene
 * @param {ReturnType<import('./pool.js').createPool>} deps.pool
 * @param {(text: string) => THREE.Object3D & {element: HTMLElement}} [deps.createLabel] подпись над NPC (для тестов без DOM)
 */
export function createChunkManager({ scene, pool, createLabel = makeLabel, quality = 'medium' }) {
  /** @type {Map<number, object>} */
  const chunks = new Map();
  let currentQuality = quality;

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

    // Инстансы группируются по префабу и его варианту: одна InstancedMesh на вариант в чанке.
    const byPrefab = new Map();
    for (const inst of chunk.instances) {
      if (!Array.isArray(inst) || inst.length < 6) continue;
      const variant = variantKey(inst[0], inst[1], inst[3]);
      const key = variant ? `${inst[0]}:${variant}` : `${inst[0]}`;
      const entry = byPrefab.get(key);
      if (entry) entry.list.push(inst);
      else byPrefab.set(key, { id: inst[0], variant, key, list: [inst] });
    }
    const instanced = [];
    const colliders = [];
    const decor = [];
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    for (const { id: prefabId, variant, key, list } of byPrefab.values()) {
      const prefab = getPrefabVariant(prefabId, variant);
      const geometry = acquire(`prefab-geo:${key}`, prefab.build);
      const material = acquire(`prefab-mat:${prefabId}`, () => (prefab.vertexColors === true
        ? new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.86, metalness: 0 })
        : new THREE.MeshLambertMaterial({ color: prefab.color })));
      const mesh = new THREE.InstancedMesh(geometry, material, list.length);
      mesh.castShadow = prefab.name !== 'city_path'; // дорожки лежат на земле и теней не отбрасывают
      mesh.receiveShadow = true;
      list.forEach(([, x, y, z, ry, scale], i) => {
        // Координаты инстансов мировые, а группа смещена на чанк.
        pos.set(x - group.position.x, y, z - group.position.z);
        quat.setFromAxisAngle(up, ry);
        scl.setScalar(scale);
        mesh.setMatrixAt(i, matrix.compose(pos, quat, scl));
        if (prefab.collider) colliders.push(instanceBox(prefab.collider, x, y, z, ry, scale));
        if (prefab.decorate) {
          decor.push(prefab.decorate({ group, instance: { x: x - group.position.x, y, z: z - group.position.z, ry, scale }, quality: currentQuality }));
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
      instanced.push(mesh);
    }

    const npcs = chunk.npcs.map((n) => {
      const name = n.name ?? n.agentId;
      // Внешность выводится из agentId: один и тот же NPC выглядит одинаково у всех.
      const avatar = createCharacter({ appearance: appearanceFromSeed(hashString(String(n.agentId ?? name))), holding: 'clipboard' });
      avatar.scale.setScalar(CITY_CHARACTER_SCALE);
      avatar.rotation.y = Math.PI; // персонаж смотрит в +Z, направление NPC считается как у игрока (−Z)
      const mesh = new THREE.Group();
      mesh.position.set(n.x - group.position.x, n.y, n.z - group.position.z);
      mesh.rotation.y = n.ry;
      mesh.add(avatar);
      const label = createLabel(name);
      label.position.set(0, 2.15, 0);
      mesh.add(label);
      group.add(mesh);
      return { id: n.id, agentId: n.agentId, name, x: n.x, y: n.y, z: n.z, ry: n.ry, mesh, avatar, label };
    });

    scene.add(group);
    return { chunk, group, terrain, instanced, colliders, npcs, keys, decor };
  }

  function disposeEntry(entry) {
    scene.remove(entry.group);
    entry.terrain.geometry.dispose();
    for (const mesh of entry.instanced) mesh.dispose(); // освобождает буфер instanceMatrix
    for (const decor of entry.decor) decor.dispose();
    for (const npc of entry.npcs) {
      npc.label.removeFromParent();
      npc.label.element.remove();
      disposeCharacter(npc.avatar);
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
    /** Каждый кадр: NPC дышат, моргают и поворачивают голову к игроку, пока он рядом. */
    update(dt, elapsed, player) {
      updateWind(elapsed);
      for (const entry of chunks.values()) {
        for (const decor of entry.decor) decor.update?.(dt, elapsed);
        for (const npc of entry.npcs) {
          let lookYaw = 0;
          if (player) {
            const dx = player.x - npc.x;
            const dz = player.z - npc.z;
            if (Math.abs(npc.y - player.y) < 3 && dx * dx + dz * dz < NPC_LOOK_DISTANCE ** 2) {
              lookYaw = Math.atan2(dx, dz) - (npc.ry + Math.PI);
              lookYaw = Math.atan2(Math.sin(lookYaw), Math.cos(lookYaw));
            }
          }
          animateCharacter(npc.avatar, dt, elapsed, { speed: 0, lookYaw });
        }
      }
    },
    /** Меняет уровень графики: декор (струи, растения) подстраивает число частиц и экземпляров. */
    setQuality(level) {
      currentQuality = level;
      for (const entry of chunks.values()) for (const decor of entry.decor) decor.setQuality?.(level);
    },
    dispose() {
      this.clear();
    },
  };
}

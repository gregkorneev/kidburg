// Правила размещения динамических объектов: границы мира, запретные зоны и пересечения.
// Зоны строятся из той же планировки, что и мир (tools/build-world/layout.js, plaza-plan.js, city-entrance.js)
// и из статических инстансов чанков, поэтому объект нельзя поставить в здание, на дверь, маршрут к ней,
// точку появления игроков, фонтан, NPC или поверх дерева/скамьи, созданных генератором мира.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SPAWN, WORLD_SIZE_X, WORLD_SIZE_Z } from '../../shared/constants.js';
import { decode } from '../../shared/protocol.js';
import { WORLD_OBJECT_LIMITS, WORLD_OBJECT_TYPES, isObjectType } from '../../shared/world-objects.js';
import { BUILDINGS, PATHS, PLAZA } from '../../tools/build-world/layout.js';
import { BAKERY_ENTRANCE, FIRE_STATION_ENTRANCE, FLORIST_ENTRANCE } from '../../client/engine/city-entrance.js';
import { FOUNTAIN, PLAZA_RADIUS, ROUTES, ROUTE_HALF_WIDTH, plazaCollisionBoxes } from '../../client/engine/plaza-plan.js';
import { DOOR_SPECS, doorWorldPoint } from '../../shared/doors.js';
import { FIELD, goalGeometry } from '../../shared/interaction-contracts.js';

const BUILDING_PAD = 3;
const DOOR_RADIUS = 6;
const PLAZA_PAD = 1.5;
const ROUTE_PAD = 1.2;
const PATH_PAD = 1.5;
const NPC_RADIUS = 4;
const SPAWN_RADIUS = 8;

/** Статические префабы с коллайдером, учитываемые как препятствия (деревья, скамьи, фонари). */
const STATIC_OBSTACLE_IDS = new Set([1, 2, 3]);

const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

/** Расстояние от точки до прямоугольника, повёрнутого как здания (rotationY вокруг Y; x' = x·cos + z·sin). */
function distToBox(px, pz, box) {
  const dx = px - box.x;
  const dz = pz - box.z;
  const cos = Math.cos(box.ry);
  const sin = Math.sin(box.ry);
  const lx = cos * dx - sin * dz;
  const lz = sin * dx + cos * dz;
  const ox = Math.max(Math.abs(lx) - box.w / 2, 0);
  const oz = Math.max(Math.abs(lz) - box.d / 2, 0);
  return Math.hypot(ox, oz);
}

function distToSegment(px, pz, ax, az, bx, bz) {
  const vx = bx - ax;
  const vz = bz - az;
  const len2 = vx * vx + vz * vz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / len2));
  return dist(px, pz, ax + t * vx, az + t * vz);
}

/** Статические объекты из файлов чанков (если мир загружен). Ошибки чтения пропускаются: правила зданий остаются. */
function staticObstacles(world) {
  if (!world?.dir) return [];
  const sizes = new Map((world.prefabs ?? []).map((p) => [p.id, p.collider?.size]));
  const list = [];
  for (const c of world.chunks) {
    let chunk;
    try {
      chunk = decode(readFileSync(path.join(world.dir, 'chunks', `${c.cx}_${c.cz}.bin`)));
    } catch {
      continue;
    }
    for (const inst of Array.isArray(chunk.instances) ? chunk.instances : []) {
      if (!Array.isArray(inst) || !STATIC_OBSTACLE_IDS.has(inst[0])) continue;
      const size = sizes.get(inst[0]) ?? [1, 1, 1];
      list.push({ x: inst[1], z: inst[3], r: (Math.max(size[0], size[2]) / 2) * (inst[5] || 1) });
    }
  }
  return list;
}

/**
 * @param {{world?: object|null}} [deps] world нужен для NPC и статических инстансов; без него проверяются только здания
 */
export function createPlacement({ world = null } = {}) {
  const statics = staticObstacles(world);
  const npcs = (world?.npcs ?? []).map((n) => ({ x: n.x, z: n.z }));

  const buildings = BUILDINGS.map((b) => ({ id: b.id, label: `Здание: ${b.name}`, x: b.x, z: b.z, w: b.width, d: b.depth, ry: b.rotationY }));
  const doors = ROUTES.map((route) => ({
    id: `door_${route.id}`,
    label: `Вход: ${route.name}`,
    x: PLAZA.x + route.front.x,
    z: PLAZA.z + route.front.z,
    r: DOOR_RADIUS,
  }));
  for (const e of [FIRE_STATION_ENTRANCE, FLORIST_ENTRANCE, BAKERY_ENTRANCE]) {
    doors.push({ id: `entrance_${e.href}`, label: e.label, x: e.x, z: e.z, r: DOOR_RADIUS });
  }
  const routes = ROUTES.map((route) => ({
    id: `route_${route.id}`,
    label: `Маршрут: ${route.name}`,
    ax: PLAZA.x,
    az: PLAZA.z,
    bx: PLAZA.x + route.front.x,
    bz: PLAZA.z + route.front.z,
    half: ROUTE_HALF_WIDTH + ROUTE_PAD,
  }));
  const circles = [
    { id: 'plaza', label: 'Площадь и фонтан', x: PLAZA.x, z: PLAZA.z, r: PLAZA_RADIUS + PLAZA_PAD },
    { id: 'spawn', label: 'Точка появления игроков', x: SPAWN.x, z: SPAWN.z, r: SPAWN_RADIUS },
    ...doors,
    ...npcs.map((n, i) => ({ id: `npc_${i}`, label: 'Персонаж (NPC)', x: n.x, z: n.z, r: NPC_RADIUS })),
  ];
  const pathBoxes = PATHS.map((p) => ({ id: `path_${p.id}`, label: 'Пешеходная дорожка', x: p.x, z: p.z, w: p.width + PATH_PAD * 2, d: p.depth + PATH_PAD * 2, ry: 0 }));

  /** Первая нарушенная запретная зона для круга (x, z, r) или null. */
  function blockedBy(x, z, r) {
    for (const b of buildings) if (distToBox(x, z, b) < r + BUILDING_PAD) return b.label;
    for (const c of circles) if (dist(x, z, c.x, c.z) < r + c.r) return c.label;
    for (const route of routes) if (distToSegment(x, z, route.ax, route.az, route.bx, route.bz) < r + route.half) return route.label;
    for (const p of pathBoxes) if (distToBox(x, z, p) < r) return p.label;
    for (const s of statics) if (dist(x, z, s.x, s.z) < r + s.r + WORLD_OBJECT_LIMITS.MIN_GAP) return 'Существующий объект мира';
    return null;
  }

  return {
    /** Базовая проверка без учёта других динамических объектов. */
    checkStatic({ type, x, z, scale }) {
      if (!isObjectType(type)) return { ok: false, code: 'bad_type', reason: 'Этот тип объектов не разрешён' };
      const r = WORLD_OBJECT_TYPES[type].radius * scale;
      const m = WORLD_OBJECT_LIMITS.EDGE_MARGIN;
      if (x - r < m || z - r < m || x + r > WORLD_SIZE_X - m || z + r > WORLD_SIZE_Z - m) {
        return { ok: false, code: 'out_of_bounds', reason: `Слишком близко к краю мира (отступ не меньше ${m} м)` };
      }
      const zone = blockedBy(x, z, r);
      if (zone) return { ok: false, code: 'forbidden_zone', reason: `Запретная зона: ${zone}` };
      return { ok: true };
    },
    /** Проверяет стартовую/переносимую вещь по тем же запретным зонам, что и размещаемый объект. */
    checkProp(x, z, radius) {
      if (![x, z, radius].every(Number.isFinite) || radius < 0) return { ok: false, code: 'bad_position', reason: 'Нужны конечные координаты и радиус' };
      const m = WORLD_OBJECT_LIMITS.EDGE_MARGIN;
      if (x - radius < m || z - radius < m || x + radius > WORLD_SIZE_X - m || z + radius > WORLD_SIZE_Z - m) {
        return { ok: false, code: 'out_of_bounds', reason: 'Слишком близко к краю мира' };
      }
      return { ok: true };
    },
    /** Препятствия для физики мяча: здания и статические объекты, как круги/коробки. */
    staticObstacles() {
      return {
        boxes: buildings.map((b) => ({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2, height: 8 })),
        circles: statics.map((s) => ({ x: s.x, z: s.z, r: s.r, height: 4 })),
      };
    },
    /** Описание зон для карты редактора (в координатах мира). */
    zones() {
      return {
        buildings: buildings.map((b) => ({ id: b.id, label: b.label, x: b.x, z: b.z, w: b.w + BUILDING_PAD * 2, d: b.d + BUILDING_PAD * 2, ry: b.ry })),
        circles: circles.map(({ id, label, x, z, r }) => ({ id, label, x, z, r })),
        routes: routes.map(({ id, label, ax, az, bx, bz, half }) => ({ id, label, ax, az, bx, bz, half })),
        paths: pathBoxes.map(({ id, label, x, z, w, d }) => ({ id, label, x, z, w, d, ry: 0 })),
        margin: WORLD_OBJECT_LIMITS.EDGE_MARGIN,
        statics: statics.map(({ x, z, r }) => ({ x, z, r })),
        worldSize: { x: WORLD_SIZE_X, z: WORLD_SIZE_Z },
      };
    },
  };
}

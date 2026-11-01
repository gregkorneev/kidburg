// Подвижные механизмы зданий города. Создаются вместе с чанком (хук decorate префаба) и выгружаются вместе с ним:
// ворота пожарной части и спутниковая антенна радиостанции. Неподвижная основа — в слитой геометрии префаба,
// здесь только движущиеся части. Сетевое состояние ворот подключает mechanism-sync.js через decor.mechanisms.
import * as THREE from 'three';
import { createSectionalGate } from './mechanisms/gate.js';
import { createSatelliteDish } from './mechanisms/antenna.js';
import { createDoor } from './mechanisms/door.js';
import { DOOR_REACH, doorSpec } from '../../shared/doors.js';
import { createSignDecor } from './city-decor.js';
import { FIRE_STATION_SIGNS, GARAGE_X, GATE, GATE_PALETTE } from './fire-station.js';
import { buildFireTruck } from '../stations/firefighter/station-art.js';
import { DISH_POST, MAST_BEACON, RADIO_STATION_SIGNS } from './radio-station.js';

/** Идентификаторы механизмов города: те же значения знает сервер (shared/mechanisms.js). */
export const CITY_GATE_IDS = Object.freeze(['fire-city-gate-0', 'fire-city-gate-1']);
export const GATE_INTERACT_RADIUS = 3.4;

/** Корень инстанса: локальные координаты здания -> группа чанка (то же преобразование, что у вывесок). */
function instanceRoot(group, instance) {
  const root = new THREE.Group();
  root.position.set(instance.x, instance.y, instance.z);
  root.rotation.y = instance.ry;
  root.scale.setScalar(instance.scale);
  group.add(root);
  return root;
}

/** Мировая точка из локальных координат здания (для подсказок и дальности клавиши E). */
function toWorld(group, instance, x, z) {
  const c = Math.cos(instance.ry);
  const s = Math.sin(instance.ry);
  return {
    x: group.position.x + instance.x + (x * c + z * s) * instance.scale,
    z: group.position.z + instance.z + (-x * s + z * c) * instance.scale,
  };
}

function compose(base, extra) {
  return {
    update(dt, elapsed) { base.update?.(dt, elapsed); extra.update(dt, elapsed); },
    setQuality(level) { base.setQuality?.(level); extra.setQuality?.(level); },
    dispose() { extra.dispose(); base.dispose(); },
    mechanisms: extra.mechanisms ?? [],
  };
}

export function decorateFireStation(args) {
  const base = createSignDecor(FIRE_STATION_SIGNS)(args);
  const { group, instance } = args;
  const root = instanceRoot(group, instance);
  const trucks = GARAGE_X.map((x) => {
    const truck = buildFireTruck();
    truck.position.set(x, GATE.baseY, 2.5);
    truck.rotation.y = Math.PI / 2;
    truck.scale.setScalar(0.72);
    root.add(truck);
    return truck;
  });
  const gates = GARAGE_X.map((x, i) => {
    const gate = createSectionalGate({
      id: CITY_GATE_IDS[i], width: GATE.width, height: GATE.height, sections: GATE.sections, thickness: GATE.thickness, radius: GATE.radius, palette: GATE_PALETTE,
    });
    gate.root.position.set(x, GATE.baseY, GATE.z);
    root.add(gate.root);
    return gate;
  });
  const mechanisms = gates.map((gate, i) => ({
    id: gate.id,
    kind: 'gate',
    object: gate,
    ...toWorld(group, instance, GARAGE_X[i], GATE.z),
    width: GATE.width * instance.scale,
    depth: GATE.thickness * instance.scale,
    minY: instance.y + GATE.baseY * instance.scale,
    maxY: instance.y + (GATE.baseY + GATE.height) * instance.scale,
    rotationY: instance.ry,
    radius: GATE_INTERACT_RADIUS * instance.scale,
  }));
  return compose(base, {
    update: (dt, elapsed) => { for (const gate of gates) gate.update(dt, elapsed); },
    dispose: () => { for (const gate of gates) gate.dispose(); for (const truck of trucks) truck.traverse((o) => { o.geometry?.dispose(); if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose()); else o.material?.dispose(); }); root.removeFromParent(); },
    mechanisms,
  });
}

export function decorateRadioStation(args) {
  const base = createSignDecor(RADIO_STATION_SIGNS)(args);
  const { group, instance } = args;
  const root = instanceRoot(group, instance);
  // Фаза зависит от положения здания: перенаведение не совпадает у разных экземпляров.
  const dish = createSatelliteDish({
    id: 'radio-dish', position: [DISH_POST.x, DISH_POST.top, DISH_POST.z], beaconPosition: [MAST_BEACON.x, MAST_BEACON.y, MAST_BEACON.z],
    seed: Math.floor(instance.x * 7 + instance.z * 13), baseYaw: Math.PI,
  });
  root.add(dish.root);
  return compose(base, {
    update: (dt, elapsed) => dish.update(dt, elapsed),
    setQuality: (level) => dish.setQuality(level),
    dispose: () => { dish.dispose(); root.removeFromParent(); },
  });
}

/**
 * Входные двери здания: створки на петлях поверх неподвижной рамы префаба. Дверь — такой же механизм с общим
 * состоянием, как ворота (mech_set / mech_state): kind 'door', href — страница интерьера, если она есть.
 * @param {(args: object) => {update?: Function, setQuality?: Function, dispose: Function, mechanisms?: object[]}} makeBase
 * @param {string[]} doorIds идентификаторы из shared/doors.js
 */
export function withDoors(makeBase, doorIds) {
  return (args) => {
    const base = makeBase(args);
    const { group, instance } = args;
    const root = instanceRoot(group, instance);
    const doors = doorIds.map((id) => {
      const spec = doorSpec(id);
      const door = createDoor({ id, w: spec.local.w, h: spec.local.h, leaf: spec.leaf, glass: spec.glass, handle: spec.handle });
      door.root.position.set(spec.local.x, spec.local.y, spec.local.z);
      root.add(door.root);
      return { spec, door };
    });
    const mechanisms = doors.map(({ spec, door }) => ({
      id: spec.id,
      kind: 'door',
      object: door,
      href: spec.href,
      doorLabel: spec.label,
      // Точка перед порогом, от которой считается дальность клавиши E; угол здания нужен для выбора по направлению взгляда.
      ...toWorld(group, instance, spec.local.x, spec.local.z + 1.4),
      rotationY: instance.ry,
      radius: DOOR_REACH * instance.scale,
    }));
    return {
      update(dt, elapsed) { base.update?.(dt, elapsed); for (const { door } of doors) door.update(dt, elapsed); },
      setQuality(level) { base.setQuality?.(level); },
      dispose() { for (const { door } of doors) door.dispose(); root.removeFromParent(); base.dispose(); },
      mechanisms: [...(base.mechanisms ?? []), ...mechanisms],
    };
  };
}

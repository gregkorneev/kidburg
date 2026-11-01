// Реестр станций и их NPC (station-aware registry). Источник правды для сервера и клиента.
//
// Станции пекарни, цветочной лавки и музыкальной школы — отдельные страницы со своими локальными
// координатами. Сервер не доверяет полю stationId из npc_talk: игрок «входит» в станцию сообщением
// station_enter, и сервер сам проверяет, что его последняя принятая мировая позиция лежит у входа.
// После этого позиция внутри станции приходит в station_pos (локальные координаты), а расстояние до NPC
// проверяется здесь же. Пожарная часть стоит прямо в городе: Маруся лежит в world.json и сюда не входит.

import {
  BAKERY_ENTRANCE,
  FLORIST_ENTRANCE,
  MUSIC_SCHOOL_ENTRANCE,
} from '../client/engine/city-entrance.js';

/** Насколько дальше радиуса входа сервер ещё считает игрока «у двери» (сохранённая позиция и пакеты pos запаздывают). */
export const ENTRANCE_SLACK = 4;
/** Запас к радиусу разговора на стороне сервера: клиент проверяет радиус по своей актуальной позиции, сервер — по последней принятой. */
export const TALK_SLACK = 1.5;

/** Идентификаторы заданий станций (task_progress). */
export const STATION_TASK_IDS = Object.freeze({
  bakery: 'bakery_station_v1',
  florist: 'florist_station_v1',
  pianist: 'pianist_station_v1',
});

const station = (def) => Object.freeze({ ...def, entrance: Object.freeze({ x: def.entrance.x, z: def.entrance.z, radius: def.entrance.radius }) });

/**
 * Станции с локальной системой координат. `bounds` — пол комнаты (метры, локальные координаты станции),
 * `spawn` — где игрок появляется при входе (позиция до первого station_pos).
 */
export const STATIONS = Object.freeze({
  bakery: station({
    id: 'bakery',
    label: 'Пекарня',
    page: '/bakery-preview.html',
    entrance: BAKERY_ENTRANCE,
    bounds: Object.freeze({ minX: -8.5, maxX: 8.5, minZ: -6.5, maxZ: 6.5 }),
    spawn: Object.freeze({ x: 0, z: 4.25 }),
    taskId: STATION_TASK_IDS.bakery,
  }),
  florist: station({
    id: 'florist',
    label: 'Цветочная лавка',
    page: '/florist-preview.html',
    entrance: FLORIST_ENTRANCE,
    bounds: Object.freeze({ minX: 0, maxX: 20, minZ: 0, maxZ: 15 }),
    spawn: Object.freeze({ x: 6, z: 4 }),
    taskId: STATION_TASK_IDS.florist,
  }),
  pianist: station({
    id: 'pianist',
    label: 'Музыкальная школа',
    page: '/musician-preview.html',
    entrance: MUSIC_SCHOOL_ENTRANCE,
    bounds: Object.freeze({ minX: 0, maxX: 20, minZ: 0, maxZ: 15 }),
    spawn: Object.freeze({ x: 10, z: 4.2 }),
    taskId: STATION_TASK_IDS.pianist,
  }),
});

/**
 * Диалоговые наставники станций. Координаты — в системе станции. `talkRadius` — расстояние, с которого
 * клиент показывает «E — поговорить»; сервер принимает npc_talk с radius + TALK_SLACK. Для Лилии x/z — точка у стойки,
 * от которой считается E в сцене (сама Лилия стоит за стойкой, z = 1.18).
 * service: 'dialogue' — свободный разговор через общую Ollama (reply()). Радио-редактор сюда не входит:
 * это не собеседник, а ИИ-сервис подготовки сценариев (см. AI_SERVICES).
 */
export const STATION_NPCS = Object.freeze([
  Object.freeze({ agentId: 'baker', stationId: 'bakery', name: 'Мастер-пекарь', x: -6.0, z: 4.15, talkRadius: 2.6, service: 'dialogue' }),
  Object.freeze({ agentId: 'lilia', stationId: 'florist', name: 'Лилия', x: 10, z: 3.45, talkRadius: 1.8, service: 'dialogue' }),
  Object.freeze({ agentId: 'maestro', stationId: 'pianist', name: 'Маэстро Артём', x: 6.2, z: 3.2, talkRadius: 1.9, service: 'dialogue' }),
]);

/**
 * ИИ-сервисы, не являющиеся собеседниками. Радио-редактор сам выбирает категорию и тему, готовит сценарий
 * через общую Ollama (generateRadioScript) и при сбое использует документированный локальный fallback.
 */
export const AI_SERVICES = Object.freeze([
  Object.freeze({
    id: 'radio_editor',
    name: 'ИИ-редактор радиостанции',
    stationLabel: 'Радиостанция',
    taskId: 'radio_station_v1',
    kind: 'script_editor',
    offlineFallback: true,
    description: 'Выбирает категорию и тему выпуска, готовит сценарий до эфира. Без Ollama используется локальный учебный сценарий.',
  }),
]);

export const stationById = (id) => (typeof id === 'string' && Object.hasOwn(STATIONS, id) ? STATIONS[id] : null);
export const stationNpcs = (stationId) => STATION_NPCS.filter((n) => n.stationId === stationId);
export const stationNpcByAgent = (agentId) => STATION_NPCS.find((n) => n.agentId === agentId) ?? null;

/** Находится ли мировая точка достаточно близко к входу станции, чтобы начать в ней сессию. */
export function nearEntrance(st, x, z) {
  return Number.isFinite(x) && Number.isFinite(z) && Math.hypot(x - st.entrance.x, z - st.entrance.z) <= st.entrance.radius + ENTRANCE_SLACK;
}

export const clampToStation = (st, x, z) => ({
  x: Math.min(st.bounds.maxX, Math.max(st.bounds.minX, x)),
  z: Math.min(st.bounds.maxZ, Math.max(st.bounds.minZ, z)),
});

/** Может ли игрок в точке (x, z) станции заговорить с NPC (серверная проверка, с запасом на запаздывание позиции). */
export const withinTalkRange = (npc, x, z) => Math.hypot(npc.x - x, npc.z - z) <= npc.talkRadius + TALK_SLACK;

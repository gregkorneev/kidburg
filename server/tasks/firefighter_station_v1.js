// Серверное задание станции «Пожарный»: прогресс в SQLite (task_progress) по авторизованному userId.
// Правила переходов — чистый автомат клиентского state.js (одна копия правил). Здесь добавляются
// то, что клиенту доверять нельзя: владелец прогресса, позиция игрока, направление и частота.
// Из payload читаются только `action` и (для window_hit) `index`, причём индекс проверяется;
// state, progress, done, координаты и userId игнорируются.
//
// Обработчик синхронный (better-sqlite3), поэтому два действия одного игрока не перемешиваются.

import {
  WINDOW_COUNT,
  WINDOW_HIT_LIMIT,
  createInitialState,
  transitionTask,
} from '../../client/stations/firefighter/state.js';
import { VERTICAL_TOLERANCE, WORLD_POINTS, WORLD_WINDOWS, toLocal } from '../../client/stations/firefighter/layout.js';
import { insideSafetyZone } from '../../client/stations/firefighter/safety-zone.js';

export const FIREFIGHTER_TASK_ID = 'firefighter_station_v1';
export const FIRE_HIT_COOLDOWN_MS = 120;
/** Допустимое отклонение взгляда игрока от направления на окно при `window_hit` (рад). */
export const AIM_TOLERANCE_RAD = 0.45;
/** Ближе этого расстояния до окна направление не определено (м). */
export const MIN_AIM_DISTANCE = 0.5;

/** Какой точкой ограничено каждое действие. Для window_hit дополнительно проверяется взгляд на окно `index`. */
const POINT_BY_ACTION = Object.freeze({
  start: 'npc',
  accept_briefing: 'npc',
  equip: 'locker',
  window_hit: 'hose',
  pickup_mannequin: 'mannequin',
  deliver_mannequin: 'safe_zone',
  report: 'npc',
  repeat: 'npc',
});

const STAGES = ['not_started', 'briefing', 'equipping', 'fire_drill', 'rescue', 'debrief', 'completed'];
const stageIndex = (stage) => STAGES.indexOf(stage);
const FIRE_DRILL = stageIndex('fire_drill');
const RESCUE = stageIndex('rescue');

/** Предел попаданий в записях старого формата (одна учебная мишень, поле `fireHits`). */
const LEGACY_FIRE_HIT_LIMIT = 18;

const STORAGE_ERROR = 'Сервер не смог сохранить прогресс. Действие не засчитано, попробуйте ещё раз.';

/** Кого из NPC и как описывает это задание для разговора (см. describeForAgent). */
export const FIREFIGHTER_AGENT_ID = 'marusya';

const STAGE_LABELS = Object.freeze({
  not_started: 'знакомство',
  briefing: 'инструктаж',
  equipping: 'экипировка',
  fire_drill: 'тушение окон',
  rescue: 'перенос манекена',
  debrief: 'итог смены',
  completed: 'смена завершена',
});

const finite = (v) => Number.isFinite(v);

const isFlag = (v) => typeof v === 'boolean';
const isHits = (v) => Number.isInteger(v) && v >= 0 && v <= WINDOW_HIT_LIMIT;

/**
 * Окна старой записи: прогресс по единственной мишени (0..18) переносится на четыре окна
 * пропорционально и заполняет их по порядку. Завершённая мишень — все окна потушены.
 */
function windowsFromLegacy(stage, fireHits) {
  if (stageIndex(stage) >= RESCUE) return Array.from({ length: WINDOW_COUNT }, () => WINDOW_HIT_LIMIT);
  let left = Math.round((fireHits / LEGACY_FIRE_HIT_LIMIT) * WINDOW_COUNT * WINDOW_HIT_LIMIT);
  return Array.from({ length: WINDOW_COUNT }, () => {
    const hits = Math.min(WINDOW_HIT_LIMIT, left);
    left -= hits;
    return hits;
  });
}

/**
 * Сохранённая запись -> актуальное состояние или null, если запись повреждена.
 * Формат 2: `windows` — массив из WINDOW_COUNT целых 0..WINDOW_HIT_LIMIT (число попаданий по окну).
 * Формат 1 (до окон): `fireHits` 0..18 без `windows` — переносится в память при чтении, база не меняется
 * до следующего сохранённого действия игрока.
 * Этап должен соответствовать окнам: до fire_drill все окна нетронуты, в fire_drill хоть одно не потушено,
 * после — все потушены.
 */
export function restoreState(raw) {
  if (raw === null || typeof raw !== 'object' || !STAGES.includes(raw.stage)) return null;
  if (!isFlag(raw.equipped) || !isFlag(raw.carryingMannequin) || !isFlag(raw.mannequinDelivered)) return null;
  const stage = stageIndex(raw.stage);

  let windows;
  if (raw.windows === undefined) {
    const { fireHits } = raw;
    if (!Number.isInteger(fireHits) || fireHits < 0 || fireHits > LEGACY_FIRE_HIT_LIMIT) return null;
    if (stage < FIRE_DRILL && fireHits !== 0) return null;
    if (stage === FIRE_DRILL && fireHits >= LEGACY_FIRE_HIT_LIMIT) return null;
    if (stage > FIRE_DRILL && fireHits !== LEGACY_FIRE_HIT_LIMIT) return null;
    windows = windowsFromLegacy(raw.stage, fireHits);
  } else {
    if (!Array.isArray(raw.windows) || raw.windows.length !== WINDOW_COUNT || !raw.windows.every(isHits)) return null;
    windows = [...raw.windows];
  }

  const done = windows.filter((hits) => hits === WINDOW_HIT_LIMIT).length;
  if (stage < FIRE_DRILL && windows.some((hits) => hits !== 0)) return null;
  if (stage === FIRE_DRILL && done === WINDOW_COUNT) return null;
  if (stage >= RESCUE && done !== WINDOW_COUNT) return null;

  return {
    stage: raw.stage,
    equipped: raw.equipped,
    windows,
    carryingMannequin: raw.carryingMannequin,
    mannequinDelivered: raw.mannequinDelivered,
  };
}

/** Только известные поля: лишнее из базы клиенту не отдаётся. */
function cleanState(state) {
  const { stage, equipped, windows, carryingMannequin, mannequinDelivered } = state;
  return { stage, equipped, windows: [...windows], carryingMannequin, mannequinDelivered };
}

const reply = (state, feedback = '', changed = false, error) => ({
  state: cleanState(state),
  done: state.stage === 'completed',
  feedback,
  changed,
  ...(error ? { error } : {}),
});

/** Центр игрока в локальных координатах полигона: радиус 0, граница зоны допускается. */
function zoneCoordinates(position) {
  const { x, z } = toLocal(position.x, position.z);
  return [x, z, 0];
}

function horizontalDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function isNear(position, point) {
  return (
    finite(position?.x) &&
    finite(position?.y) &&
    finite(position?.z) &&
    horizontalDistance(position, point) <= point.radius &&
    Math.abs(position.y - point.y) <= VERTICAL_TOLERANCE
  );
}

/** Смотрит ли игрок (yaw: 0 вдоль −Z, как в протоколе) на точку в пределах допуска. */
function isAimedAt(position, yaw, point) {
  if (!finite(yaw)) return false;
  const dx = point.x - position.x;
  const dz = point.z - position.z;
  if (Math.hypot(dx, dz) < MIN_AIM_DISTANCE) return false;
  const wanted = Math.atan2(-dx, -dz);
  const delta = Math.atan2(Math.sin(wanted - yaw), Math.cos(wanted - yaw));
  return Math.abs(delta) <= AIM_TOLERANCE_RAD;
}


/**
 * Описание хода тренировки для наставника в разговоре: собирается из сохранённого в SQLite состояния
 * по перечислениям и числам, строк игрока в нём нет. Модель может предлагать действия, но выполняет их
 * только игрок через task_answer, поэтому текст прямо говорит, что засчитано, а что нет.
 */
export function describeState(state) {
  const done = state.windows.filter((hits) => hits === WINDOW_HIT_LIMIT).length;
  const partial = state.windows.filter((hits) => hits > 0 && hits < WINDOW_HIT_LIMIT).length;
  const gear = state.equipped ? 'экипировку игрок уже надел' : 'экипировку игрок ещё не надел';
  const windows = `окон потушено ${done} из ${WINDOW_COUNT}${partial ? `, ещё ${partial} в процессе` : ''}`;
  const mannequin = state.mannequinDelivered
    ? 'манекен доставлен в безопасную зону'
    : state.carryingMannequin
      ? 'манекен поднят и несётся к зелёной отметке'
      : 'манекен ещё не поднят';
  const byStage = {
    not_started: 'Тренировка ещё не начата: игрок только пришёл к тебе. Чтобы начать, он сам нажмёт кнопку «Начать тренировку».',
    briefing: 'Игрок начал тренировку и сейчас слушает твой инструктаж. Когда ему всё понятно, он сам нажмёт «Понятно, к экипировке».',
    equipping: `Инструктаж пройден. ${gear[0].toUpperCase()}${gear.slice(1)}: её надевают в шкафу у полигона, не у тебя.`,
    fire_drill: `Игрок на учебном полигоне: ${gear}, ${windows}. Он тушит окна учебной стены из учебного рукава.`,
    rescue: `Все окна учебной стены потушены (${done} из ${WINDOW_COUNT}), экипировка надета, ${mannequin}. Осталось отнести манекен к зелёной отметке.`,
    debrief: 'Манекен доставлен, окна потушены, экипировка надета. Игрок вернулся к тебе за итогом и сам нажмёт «Завершить смену».',
    completed: 'Учебная смена полностью завершена: экипировка надета, все четыре окна потушены, манекен доставлен, итог подведён. Игрок может узнать больше о профессии или сам нажать «Повторить смену»: тогда начнётся новая смена с инструктажа.',
  };
  const text = [
    `Этап: ${STAGE_LABELS[state.stage]}.`,
    byStage[state.stage],
    'Порядок тренировки: инструктаж, экипировка в шкафу, тушение четырёх окон учебной стены, перенос манекена к зелёной отметке, итог у тебя.',
    'Кнопки и действия в игре выполняет только игрок: ты можешь предложить нажать нужную, но не нажимаешь её сам и не говоришь, что действие засчитано, если этого нет выше. Это учебная игра, а не инструкция для настоящего пожара.',
  ].join(' ');
  return { key: state.stage, label: STAGE_LABELS[state.stage], text };
}

/**
 * @param {object} deps
 * @param {{getTaskProgress: Function, saveTaskProgress: Function}} deps.db
 * @param {() => number} [deps.now]
 * @param {{warn?: Function, error?: Function}} [deps.log]
 * @param {typeof WORLD_POINTS} [deps.points] мировые точки станции (тестам нужны свои)
 * @param {typeof WORLD_WINDOWS} [deps.windows] мировые центры окон учебной стены
 */
export function createFirefighterTask({ db, now = Date.now, log = console, points = WORLD_POINTS, windows = WORLD_WINDOWS }) {
  const lastHitAt = new Map();

  function load(userId) {
    const saved = db.getTaskProgress(userId, FIREFIGHTER_TASK_ID);
    return (saved && restoreState(saved.state)) || createInitialState();
  }

  return {
    taskId: FIREFIGHTER_TASK_ID,
    agentId: FIREFIGHTER_AGENT_ID,

    /** Описание хода тренировки для разговора с Марусей: {key, label, text} из сохранённого состояния. */
    describe(userId) {
      return describeState(load(userId));
    },

    /** Сохранённое состояние (после hello и переподключения). Бросает, если база недоступна. */
    getState(userId) {
      return reply(load(userId));
    },

    /**
     * Одно намерение игрока. `context` — только данные сервера: { position: {x, y, z}, yaw }.
     * Не бросает при сбое записи: возвращает прежнее состояние с error: 'storage'.
     */
    handle(userId, payload, context) {
      if (!Number.isInteger(userId) || userId <= 0) throw new TypeError('нужен userId авторизованного соединения');
      const state = load(userId);
      const action = payload !== null && typeof payload === 'object' && typeof payload.action === 'string' ? payload.action : '';
      if (action === 'resume') return reply(state);
      if (!Object.hasOwn(POINT_BY_ACTION, action)) return reply(state, 'Это действие сейчас недоступно.');

      // Из payload берётся только индекс окна; transitionTask сам отвергает всё, кроме целого 0..WINDOW_COUNT-1.
      const index = action === 'window_hit' ? payload.index : undefined;
      const transition = transitionTask(state, { type: action, index });
      if (!transition.changed) return reply(state, transition.feedback);

      const position = context?.position;
      if (!isNear(position, points[POINT_BY_ACTION[action]])) {
        return reply(state, 'Подойдите к нужному объекту, чтобы выполнить действие.');
      }
      const t = now();
      if (action === 'window_hit') {
        if (insideSafetyZone(...zoneCoordinates(position))) return reply(state, 'Не пересекайте ограничительную линию!');
        if (!isAimedAt(position, context?.yaw, windows[index])) return reply(state, 'Направьте учебный рукав на окно.');
        const last = lastHitAt.get(userId);
        if (last !== undefined && t - last < FIRE_HIT_COOLDOWN_MS) return reply(state);
      }

      const next = transition.state;
      try {
        db.saveTaskProgress(userId, FIREFIGHTER_TASK_ID, { state: cleanState(next), done: next.stage === 'completed' }, t);
      } catch (err) {
        log.error?.({ err, userId }, 'не удалось сохранить прогресс задания');
        return reply(state, STORAGE_ERROR, false, 'storage');
      }
      if (action === 'window_hit') lastHitAt.set(userId, t);
      return reply(next, transition.feedback, true);
    },

    forget(userId) {
      lastHitAt.delete(userId);
    },
  };
}

export const STORAGE_ERROR_TEXT = STORAGE_ERROR;

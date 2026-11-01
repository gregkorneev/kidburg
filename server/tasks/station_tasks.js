// Серверное подтверждение прогресса станций «Пекарня», «Цветочная лавка» и «Музыкальная школа».
//
// Правила переходов — те же чистые автоматы, что играет клиент (state.js каждой станции): одна копия правил.
// Клиент по-прежнему сразу показывает результат (звук, анимация), но каждое действие дублирует сюда
// через task_answer. Сервер хранит состояние в task_progress и проверяет то, чему клиент доверять не может:
// владельца прогресса, нахождение в станции (station_enter) и расстояние до нужного объекта по позиции
// из station_pos. Из payload читаются только `action` и отдельные поля действия (flower, ribbon, note);
// stage, index, stems, done и координаты игнорируются. Факты для разговора с наставником (describe)
// берутся только из этого сохранённого состояния, а не из текста или context клиента.

import { OBJECTIVES, STAGES as BAKERY_STAGES, applyBakeryAction, createInitialState as bakeryInitial } from '../../client/stations/bakery/state.js';
import { ZONES } from '../../client/stations/bakery/layout.js';
import { FLOWERS, ORDER, RIBBONS, STAGES as FLORIST_STAGES, createInitialState as floristInitial, orderMatches, transitionTask as floristTransition } from '../../client/stations/florist/state.js';
import { LESSON, MELODY, noteById } from '../../client/stations/pianist/melody.js';
import { STAGES as PIANIST_STAGES, STAGE_LABELS as PIANIST_LABELS, createInitialState as pianistInitial, transitionTask as pianistTransition } from '../../client/stations/pianist/state.js';
import { STATIONS, STATION_NPCS, STATION_TASK_IDS, TALK_SLACK } from '../../shared/station-npcs.js';

/** Запас к радиусу взаимодействия: позиция на сервере запаздывает относительно клиента. */
export const ACTION_SLACK = TALK_SLACK;

const STORAGE_ERROR = 'Сервер не смог сохранить прогресс. Действие не засчитано, попробуйте ещё раз.';
const NOT_IN_STATION = 'Сервер не видит вас внутри станции. Обновите страницу и войдите через город.';
const TOO_FAR = 'Подойдите к нужному объекту, чтобы выполнить действие.';

/** Точки взаимодействия (локальные координаты станции) для проверки расстояния. Совпадение с планами сцен проверяет тест. */
export const FLORIST_POINTS = Object.freeze({
  lilia: Object.freeze({ x: 10, z: 3.45 }),
  handoff: Object.freeze({ x: 4, z: 3.4 }),
  buckets: Object.freeze({
    pink_tulip: Object.freeze({ x: 2.45, z: 5.0 }),
    white_daisy: Object.freeze({ x: 2.45, z: 10.2 }),
    red_rose: Object.freeze({ x: 17.55, z: 5.0 }),
    greenery: Object.freeze({ x: 17.55, z: 10.2 }),
  }),
  desks: Object.freeze({
    workbench: Object.freeze({ x: 10, z: 8.0, width: 5.8, depth: 2.0 }),
    wrapping: Object.freeze({ x: 16, z: 12.1, width: 3.0, depth: 1.4 }),
  }),
  radius: 1.72,
});

export const PIANIST_POINTS = Object.freeze({
  maestro: Object.freeze({ x: 6.2, z: 3.2 }),
  practicePiano: Object.freeze({ x: 15.2, z: 4.5 }),
  stagePiano: Object.freeze({ x: 10.8, z: 12.55 }),
  maestroRadius: 1.85,
  pianoRadius: 2.5,
});

const finite = (v) => Number.isFinite(v);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const deskDistance = (desk, p) =>
  Math.hypot(Math.max(0, Math.abs(p.x - desk.x) - desk.width / 2), Math.max(0, Math.abs(p.z - desk.z) - desk.depth / 2));

const near = (point, position, radius) => finite(position?.x) && finite(position?.z) && distance(point, position) <= radius + ACTION_SLACK;

/**
 * Общая оболочка: загрузка и сохранение в task_progress, привязка к станции, формат ответа как у других заданий.
 * @param {object} cfg
 * @param {string} cfg.taskId
 * @param {string} cfg.agentId наставник, чьи разговоры получают описание хода
 * @param {string} cfg.stationId
 * @param {() => object} cfg.initial
 * @param {(raw: unknown) => object|null} cfg.restore сохранённая запись -> состояние или null
 * @param {(state: object) => object} cfg.serialize только известные поля
 * @param {(state: object, payload: object, position: object) => {state: object, changed: boolean, feedback: string, tooFar?: boolean}} cfg.apply
 * @param {(state: object) => {key: string, label: string, text: string}} cfg.describe
 * @param {(state: object) => object|null} [cfg.onEnter] поправка состояния при новой сессии станции (null — без изменений)
 */
function createStationTask({ taskId, agentId, stationId, initial, restore, serialize, apply, describe, onEnter }) {
  return function create({ db, now = Date.now, log = console }) {
    const load = (userId) => {
      const saved = db.getTaskProgress(userId, taskId);
      return (saved && restore(saved.state)) || initial();
    };
    const reply = (state, feedback = '', changed = false, error) => ({
      state: serialize(state),
      done: state.stage === 'completed',
      feedback,
      changed,
      ...(error ? { error } : {}),
    });
    return {
      taskId,
      agentId,
      stationId,
      describe: (userId) => describe(load(userId)),
      /** Новая сессия станции (station_enter): временные признаки, живущие только в браузере, сбрасываются. */
      enterStation(userId) {
        const fixed = onEnter?.(load(userId));
        if (!fixed) return;
        try {
          db.saveTaskProgress(userId, taskId, { state: serialize(fixed), done: fixed.stage === 'completed' }, now());
        } catch (err) {
          log.error?.({ err, userId, taskId }, 'не удалось обновить прогресс при входе в станцию');
        }
      },
      getState: (userId) => reply(load(userId)),
      handle(userId, payload, context) {
        if (!Number.isInteger(userId) || userId <= 0) throw new TypeError('нужен userId авторизованного соединения');
        const state = load(userId);
        const request = isObject(payload) ? payload : {};
        if (request.action === 'resume') return reply(state);
        if (typeof request.action !== 'string') return reply(state, 'Это действие сейчас недоступно.');
        // Игрок должен быть внутри именно этой станции: сессию создаёт сервер (station_enter), а не страница.
        const session = context?.station;
        if (!session || session.id !== stationId) return reply(state, NOT_IN_STATION);
        const result = apply(state, request, { x: session.x, z: session.z });
        if (!result.changed) return reply(state, result.tooFar ? TOO_FAR : result.feedback);
        try {
          db.saveTaskProgress(userId, taskId, { state: serialize(result.state), done: result.state.stage === 'completed' }, now());
        } catch (err) {
          log.error?.({ err, userId, taskId }, 'не удалось сохранить прогресс станции');
          return reply(state, STORAGE_ERROR, false, 'storage');
        }
        return reply(result.state, result.feedback, true);
      },
    };
  };
}

// Утверждения, которые на соответствующем этапе были бы ложью. Станционный наставник перегенерирует ответ,
// начало которого им противоречит (server/agents/index.js, `situation.avoid`). Отрицание («не выступил») не считается.
const NOT = '(?<!не\\s)(?<!ещё\\s)(?<!еще\\s)(?<!пока\\s)';
const claim = (...words) => `${NOT}(?<!\\p{L})(${words.join('|')})`;

/** Явные списки «сделано / не сделано»: малая модель не должна додумывать успехи. */
function progressText({ label, plan, passed, now, rule }) {
  return [
    `Этап: ${label}.`,
    `Уже сделано: ${plan.slice(0, passed).join(', ') || 'пока ничего'}.`,
    `Ещё НЕ сделано: ${plan.slice(passed).join(', ') || 'ничего, всё выполнено'}.`,
    `Сейчас: ${now}.`,
    rule,
  ].join(' ');
}

// Общие признаки сбоя малой модели: «всё уже пройдено» без опоры на ход и пересказ служебных правил / латиница-мусор.
const CLAIM_ALL = [
  `${NOT}(?<!\\p{L})(выполнил\\p{L}*|прошёл|прошел|прошла|прошли|сделал\\p{L}*|освоил\\p{L}*)\\s+(уже\\s+)?(все|весь)\\s+(шаги|этапы|требования|условия|пункты|цикл|задани\\p{L}*|урок)`,
  `(все|всё)\\s+(шаги|этапы)\\s+(уже\\s+)?(пройдены|выполнены|сделаны)`,
  'всё\\s+(уже\\s+)?сделано',
];
const LEAK = ['[«"]\\s*(ещё|еще)\\s+не\\s+сделано', '(уже|ещё|еще)\\s+(не\\s+)?сделано\\s*:', '(?<![\\p{L}\\d])[a-z]{5,}(?![\\p{L}\\d])'];

/** К таблице «этап → ложные утверждения» добавляются общие признаки сбоя (на последнем этапе — только мусор и пересказ правил). */
const withCommon = (table) =>
  Object.freeze(Object.fromEntries(Object.entries(table).map(([stage, list]) => [stage, [...list, ...(stage === 'completed' ? [] : CLAIM_ALL), ...LEAK]])));

// ── Пекарня ───────────────────────────────────────────────────────────────────────────────────

const BAKERY_PLAN = ['получение заказа', 'подготовка ингредиентов', 'формовка хлеба', 'выпечка в закрытой печи', 'забор хлеба с охлаждающей полки', 'сдача заказа пекарю'];
const BAKERY_CLAIMS = Object.freeze({
  order: [claim('получил\\p{L}*', 'взял\\p{L}*', 'принял\\p{L}*') + '\\s+(уже\\s+)?(этот\\s+|свой\\s+)?заказ', claim('прошёл', 'прошел', 'прошла') + '\\s+(уже\\s+)?(важный|первый)\\s+этап'],
  ingredients: [claim('подготовил\\p{L}*', 'приготовил\\p{L}*', 'замесил\\p{L}*', 'отмерил\\p{L}*') + '\\s+(уже\\s+)?(все\\s+)?(ингредиент|тест|продукт)', 'ингредиент\\p{L}*\\s+(уже\\s+)?(готов|подготовлен)'],
  shaped: [claim('сформовал\\p{L}*', 'сформировал\\p{L}*', 'слепил\\p{L}*', 'вылепил\\p{L}*', 'отформовал\\p{L}*') + '', 'хлеб\\p{L}*\\s+(уже\\s+)?(сформован|сформирован)', 'тест\\p{L}*\\s+(уже\\s+)?(замешан|сформирован|сформован)'],
  baked: [claim('испёк', 'испек', 'испекла', 'выпек', 'выпекла', 'запёк', 'запек', 'запекла') + '', 'хлеб\\p{L}*\\s+(уже\\s+)?(выпечен|испечён|испечен|готов\\s+и)', 'хлеб\\p{L}*\\s+(только\\s+|уже\\s+)?выключил\\p{L}*\\s+из\\s+печ', 'в\\s+печ\\p{L}+\\s+(уже\\s+)?(побывал|выпек)', claim('положил\\p{L}*', 'поставил\\p{L}*', 'заложил\\p{L}*', 'отправил\\p{L}*') + '[^.!?]{0,40}\\s(внутрь|в\\s+печ|в\\s+духов)'],
  collected: [claim('забрал\\p{L}*', 'снял\\p{L}*', 'взял\\p{L}*') + '\\s+(уже\\s+)?(готовый\\s+)?хлеб'],
  delivered: [claim('сдал\\p{L}*', 'отдал\\p{L}*', 'передал\\p{L}*', 'выдал\\p{L}*') + '\\s+(уже\\s+)?(этот\\s+|весь\\s+|готовый\\s+)?(заказ|хлеб)', 'заказ\\p{L}*\\s+(уже\\s+)?(сдан|выполнен|выдан|передан)', claim('прошёл', 'прошел', 'прошла') + '\\s+(весь\\s+)?путь[^.!?]{0,80}сдач', 'уже\\s+сделал\\p{L}*[^.!?]{0,100}сдача\\s+(хлеба|заказа)', 'поздравл'],
});
const bakeryAvoid = (...keys) => keys.flatMap((k) => BAKERY_CLAIMS[k]);
export const BAKERY_AVOID = withCommon({
  waiting_order: bakeryAvoid('order', 'ingredients', 'shaped', 'baked', 'collected', 'delivered'),
  order_received: bakeryAvoid('ingredients', 'shaped', 'baked', 'collected', 'delivered'),
  ingredients_ready: bakeryAvoid('shaped', 'baked', 'collected', 'delivered'),
  product_shaped: bakeryAvoid('baked', 'collected', 'delivered'),
  product_baked: bakeryAvoid('collected', 'delivered'),
  product_ready: bakeryAvoid('delivered'),
  completed: [],
});

const BAKERY_ACTIONS = new Set(['get_order', 'prepare_ingredients', 'shape_product', 'use_oven', 'collect_product', 'deliver_order', 'repeat_order']);
const bakeryZone = (action) => ZONES.find((zone) => zone.action === (action === 'repeat_order' ? 'get_order' : action));

const BAKERY_DESCRIPTIONS = Object.freeze({
  waiting_order: 'Заказ ещё не получен: игрок только пришёл к пекарю. Заказ он получает сам у пекаря.',
  order_received: 'Заказ получен, ингредиенты ещё не подготовлены. Дальше игрок готовит ингредиенты у рабочей стойки слева.',
  ingredients_ready: 'Ингредиенты подготовлены, хлеб ещё не сформован. Дальше игрок формует хлеб на рабочем столе в центре.',
  product_shaped: 'Хлеб сформован, но ещё не выпечен. Дальше игрок кладёт изделие в закрытую печь справа.',
  product_baked: 'Хлеб выпечен, но игрок его ещё не забрал. Дальше игрок берёт готовый хлеб с охлаждающей полки.',
  product_ready: 'Готовый хлеб у игрока, но заказ ещё не сдан. Дальше игрок передаёт заказ пекарю у стойки выдачи.',
  completed: 'Заказ полностью выполнен и передан пекарю. Игрок может принять новый заказ.',
});

export const createBakeryTask = createStationTask({
  taskId: STATION_TASK_IDS.bakery,
  agentId: 'baker',
  stationId: 'bakery',
  initial: () => bakeryInitial(),
  restore: (raw) => {
    if (!isObject(raw) || !BAKERY_STAGES.includes(raw.stage)) return null;
    if (!Number.isInteger(raw.completedOrders) || raw.completedOrders < 0 || raw.completedOrders > 10_000) return null;
    return { stage: raw.stage, completedOrders: raw.completedOrders };
  },
  serialize: (state) => ({ stage: state.stage, completedOrders: state.completedOrders }),
  apply: (state, request, position) => {
    const action = request.action;
    if (!BAKERY_ACTIONS.has(action)) return { state, changed: false, feedback: 'Это действие сейчас недоступно.' };
    const result = applyBakeryAction(state, action);
    if (!result.accepted) return { state, changed: false, feedback: result.feedback };
    const zone = bakeryZone(action);
    if (!zone || !near(zone, position, zone.radius)) return { state, changed: false, feedback: TOO_FAR, tooFar: true };
    return { state: result.state, changed: true, feedback: result.feedback };
  },
  describe: (state) => {
    const orders = state.completedOrders > 0 ? ` Уже выполнено заказов: ${state.completedOrders}.` : '';
    const label = OBJECTIVES[state.stage] ?? state.stage;
    return {
      key: state.stage,
      label,
      avoid: BAKERY_AVOID[state.stage],
      text: progressText({
        label: label.replace(/\.$/, ''),
        plan: BAKERY_PLAN,
        passed: Math.max(0, BAKERY_STAGES.indexOf(state.stage)),
        now: BAKERY_DESCRIPTIONS[state.stage],
        rule: '(Правило для тебя, игроку его не пересказывай: хвалить можно только за «Уже сделано»; шаги у рабочих мест делает только игрок, ты подсказываешь, куда идти.)',
      }) + orders,
    };
  },
});

// ── Цветочная лавка ───────────────────────────────────────────────────────────────────────────

const FLORIST_ACTIONS = new Set(['start_briefing', 'accept_order', 'take_flower', 'add_flower', 'remove_last', 'choose_ribbon', 'wrap', 'handoff', 'repeat']);
const FLORIST_LABELS = Object.freeze({
  not_started: 'знакомство',
  briefing: 'инструктаж',
  collecting: 'сбор букета',
  wrapping: 'упаковка',
  handoff: 'выдача заказа',
  completed: 'заказ выдан',
});

const FLORIST_PLAN = ['инструктаж Лилии', 'принятие заказа', 'сбор букета из пяти стеблей', 'упаковка букета лентой', 'выдача заказа на стойке'];
const FLORIST_CLAIMS = Object.freeze({
  accepted: [claim('принял\\p{L}*', 'взял\\p{L}*', 'согласился', 'согласилась') + '\\s+(уже\\s+)?(этот\\s+|мой\\s+|наш\\s+)?заказ'],
  bouquet: [claim('собрал\\p{L}*', 'составил\\p{L}*', 'сделал\\p{L}*', 'придумал\\p{L}*', 'расставил\\p{L}*') + '\\s+(уже\\s+)?(весь\\s+|свой\\s+|этот\\s+|идеальн\\p{L}+\\s+)?(букет|композици)(?!\\p{L}*\\s+из\\s)', 'букет\\p{L}*\\s+(уже\\s+)?(собран|готов|составлен|соответствует)'],
  // «Букет (с тобой) собран / упакован / готов»: не больше двух слов между, отрицание («пока не собран») не считается.
  bouquetState: ['букет\\p{L}*(\\s+\\p{L}+){0,2}\\s+' + NOT + '(собран|упакован|готов)(?!\\p{L})'],
  stemsFull: [NOT + '(?<!\\d)5\\s+из\\s+5', claim('уложил\\p{L}*', 'положил\\p{L}*', 'добавил\\p{L}*', 'поставил\\p{L}*') + '\\s+(уже\\s+)?(все|всех)\\s+(стебл|цвет)', claim('собрал\\p{L}*', 'уложил\\p{L}*', 'положил\\p{L}*', 'добавил\\p{L}*') + '\\s+(уже\\s+)?(все\\s+)?(5|пять)\\s+стебл', NOT + '(?<!из\\s)(?<!\\d)(5|пять)\\s+стебл\\p{L}*\\s+в\\s+(букете|руках)', 'стебл\\p{L}*\\s+(уже\\s+)?собран\\p{L}*'],
  bouquetStrict: [claim('собрал\\p{L}*', 'составил\\p{L}*', 'сделал\\p{L}*', 'придумал\\p{L}*', 'расставил\\p{L}*') + '\\s+(уже\\s+)?(весь\\s+|свой\\s+|этот\\s+|идеальн\\p{L}+\\s+)?(букет|композици)', 'цветы\\s+(уже\\s+)?собраны', claim('дошёл', 'дошел', 'дошла') + '\\s+до\\s+этапа\\s+(сбор|упаковк)', claim('положил\\p{L}*', 'поставил\\p{L}*') + '\\s+(уже\\s+)?цветы'],
  wrapped: [claim('упаковал\\p{L}*', 'перевязал\\p{L}*', 'завязал\\p{L}*') + '', 'букет\\p{L}*\\s+(уже\\s+)?(упакован|перевязан)', 'ленту\\s+(уже\\s+)?(выбрал|завязал)'],
  handed: [claim('выдал\\p{L}*', 'отдал\\p{L}*', 'сдал\\p{L}*', 'передал\\p{L}*') + '\\s+(уже\\s+)?(этот\\s+|весь\\s+|готовый\\s+)?(заказ|букет)', 'заказ\\p{L}*\\s+(уже\\s+)?(выдан|выполнен|сдан)', 'поздравл'],
});
const floristAvoid = (...keys) => keys.flatMap((k) => FLORIST_CLAIMS[k]);
export const FLORIST_AVOID = withCommon({
  not_started: floristAvoid('accepted', 'bouquetStrict', 'bouquetState', 'stemsFull', 'wrapped', 'handed'),
  briefing: floristAvoid('accepted', 'bouquetStrict', 'bouquetState', 'stemsFull', 'wrapped', 'handed'),
  collecting: floristAvoid('bouquet', 'bouquetState', 'stemsFull', 'wrapped', 'handed'),
  wrapping: floristAvoid('wrapped', 'handed'),
  handoff: floristAvoid('handed'),
  completed: [],
});

const isStem = (s) => isObject(s) && typeof s.id === 'string' && s.id.length <= 64 && Object.hasOwn(FLOWERS, s.type);

function restoreFlorist(raw) {
  if (!isObject(raw) || !FLORIST_STAGES.includes(raw.stage)) return null;
  const { stems, heldFlower } = raw;
  if (!Array.isArray(stems) || stems.length > ORDER.total || !stems.every(isStem)) return null;
  if (heldFlower !== null && !isStem(heldFlower)) return null;
  if (raw.ribbon !== null && !(typeof raw.ribbon === 'string' && Object.hasOwn(RIBBONS, raw.ribbon))) return null;
  if (typeof raw.wrapped !== 'boolean') return null;
  const early = ['not_started', 'briefing'].includes(raw.stage);
  if (early && (stems.length || heldFlower || raw.ribbon || raw.wrapped)) return null;
  if (raw.stage === 'wrapping' && (stems.length !== ORDER.total || heldFlower || raw.wrapped)) return null;
  if (raw.stage === 'collecting' && (stems.length >= ORDER.total || raw.wrapped || raw.ribbon)) return null;
  if (['handoff', 'completed'].includes(raw.stage) && (!raw.wrapped || !orderMatches(stems))) return null;
  return {
    stage: raw.stage,
    heldFlower: heldFlower ? { id: heldFlower.id, type: heldFlower.type } : null,
    stems: stems.map((s) => ({ id: s.id, type: s.type })),
    ribbon: raw.ribbon,
    wrapped: raw.wrapped,
  };
}

function floristPoint(action, state, request) {
  switch (action) {
    case 'start_briefing':
    case 'repeat':
      return { point: FLORIST_POINTS.lilia, radius: FLORIST_POINTS.radius };
    case 'take_flower':
      return Object.hasOwn(FLORIST_POINTS.buckets, request.flower) ? { point: FLORIST_POINTS.buckets[request.flower], radius: FLORIST_POINTS.radius } : null;
    case 'add_flower':
    case 'remove_last':
      return { desk: FLORIST_POINTS.desks.workbench };
    case 'wrap':
      return { desk: FLORIST_POINTS.desks.wrapping };
    case 'handoff':
      return { point: FLORIST_POINTS.handoff, radius: FLORIST_POINTS.radius };
    default:
      return null; // accept_order и choose_ribbon выбираются в окне / клавишей, не у объекта
  }
}

/** Что собрано в букете, словами и по данным сервера. */
export function describeBouquet(stems) {
  const counts = Object.create(null);
  for (const stem of stems) counts[stem.type] = (counts[stem.type] ?? 0) + 1;
  const parts = Object.keys(FLOWERS).filter((type) => counts[type]).map((type) => `${FLOWERS[type].label.toLowerCase()} — ${counts[type]}`);
  return parts.length ? parts.join(', ') : 'пока пусто';
}

export const createFloristTask = createStationTask({
  taskId: STATION_TASK_IDS.florist,
  agentId: 'lilia',
  stationId: 'florist',
  initial: () => floristInitial(),
  restore: restoreFlorist,
  serialize: (state) => ({
    stage: state.stage,
    heldFlower: state.heldFlower ? { id: state.heldFlower.id, type: state.heldFlower.type } : null,
    stems: state.stems.map((s) => ({ id: s.id, type: s.type })),
    ribbon: state.ribbon,
    wrapped: state.wrapped,
  }),
  apply: (state, request, position) => {
    const action = request.action;
    if (!FLORIST_ACTIONS.has(action)) return { state, changed: false, feedback: 'Это действие сейчас недоступно.' };
    const command = { type: action };
    if (action === 'take_flower') command.flower = typeof request.flower === 'string' ? request.flower : '';
    if (action === 'choose_ribbon') command.ribbon = typeof request.ribbon === 'string' ? request.ribbon : '';
    const result = floristTransition(state, command);
    if (!result.changed) return { state, changed: false, feedback: result.feedback };
    const target = floristPoint(action, state, request);
    if (target) {
      const ok = target.desk
        ? finite(position?.x) && finite(position?.z) && deskDistance(target.desk, position) <= FLORIST_POINTS.radius + ACTION_SLACK
        : near(target.point, position, target.radius);
      if (!ok) return { state, changed: false, feedback: TOO_FAR, tooFar: true };
    }
    return { state: result.state, changed: true, feedback: result.feedback };
  },
  describe: (state) => {
    const ribbon = state.ribbon ? RIBBONS[state.ribbon].toLowerCase() : 'не выбрана';
    const byStage = {
      not_started: 'Заказ ещё не принят: игрок только пришёл к Лилии. Букет не начат.',
      briefing: 'Лилия объясняет заказ. Игрок ещё не принял его.',
      collecting: `Игрок собирает букет: в букете ${state.stems.length} из ${ORDER.total} стеблей (${describeBouquet(state.stems)})${state.heldFlower ? `, в руке ещё ${FLOWERS[state.heldFlower.type].label.toLowerCase()}` : ''}.`,
      wrapping: `Пять стеблей собраны (${describeBouquet(state.stems)}); сервер проверил состав: ${orderMatches(state.stems) ? 'он совпадает с заказом' : 'он НЕ совпадает с заказом, букет нужно исправить'}. Лента: ${ribbon}. Букет ${state.wrapped ? 'упакован' : 'ещё не упакован'}.`,
      handoff: 'Правильный букет собран, ленточка выбрана и букет упакован. Остаётся отнести заказ на стойку выдачи.',
      completed: 'Заказ выполнен: букет собран, упакован и выдан. Игрок может начать новый заказ.',
    };
    return {
      key: state.stage,
      label: FLORIST_LABELS[state.stage],
      avoid: FLORIST_AVOID[state.stage],
      text: progressText({
        label: FLORIST_LABELS[state.stage],
        plan: FLORIST_PLAN,
        passed: { not_started: 0, briefing: 0, collecting: 2, wrapping: 3, handoff: 4, completed: 5 }[state.stage],
        now: byStage[state.stage],
        rule: `Условия заказа: ${ORDER.total} стеблей — 2 розовых тюльпана, 2 белые ромашки и 1 веточка зелени, лента розовая; если ошибся, можно убрать последний стебель. (Правило для тебя, игроку его не пересказывай: хвалить можно только за «Уже сделано»; верен ли букет, решает игра, цветы берёт и ставит только игрок.)`,
      }),
    };
  },
});

// ── Музыкальная школа ─────────────────────────────────────────────────────────────────────────

const PIANIST_ACTIONS = new Set(['start_briefing', 'accept', 'enter_piano', 'leave_piano', 'repeat', 'note']);
const noteLabels = (ids) => ids.map((id) => noteById(id).label).join(', ');
const sequenceFor = (stage) => (stage === 'learning' ? LESSON : MELODY);

function restorePianist(raw) {
  if (!isObject(raw) || !PIANIST_STAGES.includes(raw.stage) || !Number.isInteger(raw.index) || raw.index < 0) return null;
  const limit = ['learning', 'practice', 'concert'].includes(raw.stage) ? sequenceFor(raw.stage).length - 1 : MELODY.length;
  if (['not_started', 'briefing'].includes(raw.stage) ? raw.index !== 0 : raw.index > limit) return null;
  return { ...pianistInitial(), stage: raw.stage, index: raw.index, pianoMode: raw.pianoMode === true };
}

const CLAIM_CONCERT = [
  `${NOT}(?<!\\p{L})(выступил|выступила|выступал|выступала|исполнил|исполнила|отыграл|отыграла)`,
  'концерт\\p{L}*\\s+(уже\\s+|официально\\s+)?(прошёл|прошел|состоялся|завершён|окончен|закончен)',
  'урок\\p{L}*\\s+(с\\s+\\S+\\s+)?(уже\\s+|официально\\s+)?(окончен|закончен|завершён|пройден|прошёл|прошел)',
  `${NOT}(?<!\\p{L})(закончил|закончила|завершил|завершила|прошёл|прошел|прошла)\\s+(весь\\s+|этот\\s+|наш\\s+)?(урок|обучение)`,
  'аплодис',
];
const CLAIM_NOTES = [`${NOT}(?<!\\p{L})(выучил|выучила|освоил|освоила|научился|научилась)\\s+(все\\s+|уже\\s+)?(четыре\\s+)?ноты`];
const CLAIM_REHEARSAL = [`${NOT}(?<!\\p{L})(отрепетировал|отрепетировала)`, `${NOT}(?<!\\p{L})(сыграл|сыграла)\\s+(всю\\s+)?мелоди`];
const CLAIM_PLAYED = [`${NOT}(?<!\\p{L})(сыграл|сыграла|играл|играла)\\s+(уже\\s+)?(ноты|мелоди\\p{L}*|на\\s+пианино)`];
export const PIANIST_AVOID = withCommon({
  not_started: [...CLAIM_CONCERT, ...CLAIM_NOTES, ...CLAIM_REHEARSAL, ...CLAIM_PLAYED],
  briefing: [...CLAIM_CONCERT, ...CLAIM_NOTES, ...CLAIM_REHEARSAL, ...CLAIM_PLAYED],
  learning: [...CLAIM_CONCERT, ...CLAIM_NOTES, ...CLAIM_REHEARSAL],
  practice: [...CLAIM_CONCERT, ...CLAIM_REHEARSAL],
  concert: CLAIM_CONCERT,
  completed: [],
});

export const createPianistTask = createStationTask({
  taskId: STATION_TASK_IDS.pianist,
  agentId: 'maestro',
  stationId: 'pianist',
  initial: () => pianistInitial(),
  restore: restorePianist,
  serialize: (state) => ({ stage: state.stage, index: state.index, pianoMode: state.pianoMode === true }),
  // Режим «за пианино» живёт в браузере: при новом входе в станцию игрок стоит у Маэстро, а не за инструментом.
  onEnter: (state) => (state.pianoMode ? { ...state, pianoMode: false } : null),
  apply: (state, request, position) => {
    const action = request.action;
    if (!PIANIST_ACTIONS.has(action)) return { state, changed: false, feedback: 'Это действие сейчас недоступно.' };
    // Рабочее состояние автомата включает громкость и звук: на сервере они всегда значения по умолчанию.
    const command = { type: action };
    if (action === 'note') command.note = typeof request.note === 'string' ? request.note : '';
    if (action === 'enter_piano') {
      // Станция сцены определяется положением игрока по данным сервера, а не флагом из браузера.
      command.atStage = near(PIANIST_POINTS.stagePiano, position, PIANIST_POINTS.pianoRadius);
      const target = state.stage === 'concert' ? PIANIST_POINTS.stagePiano : PIANIST_POINTS.practicePiano;
      if (!near(target, position, PIANIST_POINTS.pianoRadius)) return { state, changed: false, feedback: TOO_FAR, tooFar: true };
    }
    // Повтор из итогового модального окна не требует ходьбы; completed проверен по серверному сохранению.
    const completedRepeat = action === 'repeat' && state.stage === 'completed';
    if ((action === 'start_briefing' || action === 'repeat') && !completedRepeat && !near(PIANIST_POINTS.maestro, position, PIANIST_POINTS.maestroRadius)) {
      return { state, changed: false, feedback: TOO_FAR, tooFar: true };
    }
    const result = pianistTransition(state, command);
    return { state: result.state, changed: result.changed, feedback: result.feedback };
  },
  describe: (state) => {
    const sequence = sequenceFor(state.stage);
    const done = state.index;
    const left = sequence.slice(done);
    const atPiano = state.pianoMode ? ' Игрок сейчас сидит за пианино.' : '';
    // Явные списки «сделано / не сделано»: малая модель не должна додумывать успехи.
    const plan = ['знакомство с Маэстро', 'изучение четырёх нот', 'репетиция мелодии', 'концерт на сцене'];
    const passed = { not_started: 0, briefing: 0, learning: 1, practice: 2, concert: 3, completed: 4 }[state.stage];
    const now = {
      not_started: 'игрок только пришёл к Маэстро, ни одной ноты не сыграно',
      briefing: 'игрок слушает вводный инструктаж Маэстро, ни одной ноты не сыграно',
      learning: `игрок учит четыре ноты (${noteLabels(LESSON)}), подряд верно сыграно ${done} из ${LESSON.length}${left.length ? `, следующая нота ${noteLabels(left.slice(0, 1))}` : ''}`,
      practice: `игрок репетирует мелодию из ${MELODY.length} нот (${noteLabels(MELODY)}), подряд верно сыграно ${done}${left.length ? `, осталось ${noteLabels(left)}` : ''}`,
      concert: `игрок должен выйти на сцену, сесть за сценическое пианино и сыграть мелодию, в этой попытке подряд верно сыграно ${done} из ${MELODY.length}`,
      completed: 'урок пройден полностью: игрок выступил на концерте, зал аплодировал; он может повторить урок',
    }[state.stage];
    return {
      key: state.stage,
      label: PIANIST_LABELS[state.stage],
      avoid: PIANIST_AVOID[state.stage],
      text: progressText({
        label: PIANIST_LABELS[state.stage],
        plan,
        passed,
        now: `${now}.${atPiano}`.replace(/\.\.$/, '.'),
        rule: '(Правило для тебя, игроку его не пересказывай: хвалить можно только за «Уже сделано»; ноты оценивает игра, а не ты.)',
      }),
    };
  },
});

export const STATION_TASK_FACTORIES = Object.freeze({
  [STATION_TASK_IDS.bakery]: createBakeryTask,
  [STATION_TASK_IDS.florist]: createFloristTask,
  [STATION_TASK_IDS.pianist]: createPianistTask,
});

// Контроль согласованности реестра при загрузке: у каждого диалогового NPC есть станция с заданием.
for (const npc of STATION_NPCS) {
  if (!Object.hasOwn(STATIONS, npc.stationId)) throw new Error(`station-npcs: у ${npc.agentId} нет станции ${npc.stationId}`);
}

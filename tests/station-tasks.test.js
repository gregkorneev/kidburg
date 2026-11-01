// Серверное подтверждение прогресса станций: полные прохождения, подделки и согласованность с планами сцен.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { openDb } from '../server/db/index.js';
import {
  BAKERY_AVOID,
  FLORIST_AVOID,
  PIANIST_AVOID,
  FLORIST_POINTS,
  PIANIST_POINTS,
  createBakeryTask,
  createFloristTask,
  createPianistTask,
  describeBouquet,
} from '../server/tasks/station_tasks.js';
import { AI_SERVICES, STATIONS, STATION_NPCS, STATION_TASK_IDS, nearEntrance, withinTalkRange } from '../shared/station-npcs.js';
import { BAKERY_ENTRANCE, FLORIST_ENTRANCE, MUSIC_SCHOOL_ENTRANCE } from '../client/engine/city-entrance.js';
import { ROOM as BAKERY_ROOM, SPAWN as BAKERY_SPAWN, ZONES } from '../client/stations/bakery/layout.js';
import { FLORIST_PLAN, ROOM as FLORIST_ROOM } from '../client/stations/florist/layout-plan.js';
import { PIANIST_PLAN, ROOM as PIANIST_ROOM } from '../client/stations/pianist/layout-plan.js';

/** Задание над базой в памяти с пользователями 1..9 (task_progress ссылается на users). */
const make = (factory) => {
  const db = openDb(':memory:');
  for (let i = 1; i <= 9; i++) db.createUser({ name: `Игрок ${i}`, passHash: 'x', salt: 'x' });
  return { db, task: factory({ db, log: { error() {} } }) };
};
const session = (id, p) => ({ station: { id, x: p.x, z: p.z } });
const zone = (id) => ZONES.find((z) => z.id === id);

test('реестр: точки взаимодействия совпадают с планами сцен', () => {
  assert.deepEqual(STATIONS.bakery.bounds, { minX: BAKERY_ROOM.minX, maxX: BAKERY_ROOM.maxX, minZ: BAKERY_ROOM.minZ, maxZ: BAKERY_ROOM.maxZ });
  assert.deepEqual(STATIONS.bakery.spawn, BAKERY_SPAWN);
  assert.deepEqual(STATIONS.florist.bounds, { minX: 0, maxX: FLORIST_ROOM.width, minZ: 0, maxZ: FLORIST_ROOM.depth });
  assert.deepEqual(STATIONS.pianist.bounds, { minX: 0, maxX: PIANIST_ROOM.width, minZ: 0, maxZ: PIANIST_ROOM.depth });
  assert.equal(STATIONS.bakery.entrance.x, BAKERY_ENTRANCE.x);
  assert.equal(STATIONS.florist.entrance.z, FLORIST_ENTRANCE.z);
  assert.equal(STATIONS.pianist.entrance.x, MUSIC_SCHOOL_ENTRANCE.x);

  const baker = STATION_NPCS.find((n) => n.agentId === 'baker');
  assert.deepEqual([baker.x, baker.z], [zone('mentor').x, zone('mentor').z]);
  const lilia = STATION_NPCS.find((n) => n.agentId === 'lilia');
  assert.deepEqual([lilia.x, lilia.z], [FLORIST_PLAN.stations.lilia.x, FLORIST_PLAN.stations.lilia.z]);
  const maestro = STATION_NPCS.find((n) => n.agentId === 'maestro');
  assert.deepEqual([maestro.x, maestro.z], [PIANIST_PLAN.maestro.x, PIANIST_PLAN.maestro.z]);

  assert.deepEqual(FLORIST_POINTS.lilia, { x: FLORIST_PLAN.stations.lilia.x, z: FLORIST_PLAN.stations.lilia.z });
  assert.deepEqual(FLORIST_POINTS.handoff, { x: FLORIST_PLAN.stations.handoff.x, z: FLORIST_PLAN.stations.handoff.z });
  for (const [type, p] of Object.entries(FLORIST_PLAN.buckets)) assert.deepEqual(FLORIST_POINTS.buckets[type], { x: p.x, z: p.z }, type);
  for (const key of ['workbench', 'wrapping']) assert.deepEqual(FLORIST_POINTS.desks[key], { ...FLORIST_PLAN.desks[key] }, key);
  assert.deepEqual(PIANIST_POINTS.maestro, { x: PIANIST_PLAN.maestro.x, z: PIANIST_PLAN.maestro.z });
  assert.deepEqual(PIANIST_POINTS.practicePiano, { x: PIANIST_PLAN.practicePiano.x, z: PIANIST_PLAN.practicePiano.z });
  assert.deepEqual(PIANIST_POINTS.stagePiano, { x: PIANIST_PLAN.stagePiano.x, z: PIANIST_PLAN.stagePiano.z });
});

test('реестр: у каждого диалогового NPC есть персона, станция и задание; радио — отдельный ИИ-сервис', () => {
  const dir = new URL('../server/agents/personas/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  assert.equal(new Set(STATION_NPCS.map((n) => n.agentId)).size, STATION_NPCS.length, 'agentId уникальны');
  for (const npc of STATION_NPCS) {
    assert.ok(files.includes(npc.agentId), `нет persona ${npc.agentId}.json`);
    const persona = JSON.parse(readFileSync(new URL(`${npc.agentId}.json`, dir), 'utf8'));
    assert.equal(persona.id, npc.agentId);
    assert.equal(persona.name, npc.name);
    for (const field of ['role', 'about', 'style']) assert.ok(persona[field].length > 20, `${npc.agentId}.${field}`);
    assert.ok(Array.isArray(persona.topics) && persona.topics.length >= 3);
    assert.ok(STATIONS[npc.stationId].taskId, 'у станции есть задание');
    assert.equal(npc.service, 'dialogue');
  }
  assert.ok(!files.some((f) => f.startsWith('radio')), 'фиктивной персоны радио нет');
  assert.deepEqual(AI_SERVICES.map((s) => s.id), ['radio_editor']);
  assert.equal(AI_SERVICES[0].kind, 'script_editor');
  // Будущие профессии остаются файлами без размещения.
  for (const future of ['nurse', 'therapist']) assert.ok(!STATION_NPCS.some((n) => n.agentId === future));
});

test('реестр: вход в станцию и радиус разговора', () => {
  assert.ok(nearEntrance(STATIONS.bakery, BAKERY_ENTRANCE.x, BAKERY_ENTRANCE.z));
  assert.ok(!nearEntrance(STATIONS.bakery, FLORIST_ENTRANCE.x, FLORIST_ENTRANCE.z), 'вход чужой станции не подходит');
  assert.ok(!nearEntrance(STATIONS.bakery, Number.NaN, 0));
  const baker = STATION_NPCS.find((n) => n.agentId === 'baker');
  assert.ok(withinTalkRange(baker, baker.x + 1, baker.z));
  assert.ok(!withinTalkRange(baker, baker.x + 8, baker.z));
});

test('пекарня: полное прохождение с проверкой места и порядка', () => {
  const { db, task } = make(createBakeryTask);
  const steps = [
    ['get_order', 'mentor', 'order_received'],
    ['prepare_ingredients', 'ingredients', 'ingredients_ready'],
    ['shape_product', 'worktable', 'product_shaped'],
    ['use_oven', 'oven', 'product_baked'],
    ['collect_product', 'cooling_rack', 'product_ready'],
    ['deliver_order', 'delivery', 'completed'],
  ];
  // Неверный порядок и отсутствие сессии не засчитываются.
  assert.equal(task.handle(1, { action: 'use_oven' }, session('bakery', zone('oven'))).changed, false);
  assert.match(task.handle(1, { action: 'get_order' }, null).feedback, /станци/);
  assert.match(task.handle(1, { action: 'get_order' }, session('florist', zone('mentor'))).feedback, /станци/);
  // Верное действие издалека отклонено.
  assert.match(task.handle(1, { action: 'get_order' }, session('bakery', { x: 8, z: -6 })).feedback, /Подойдите/);
  for (const [action, zoneId, stage] of steps) {
    const r = task.handle(1, { action, stage: 'completed', done: true }, session('bakery', zone(zoneId)));
    assert.equal(r.changed, true, action);
    assert.equal(r.state.stage, stage);
  }
  assert.equal(db.getTaskProgress(1, STATION_TASK_IDS.bakery).done, true);
  assert.equal(task.getState(1).state.completedOrders, 1);
  const again = task.handle(1, { action: 'repeat_order' }, session('bakery', zone('mentor')));
  assert.deepEqual([again.state.stage, again.state.completedOrders], ['waiting_order', 1]);
  assert.equal(task.getState(2).state.stage, 'waiting_order', 'прогресс принадлежит userId');
  assert.match(task.describe(1).text, /Заказ ещё не получен/);
});

test('цветочная лавка: ошибочный букет не принимается, remove_last исправляет, выдача только в конце', () => {
  const { task } = make(createFloristTask);
  const at = (p) => session('florist', p);
  const lilia = FLORIST_POINTS.lilia;
  const bucket = (type) => FLORIST_POINTS.buckets[type];
  const bench = { x: 10, z: 9.5 };
  const wrapDesk = { x: 16, z: 12.1 };
  const run = (position, payload) => task.handle(7, payload, at(position));

  assert.equal(run(lilia, { action: 'start_briefing' }).state.stage, 'briefing');
  assert.equal(run(bucket('red_rose'), { action: 'accept_order' }).state.stage, 'collecting', 'принять заказ можно без объекта');
  const addFrom = (type) => {
    assert.equal(run(bucket(type), { action: 'take_flower', flower: type }).changed, true, type);
    assert.equal(run(bench, { action: 'add_flower' }).changed, true);
  };
  // Берём цветок издалека: отклонено.
  assert.match(run(bench, { action: 'take_flower', flower: 'red_rose' }).feedback, /Подойдите/);
  // Неправильный состав: розы вместо тюльпана.
  for (const type of ['pink_tulip', 'red_rose', 'white_daisy', 'white_daisy', 'greenery']) addFrom(type);
  let state = task.getState(7).state;
  assert.equal(state.stage, 'wrapping');
  assert.equal(run(wrapDesk, { action: 'choose_ribbon', ribbon: 'pink' }).changed, false, 'лента к ошибочному букету не выбирается');
  assert.equal(run(wrapDesk, { action: 'wrap' }).changed, false, 'ошибочный букет не упаковывается');
  assert.match(task.describe(7).text, /НЕ совпадает с заказом/);
  // Исправление: убрать последний можно, а убрать «розу» из середины нельзя — только последний стебель.
  assert.equal(run(bench, { action: 'remove_last' }).state.stems.length, 4);
  assert.equal(run(bench, { action: 'remove_last' }).state.stems.length, 3);
  assert.equal(run(bench, { action: 'remove_last' }).state.stems.length, 2);
  assert.equal(run(bench, { action: 'remove_last' }).state.stems.length, 1);
  assert.equal(run(bench, { action: 'remove_last' }).state.stems.length, 0);
  for (const type of ['pink_tulip', 'pink_tulip', 'white_daisy', 'white_daisy', 'greenery']) addFrom(type);
  assert.equal(task.getState(7).state.stage, 'wrapping');
  assert.match(describeBouquet(task.getState(7).state.stems), /розовый тюльпан — 2/);
  assert.match(task.describe(7).text, /совпадает с заказом/);
  assert.equal(run(wrapDesk, { action: 'wrap' }).changed, false, 'нужна розовая лента');
  assert.equal(run(wrapDesk, { action: 'choose_ribbon', ribbon: 'blue' }).changed, true);
  assert.equal(run(wrapDesk, { action: 'wrap' }).changed, false, 'синяя лента не подходит');
  assert.equal(run(wrapDesk, { action: 'choose_ribbon', ribbon: 'pink' }).changed, true);
  assert.equal(run(bench, { action: 'handoff' }).changed, false, 'сдать неупакованный букет нельзя');
  assert.equal(run(wrapDesk, { action: 'wrap' }).state.stage, 'handoff');
  assert.match(run(lilia, { action: 'handoff' }).feedback, /Подойдите/);
  const done = run(FLORIST_POINTS.handoff, { action: 'handoff' });
  assert.equal(done.state.stage, 'completed');
  assert.equal(done.done, true);
});

test('музыкальная школа: ноты, ошибка сбрасывает фразу, концерт только у сцены', () => {
  const { task } = make(createPianistTask);
  const at = (p) => session('pianist', p);
  const maestro = PIANIST_POINTS.maestro;
  const practice = PIANIST_POINTS.practicePiano;
  const stage = PIANIST_POINTS.stagePiano;
  const run = (p, payload) => task.handle(3, payload, at(p));
  const play = (p, ids) => ids.map((note) => run(p, { action: 'note', note }));

  assert.match(run(practice, { action: 'start_briefing' }).feedback, /Подойдите/, 'начать урок можно только у Маэстро');
  assert.equal(run(maestro, { action: 'start_briefing' }).state.stage, 'briefing');
  assert.equal(run(maestro, { action: 'accept' }).state.stage, 'learning');
  assert.equal(play(practice, ['C4'])[0].changed, false, 'ноты вне режима пианино не засчитываются');
  assert.equal(run(maestro, { action: 'enter_piano' }).changed, false, 'сесть за пианино от Маэстро нельзя');
  assert.equal(run(practice, { action: 'enter_piano' }).state.pianoMode, true);
  assert.match(task.describe(3).text, /следующая нота До/);
  play(practice, ['C4', 'D4']);
  assert.equal(task.getState(3).state.index, 2);
  assert.match(task.describe(3).text, /сыграно 2 из 4/);
  play(practice, ['G4']); // ошибка: ожидалась Ми
  assert.equal(task.getState(3).state.index, 0, 'ошибка возвращает к началу фразы');
  play(practice, ['C4', 'D4', 'E4', 'G4']);
  assert.equal(task.getState(3).state.stage, 'practice');
  assert.match(task.describe(3).text, /осталось/);
  // Текстовая «победа» через ИИ невозможна: пока мелодия не сыграна, концерт недоступен.
  play(practice, ['C4', 'D4', 'E4', 'G4', 'G4', 'E4', 'D4', 'C4']);
  let state = task.getState(3).state;
  assert.equal(state.stage, 'concert');
  assert.equal(state.pianoMode, false);
  // Концерт: учебное пианино не подходит, нужна сцена; флаг atStage от клиента не принимается.
  assert.equal(run(practice, { action: 'enter_piano', atStage: true }).changed, false);
  assert.equal(run(stage, { action: 'enter_piano' }).state.pianoMode, true);
  play(stage, ['C4', 'D4', 'E4', 'G4', 'G4', 'E4', 'D4']);
  assert.equal(task.getState(3).state.stage, 'concert');
  assert.match(task.describe(3).text, /сыграно 7 из 8/);
  play(stage, ['C4']);
  state = task.getState(3).state;
  assert.equal(state.stage, 'completed');
  assert.equal(task.getState(3).done, true);
});

test('повреждённая или подделанная запись в базе заменяется началом задания', () => {
  const cases = [
    [createBakeryTask, STATION_TASK_IDS.bakery, { stage: 'completed', completedOrders: -4 }, 'waiting_order'],
    [createBakeryTask, STATION_TASK_IDS.bakery, { stage: 'nope', completedOrders: 0 }, 'waiting_order'],
    [createFloristTask, STATION_TASK_IDS.florist, { stage: 'handoff', heldFlower: null, stems: [], ribbon: 'pink', wrapped: true }, 'not_started'],
    [createFloristTask, STATION_TASK_IDS.florist, { stage: 'collecting', heldFlower: null, stems: [{ id: 'x', type: 'cactus' }], ribbon: null, wrapped: false }, 'not_started'],
    [createPianistTask, STATION_TASK_IDS.pianist, { stage: 'learning', index: 99, pianoMode: true }, 'not_started'],
  ];
  for (const [factory, taskId, raw, expected] of cases) {
    const { db, task } = make(factory);
    db.saveTaskProgress(5, taskId, { state: raw, done: false });
    assert.equal(task.getState(5).state.stage, expected, JSON.stringify(raw));
  }
  // Корректное состояние восстанавливается, а при новом входе в станцию режим «за пианино» выключается.
  const { db, task } = make(createPianistTask);
  db.saveTaskProgress(5, STATION_TASK_IDS.pianist, { state: { stage: 'practice', index: 3, pianoMode: true }, done: false });
  assert.deepEqual([task.getState(5).state.stage, task.getState(5).state.index, task.getState(5).state.pianoMode], ['practice', 3, true]);
  task.enterStation(5);
  assert.deepEqual([task.getState(5).state.stage, task.getState(5).state.index, task.getState(5).state.pianoMode], ['practice', 3, false]);
});

const hits = (list, text) => list.some((src) => new RegExp(src, 'iu').test(text));

test('ложные утверждения о ходе урока: шаблоны ловят невыполненное и не трогают правду и отрицание', () => {
  // Каждый шаблон компилируется как в сервисе агентов (флаги iu), у каждого этапа есть таблица.
  for (const [table, stages] of [[BAKERY_AVOID, 7], [FLORIST_AVOID, 6], [PIANIST_AVOID, 6]]) {
    assert.equal(Object.keys(table).length, stages);
    for (const list of Object.values(table)) for (const src of list) assert.doesNotThrow(() => new RegExp(src, 'iu'));
    assert.equal(table.completed.length, 3); // на последнем этапе остаются только мусор и пересказ служебных правил
    assert.ok(!hits(table.completed, 'Поздравляю, ты выполнил все шаги и выступил на концерте!'));
  }
  // Общие признаки сбоя
  assert.ok(hits(BAKERY_AVOID.product_baked, 'Ты выполнил все шаги от заказа до сдачи.'));
  assert.ok(hits(PIANIST_AVOID.learning, 'Там написано «Ещё НЕ сделано», а это dataset.'));
  assert.ok(hits(FLORIST_AVOID.not_started, 'Я покажу вам, что уже сделано: сбор букета.'));
  assert.ok(hits(FLORIST_AVOID.briefing, 'Ты уже собрал букет из 5 стеблей.'));
  // Пекарня
  assert.ok(hits(BAKERY_AVOID.waiting_order, 'Ты уже получил заказ и подготовил ингредиенты.'));
  assert.ok(hits(BAKERY_AVOID.waiting_order, 'Хлеб только выключили из печи.'));
  assert.ok(hits(BAKERY_AVOID.waiting_order, 'Ты прошел путь от приезда до сдачи заказа!'));
  assert.ok(hits(BAKERY_AVOID.waiting_order, 'Ты уже сделал много — получение заказа и сдача хлеба!'));
  assert.ok(hits(BAKERY_AVOID.ingredients_ready, 'Ты сформировал тесто, молодец!'));
  assert.ok(hits(BAKERY_AVOID.product_shaped, 'Вы положили хлеб в печь — это отлично!'));
  assert.ok(hits(BAKERY_AVOID.product_ready, 'Поздравляю! Заказ сдан.'));
  assert.ok(!hits(BAKERY_AVOID.ingredients_ready, 'Ингредиенты готовы, хлеб ещё не сформирован. Ты не сформировал его.'));
  assert.ok(!hits(BAKERY_AVOID.product_baked, 'Хлеб выпечен, теперь забери его с полки.'));
  // Цветочная лавка
  assert.ok(hits(FLORIST_AVOID.briefing, 'Ты уже принял заказ и собрал букет.'));
  assert.ok(hits(FLORIST_AVOID.not_started, 'Цветы уже собраны, лента на них наложена.'));
  assert.ok(hits(FLORIST_AVOID.not_started, 'Ты дошла до этапа сбора и упаковки.'));
  assert.ok(hits(FLORIST_AVOID.not_started, 'Ты положила цветы в коробку.'));
  assert.ok(hits(FLORIST_AVOID.wrapping, 'Ты упаковал букет, осталось отнести его.'));
  assert.ok(hits(FLORIST_AVOID.handoff, 'Твой заказ уже выдан!'));
  assert.ok(hits(FLORIST_AVOID.briefing, 'Ах, ты молодец! Букет с тобой собран и упакован лентой.'));
  assert.ok(hits(FLORIST_AVOID.collecting, 'Здорово, ты сам уложил все стебли: 5 из 5!'));
  assert.ok(!hits(FLORIST_AVOID.briefing, 'Букет пока не собран и ещё не упакован.'));
  assert.ok(!hits(FLORIST_AVOID.collecting, 'Сейчас в букете 3 из 5 стеблей.'));
  assert.ok(!hits(FLORIST_AVOID.collecting, 'Ты собрал букет из трёх стеблей, нужно ещё два.'));
  assert.ok(!hits(FLORIST_AVOID.collecting, 'Букет ещё не собран, ты пока не упаковал его.'));
  // Музыкальная школа (кириллица в \p{L}, а не \w)
  assert.ok(hits(PIANIST_AVOID.practice, 'Ты уже выступил на концерте!'));
  assert.ok(!hits(PIANIST_AVOID.practice, 'Ты ещё не выступил на концерте.'));
});

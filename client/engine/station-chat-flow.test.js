import test from 'node:test';
import assert from 'node:assert/strict';
import { ask, act, createStationChatFlow } from './station-chat-flow.js';
import { STATION_NPCS } from '../../shared/station-npcs.js';
import { BAKER, hintForStage as bakeryHint, planActions as bakeryPlan } from '../stations/bakery/chat-flow.js';
import { STAGES as BAKERY_STAGES } from '../stations/bakery/state.js';
import { LILIA, hintForStage as floristHint, planActions as floristPlan } from '../stations/florist/chat-flow.js';
import { STAGES as FLORIST_STAGES } from '../stations/florist/state.js';
import { MAESTRO, hintForStage as pianistHint, planActions as pianistPlan } from '../stations/pianist/chat-flow.js';
import { STAGES as PIANIST_STAGES } from '../stations/pianist/state.js';
import { targetsForState } from '../stations/florist/targets.js';
import { createInitialState } from '../stations/florist/state.js';

const helpers = { ask, act };

test('агентные идентификаторы панелей совпадают с реестром сервера', () => {
  for (const npc of [BAKER, LILIA, MAESTRO]) {
    const registered = STATION_NPCS.find((n) => n.agentId === npc.agentId);
    assert.ok(registered, npc.agentId);
    assert.equal(registered.name, npc.name);
  }
});

test('на каждом этапе есть памятка игры и 2–4 кнопки; действие выполняет только кнопка, а не вопрос', () => {
  const cases = [
    [BAKERY_STAGES, bakeryHint, (stage, calls) => bakeryPlan(stage, helpers, (a) => calls.push(a))],
    [FLORIST_STAGES, floristHint, (stage, calls) => floristPlan(stage, helpers, (a) => calls.push(a.type))],
    [PIANIST_STAGES, pianistHint, (stage, calls) => pianistPlan(stage, helpers, (a) => calls.push(a.type))],
  ];
  for (const [stages, hint, plan] of cases) {
    for (const stage of stages) {
      const calls = [];
      const buttons = plan(stage, calls);
      assert.ok(hint(stage).length > 10, `памятка ${stage}`);
      assert.ok(buttons.length >= 2 && buttons.length <= 4, `${stage}: ${buttons.length} кнопок`);
      for (const b of buttons) assert.ok(b.text || typeof b.run === 'function', `${stage}: ${b.label}`);
      // Вопросы — только текст реплики игрока; ничего не выполняется, пока не нажата кнопка действия.
      assert.deepEqual(calls, []);
      for (const b of buttons.filter((x) => x.run)) {
        b.run();
      }
      assert.ok(calls.length <= 1);
    }
  }
});

test('действия у наставника — только безопасные начала и повторы, но не шаги работы', () => {
  const run = (plan, stage, perform) => plan(stage, helpers, perform).filter((b) => b.run).map((b) => b.label);
  const noop = () => {};
  assert.deepEqual(run(bakeryPlan, 'waiting_order', noop), ['Получить заказ']);
  assert.deepEqual(run(bakeryPlan, 'ingredients_ready', noop), [], 'формовку хлеба разговором не засчитать');
  assert.deepEqual(run(floristPlan, 'collecting', noop), []);
  assert.deepEqual(run(floristPlan, 'wrapping', noop), []);
  assert.deepEqual(run(pianistPlan, 'practice', noop), []);
  assert.deepEqual(run(pianistPlan, 'concert', noop), [], 'концерт засчитывает только игра');
  assert.deepEqual(run(pianistPlan, 'not_started', noop), ['Начать урок']);
});

test('поток: открытие панели выставляет памятку и кнопки, приветствие автоматически не уходит', () => {
  const log = [];
  const chat = {
    open: (npc) => (log.push(['open', npc.agentId]), true),
    setAssist: (value) => log.push(['assist', value]),
    send: () => log.push(['send']),
    close: () => log.push(['close']),
  };
  let stage = 'waiting_order';
  const performed = [];
  const flow = createStationChatFlow({
    chat,
    npc: BAKER,
    getStage: () => stage,
    hint: bakeryHint,
    plan: (s, h) => bakeryPlan(s, h, (a) => performed.push(a)),
    getNotice: () => 'Подсказка игры',
  });
  assert.equal(flow.open(), true);
  assert.equal(log.some(([kind]) => kind === 'send'), false, 'без вопроса игрока модель не запускается');
  const assist = log.at(-1)[1];
  assert.equal(assist.note, 'Подсказка игры');
  assert.equal(assist.actions[0].label, 'Получить заказ');
  assist.actions[0].run();
  assert.deepEqual(performed, ['get_order']);
  stage = 'completed';
  flow.sync();
  assert.equal(log.at(-1)[1].actions[0].label, 'Принять новый заказ');

  const offline = createStationChatFlow({ chat, npc: BAKER, getStage: () => stage, hint: bakeryHint, plan: () => [], isOnline: () => false });
  assert.equal(offline.open(), false, 'без сессии станции панель не открывается: остаётся прежнее поведение E');
});

test('Лилия доступна для разговора на любом этапе только при подтверждённой сессии и не вытесняет рабочие объекты', () => {
  const layout = {
    stations: { lilia: { x: 10, z: 3.45 }, workbench: { x: 10, z: 9.85 }, wrapping: { x: 13, z: 12.1 }, handoff: { x: 4, z: 3.4 } },
    buckets: { pink_tulip: { position: { x: 2.45, z: 5 } }, white_daisy: { position: { x: 2.45, z: 10.2 } }, red_rose: { position: { x: 17.55, z: 5 } }, greenery: { position: { x: 17.55, z: 10.2 } } },
  };
  const collecting = { ...createInitialState(), stage: 'collecting' };
  const kinds = (state, options) => targetsForState(state, layout, options).map((t) => t.kind);
  assert.ok(!kinds(collecting, {}).includes('lilia'), 'без связи на сборке букета Лилии как цели нет');
  assert.ok(kinds(collecting, { canTalk: true }).includes('lilia'));
  assert.ok(kinds(collecting, { canTalk: true }).includes('take'), 'рабочие объекты остаются');
  for (const stage of ['wrapping', 'handoff']) assert.ok(kinds({ ...collecting, stage }, { canTalk: true }).includes('lilia'), stage);
  assert.deepEqual(kinds(createInitialState(), {}), ['lilia']);
});

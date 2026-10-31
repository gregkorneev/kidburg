import test from 'node:test';
import assert from 'node:assert/strict';
import { MARUSYA, SAY, STAGE_HINTS, createMarusyaChat, planActions } from './chat-flow.js';

const STAGES = Object.keys(STAGE_HINTS);

/** Подменная панель разговора: записывает, что игра просит открыть, отправить и показать. */
function fakeChat() {
  const chat = {
    opened: [],
    sent: [],
    assist: null,
    canSend: true,
    open(npc) { chat.opened.push(npc); return true; },
    listeners: [],
    onSend(fn) { chat.listeners.push(fn); },
    send(text) {
      if (!chat.canSend) return false;
      chat.sent.push(text);
      for (const fn of chat.listeners) fn({ agentId: 'marusya', text });
      return true;
    },
    setAssist(value) { chat.assist = value; },
  };
  return chat;
}

/** Хранилище вкладки: переживает «перезагрузку» — новый createMarusyaChat с тем же хранилищем. */
const fakeStorage = () => {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, String(v)), removeItem: (k) => void map.delete(k) };
};

function setup(stage = 'not_started', overrides = {}) {
  const chat = fakeChat();
  const world = { state: { stage }, online: true, busy: false, notice: '', dispatched: [], confirm: null, storage: overrides.storage ?? fakeStorage() };
  const flow = createMarusyaChat({
    chat,
    storage: world.storage,
    getState: () => world.state,
    dispatch: (action, handlers) => {
      world.dispatched.push(action);
      world.confirm = handlers.onConfirmed; // сервер подтвердит позже; до этого реплики нет
      return true;
    },
    isOnline: () => world.online,
    isBusy: () => world.busy,
    getNotice: () => world.notice,
    ...overrides,
  });
  return { chat, world, flow };
}

test('первая встреча: открывается панель Маруси, игрок здоровается, ответ приходит только от сервера', () => {
  const { chat, flow } = setup();
  assert.equal(flow.open(), true);
  assert.deepEqual(chat.opened, [MARUSYA]);
  assert.deepEqual(chat.sent, [SAY.hello], 'уходит одна реплика игрока (npc_talk), без готового ответа Маруси');
  assert.equal(JSON.stringify(chat.assist).includes('Привет! Я Маруся'), false, 'готового приветствия NPC в клиенте нет');
});

test('повторное открытие панели и новый подход на том же этапе ничего не отправляют', () => {
  const { chat, flow } = setup();
  flow.open();
  flow.open();
  chat.opened.length = 0;
  flow.open(); // закрыли, отошли, подошли снова
  assert.deepEqual(chat.sent, [SAY.hello], 'приветствие ушло один раз');
  assert.equal(chat.opened.length, 1, 'панель открывается, но реплики нет');
});

test('на другом этапе игрок не здоровается заново, а спрашивает, что делать дальше', () => {
  const { chat, world, flow } = setup();
  flow.open();
  world.state = { stage: 'briefing' };
  flow.open();
  world.state = { stage: 'completed' };
  flow.open();
  flow.open();
  assert.deepEqual(chat.sent, [SAY.hello, SAY.resume, SAY.resume]);
  assert.equal(chat.sent.filter((t) => t === SAY.hello).length, 1);
});

test('перезагрузка страницы во вкладке: приветствие не повторяется, этап без обращения получает «что дальше»', () => {
  const first = setup('briefing');
  first.flow.open();
  assert.deepEqual(first.chat.sent, [SAY.hello]);

  // та же вкладка (то же хранилище), страница создана заново
  const again = setup('briefing', { storage: first.world.storage });
  again.flow.open();
  assert.deepEqual(again.chat.sent, [], 'на этом этапе игрок уже обращался');
  again.world.state = { stage: 'equipping' };
  again.flow.open();
  assert.deepEqual(again.chat.sent, [SAY.resume]);
  assert.equal(again.chat.sent.includes(SAY.hello), false);

  // новая вкладка или другое устройство: клиент ничего не помнит, а повторное приветствие гасит сервер
  const fresh = setup('briefing');
  fresh.flow.open();
  assert.deepEqual(fresh.chat.sent, [SAY.hello]);
});

test('любая реплика игрока (кнопка, ввод) считается обращением на этом этапе', () => {
  const { chat, world, flow } = setup('equipping');
  flow.open(); // открывается без обращения: sent = hello (первое обращение за вкладку)
  chat.sent.length = 0;
  world.state = { stage: 'fire_drill' };
  chat.send('Как держать рукав?'); // игрок написал сам, до открытия на новом этапе
  chat.sent.length = 0;
  flow.open();
  assert.deepEqual(chat.sent, [], 'вводную реплику не отправляем: игрок уже говорил с Марусей на этом этапе');
});

test('выход из игры очищает память вкладки: следующий игрок знакомится заново', () => {
  const { chat, flow } = setup();
  flow.open();
  flow.reset();
  flow.open();
  assert.deepEqual(chat.sent, [SAY.hello, SAY.hello]);
});

test('если ИИ ещё отвечает или связи нет, вводная реплика не теряется и уйдёт при следующем открытии', () => {
  const { chat, flow } = setup();
  chat.canSend = false;
  flow.open();
  assert.deepEqual(chat.sent, []);
  chat.canSend = true;
  flow.open();
  assert.deepEqual(chat.sent, [SAY.hello]);

  const offline = setup('debrief', { isOnline: () => false });
  assert.equal(offline.flow.open(), false);
  assert.deepEqual(offline.chat.opened, []);
});

test('кнопка действия просит сервер и продолжает разговор только после его подтверждения', () => {
  const { chat, world, flow } = setup('not_started');
  flow.open();
  const start = chat.assist.actions.find((a) => a.label === 'Начать тренировку');
  assert.ok(start.run && start.text === undefined);
  chat.sent.length = 0;
  start.run();
  assert.deepEqual(world.dispatched, ['start']);
  assert.deepEqual(chat.sent, [], 'до подтверждения сервера реплика не отправляется');
  world.confirm({ stage: 'briefing' });
  assert.deepEqual(chat.sent, [SAY.afterStart]);
});

test('если сервер отказал, реплики после действия нет', () => {
  const { chat, world, flow } = setup('debrief');
  flow.open();
  chat.sent.length = 0;
  chat.assist.actions.find((a) => a.label === 'Завершить смену').run();
  assert.deepEqual(world.dispatched, ['report']);
  assert.equal(world.confirm !== null, true);
  assert.deepEqual(chat.sent, []);
});

test('повтор смены предлагается только на завершённом этапе вместе с дополнительной информацией', () => {
  for (const stage of STAGES) {
    const labels = planActions(stage).map((a) => a.label);
    assert.equal(planActions(stage).some((a) => a.action === 'repeat'), stage === 'completed', stage);
    assert.equal(labels.includes('Узнать больше о профессии'), stage === 'completed', stage);
  }
  const { chat, world, flow } = setup('completed');
  flow.open();
  const labels = chat.assist.actions.map((a) => a.label);
  assert.deepEqual(labels, ['Узнать больше о профессии', 'Повторить учебную смену']);
  const more = chat.assist.actions[0];
  assert.equal(more.text, 'Расскажи больше о профессии пожарного.');
  const repeat = chat.assist.actions[1];
  chat.sent.length = 0;
  assert.deepEqual(world.dispatched, [], 'повтор не стартует без явного нажатия');
  repeat.run();
  assert.deepEqual(world.dispatched, ['repeat']);
  assert.deepEqual(chat.sent, []);
  world.confirm({ stage: 'briefing' });
  assert.deepEqual(chat.sent, [SAY.afterRepeat]);
});

test('кнопки действий блокируются, пока сервер обрабатывает прошлое действие; сообщение игре передаётся', () => {
  const { chat, world, flow } = setup('briefing');
  world.busy = true;
  world.notice = 'Подойдите к нужному объекту, чтобы выполнить действие.';
  flow.sync();
  assert.equal(chat.assist.note, world.notice);
  assert.equal(chat.assist.actions.find((a) => a.run).disabled, true);
  assert.equal(chat.assist.actions.filter((a) => a.text).every((a) => !a.disabled), true);
});

test('на каждом этапе есть подсказка игры, а действие у Маруси — не больше одного', () => {
  for (const stage of STAGES) {
    assert.ok(STAGE_HINTS[stage], stage);
    assert.ok(planActions(stage).filter((a) => a.action).length <= 2, stage);
    for (const a of planActions(stage)) assert.ok(a.label.length > 0 && (a.action || a.text));
  }
});

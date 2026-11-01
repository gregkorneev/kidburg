import test from 'node:test';
import assert from 'node:assert/strict';
import { mountRadioPreview } from './preview.js';
import { TASK_ID } from './tasks.js';
import { createCountdown } from './countdown.js';
import { createTeleprompter } from './teleprompter.js';

class FakeElement {
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.style = {};
    this.className = '';
  }

  replaceChildren(...children) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  remove() {
    if (this.parentElement) this.parentElement.replaceChildren();
    this.parentElement = null;
    this.removed = true;
  }

  querySelector() { return null; }
}

function makeHarness() {
  const doc = { createElement: () => new FakeElement(doc) };
  const root = new FakeElement(doc);
  const listeners = new Map();
  const sent = [];
  const api = {
    net: {
      status: 'open',
      send(message) { sent.push(message); return true; },
    },
    on(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
      return () => listeners.get(type)?.delete(listener);
    },
  };
  const emit = (type, value) => {
    for (const listener of [...(listeners.get(type) ?? [])]) listener(value);
  };
  const renderCalls = [];
  const mountUI = (target, props) => renderCalls.push({ target, props });
  const unmountCalls = [];
  const unmountUI = (target) => unmountCalls.push(target);
  const win = {
    navigation: [],
    location: {
      replace(path) { win.navigation.push([path, studios.at(-1)?.disposeCalls ?? 0]); },
      assign(path) { win.navigation.push([path, studios.at(-1)?.disposeCalls ?? 0]); },
    },
    addEventListener(type, listener) {
      if (!listeners.has(`window:${type}`)) listeners.set(`window:${type}`, new Set());
      listeners.get(`window:${type}`).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(`window:${type}`)?.delete(listener); },
  };
  const studios = [];
  const studioFactory = () => {
    const studio = {
      mountCalls: [],
      onAir: [],
      disposeCalls: 0,
      setOnAir(value) { this.onAir.push(value); },
      monitorMount: {
        mount(element, cleanup) {
          studio.mountCalls.push({ element, cleanup });
          return element;
        },
      },
      dispose() {
        this.disposeCalls++;
        if (this.disposeCalls === 1) this.mountCalls[0]?.cleanup();
      },
    };
    studios.push(studio);
    return studio;
  };
  return { api, emit, listeners, mountUI, renderCalls, root, sent, studioFactory, studios, unmountCalls, unmountUI, win };
}

function fakeClock() {
  let now = 0;
  let nextId = 1;
  const jobs = new Map();
  return {
    jobs,
    now: () => now,
    setTimeout(fn, delay) {
      const id = nextId++;
      jobs.set(id, { fn, due: now + delay });
      return id;
    },
    clearTimeout(id) { jobs.delete(id); },
    tick(ms) {
      const end = now + ms;
      while (true) {
        const next = [...jobs.entries()].sort((a, b) => a[1].due - b[1].due)[0];
        if (!next || next[1].due > end) break;
        now = next[1].due;
        jobs.delete(next[0]);
        next[1].fn();
      }
      now = end;
    },
  };
}

test('Radio preview mounts the existing UI in the studio monitor and follows confirmed server ON AIR state', () => {
  const h = makeHarness();
  const unmount = mountRadioPreview({
    api: h.api, root: h.root, window: h.win,
    studioFactory: h.studioFactory, mountUI: h.mountUI, unmountUI: h.unmountUI,
  });
  const studio = h.studios[0];

  assert.equal(h.studios.length, 1, 'одна 3D-студия создаётся на один вход');
  assert.equal(studio.mountCalls.length, 1, 'Radio UI монтируется в monitor mount один раз');
  const monitorUiRoot = studio.mountCalls[0].element;
  assert.ok(h.renderCalls.some(({ props, target }) => props?.state === null && target === monitorUiRoot), 'существующий Radio UI рендерится в monitor mount');
  assert.deepEqual([...h.listeners].map(([type, set]) => [type, set.size]), [
    ['task_state', 1], ['status', 1], ['welcome', 1], ['auth', 1], ['preview_error', 1],
  ]);

  h.emit('task_state', {
    taskId: TASK_ID,
    state: { stage: 'ready', category: 'weather', script: { category: 'weather', title: 'Погода', text: 'Текст выпуска' } },
  });
  h.renderCalls.at(-1).props.onSpeed('slow');
  assert.equal(h.renderCalls.at(-1).props.speed, 'slow', 'скорость выбирается на экране готового сценария');
  h.renderCalls.at(-1).props.onStart();
  assert.equal(h.sent.at(-1).payload.action, 'start_broadcast');
  assert.deepEqual(studio.onAir, [false], 'подтверждённое ready держит индикатор выключенным после локального нажатия');

  h.emit('task_state', {
    taskId: TASK_ID,
    state: { stage: 'on_air', category: 'weather', script: { category: 'weather', title: 'Погода', text: 'Текст выпуска' }, changed: true },
  });
  assert.equal(studio.onAir.at(-1), false, 'в течение подтверждённого countdown лампа остаётся выключенной');
  h.renderCalls.at(-1).props.onComplete();
  assert.equal(h.sent.at(-1).payload.action, 'complete_broadcast');
  assert.equal(studio.onAir.at(-1), false, 'нажатие завершения не меняет состояние во время countdown');
  h.emit('task_state', {
    taskId: TASK_ID,
    state: { stage: 'completed', category: 'weather', script: { category: 'weather', title: 'Погода', text: 'Текст выпуска' }, changed: true },
  });
  assert.equal(studio.onAir.at(-1), false);
  h.renderCalls.at(-1).props.onNew();
  assert.equal(h.sent.at(-1).payload.action, 'new_broadcast');

  h.emit('welcome', {});
  h.emit('status', { status: 'closed' });
  assert.equal(h.renderCalls.at(-1).props.connected, false, 'потеря связи отображается в UI');
  h.emit('status', { status: 'open' });
  assert.equal(h.renderCalls.at(-1).props.connected, false, 'после открытия сокета ждём серверный welcome');
  h.emit('welcome', {});
  assert.equal(h.renderCalls.at(-1).props.connected, true, 'reconnect восстанавливает статус после welcome');
  h.emit('task_state', {
    taskId: TASK_ID,
    state: { stage: 'completed', category: 'weather', script: { category: 'weather', title: 'Погода', text: 'Текст выпуска' } },
  });
  assert.equal(h.renderCalls.at(-1).props.state.stage, 'completed', 'после reconnect UI снова получает сохранённое server state');

  h.emit('auth', null);
  assert.equal(h.studios[0].disposeCalls, 0, 'истечение/отсутствие сессии не уводит Radio на городскую страницу');
  assert.equal(h.renderCalls.at(-1).props.state, null, 'потеря сессии не прячет gameplay screen');
  assert.deepEqual(h.win.navigation, []);

  h.renderCalls.at(-1).props.onLeave();
  assert.deepEqual(h.win.navigation, [['/', 1]], 'выход сначала dispose-ит станцию и затем возвращает в город');
  unmount();
  unmount();
  assert.equal(studio.disposeCalls, 1, 'повторный unmount идемпотентен');
  assert.deepEqual(h.unmountCalls, [monitorUiRoot], 'UI размонтирован один раз через monitor cleanup');
  assert.equal([...h.listeners.values()].reduce((sum, set) => sum + set.size, 0), 0, 'task sync и auth listeners сняты');
});

test('повторный вход создаёт одну студию, один UI mount и один набор listeners', () => {
  const h = makeHarness();
  const enter = () => mountRadioPreview({
    api: h.api, root: h.root, window: h.win,
    studioFactory: h.studioFactory, mountUI: h.mountUI, unmountUI: h.unmountUI,
  });

  const firstUnmount = enter();
  firstUnmount();
  const secondUnmount = enter();

  assert.equal(h.studios.length, 2);
  assert.equal(h.studios[0].mountCalls.length, 1);
  assert.equal(h.studios[1].mountCalls.length, 1);
  assert.deepEqual([...h.listeners].map(([type, set]) => [type, set.size]), [
    ['task_state', 1], ['status', 1], ['welcome', 1], ['auth', 1], ['preview_error', 1],
  ]);
  secondUnmount();
  assert.equal([...h.listeners.values()].reduce((sum, set) => sum + set.size, 0), 0);
});

test('Radio gameplay screen сразу монтируется без auth callbacks и не перенаправляет страницу', () => {
  const h = makeHarness();
  const unmount = mountRadioPreview({
    api: h.api, root: h.root, window: h.win,
    studioFactory: h.studioFactory, mountUI: h.mountUI, unmountUI: h.unmountUI,
  });

  const initialProps = h.renderCalls.at(-1).props;
  assert.equal(initialProps.state, null);
  assert.equal('onCategory' in initialProps, false, 'игрок не выбирает категорию выпуска');
  assert.equal(initialProps.speed, 'normal', 'скорость по умолчанию обычная');
  assert.equal('onLogin' in initialProps, false);
  assert.equal('name' in initialProps, false);
  assert.equal('room' in initialProps, false);
  assert.deepEqual(h.win.navigation, [], 'первый экран не требует auth redirect');
  unmount();
});

test('confirmed countdown reveals the first word group and preview cleanup clears its timer', () => {
  const h = makeHarness();
  const clock = fakeClock();
  const unmount = mountRadioPreview({
    api: h.api, root: h.root, window: h.win,
    studioFactory: h.studioFactory, mountUI: h.mountUI, unmountUI: h.unmountUI,
    countdownFactory: (options) => createCountdown({ ...options, timers: clock, intervalMs: 700 }),
    teleprompterFactory: (options) => createTeleprompter({ ...options, timers: clock, now: clock.now }),
  });
  const scriptText = 'Сегодня в нашем воображаемом городе солнечно. Лёгкий ветер качает деревья в парке.';

  h.emit('task_state', {
    taskId: TASK_ID,
    state: { stage: 'ready', category: 'weather', script: { category: 'weather', title: 'Погода', text: scriptText } },
  });
  h.renderCalls.at(-1).props.onSpeed('fast');
  h.emit('task_state', {
    taskId: TASK_ID,
    state: { stage: 'on_air', category: 'weather', script: { category: 'weather', title: 'Погода', text: scriptText }, changed: true },
  });
  assert.equal(h.renderCalls.at(-1).props.countdown, 3);
  assert.equal(h.renderCalls.at(-1).props.prompterGroup, '');
  clock.tick(2100);
  assert.equal(h.renderCalls.at(-1).props.countdown, null);
  assert.equal(h.renderCalls.at(-1).props.prompterGroup, 'Сегодня в нашем');
  assert.equal(h.renderCalls.at(-1).props.speed, 'fast', 'скорость, выбранная до эфира, сохраняется после countdown');
  assert.equal(h.studios[0].onAir.at(-1), true, 'индикатор включается после завершения countdown');
  assert.equal(clock.jobs.size, 1, 'после countdown запущен только timer следующей группы');
  assert.equal([...clock.jobs.values()][0].due, 2750, 'первый интервал использует выбранную скорость 650 мс');
  unmount();
  assert.equal(clock.jobs.size, 0, 'cleanup останавливает teleprompter timer');
});

test('restored on_air waits for countdown before ON AIR and the first teleprompter group', () => {
  const h = makeHarness();
  const clock = fakeClock();
  const unmount = mountRadioPreview({
    api: h.api, root: h.root, window: h.win,
    studioFactory: h.studioFactory, mountUI: h.mountUI, unmountUI: h.unmountUI,
    countdownFactory: (options) => createCountdown({ ...options, timers: clock, intervalMs: 700 }),
    teleprompterFactory: (options) => createTeleprompter({ ...options, timers: clock, now: clock.now }),
  });

  h.emit('welcome', {});
  h.emit('task_state', {
    taskId: TASK_ID,
    state: { stage: 'on_air', category: 'weather', script: { category: 'weather', title: 'Погода', text: 'Ветер качает деревья в городском парке.' } },
  });

  assert.equal(h.renderCalls.at(-1).props.countdown, 3, 'restore начинает countdown');
  assert.equal(h.renderCalls.at(-1).props.prompterGroup, '', 'текст эфира до countdown скрыт');
  assert.equal(h.studios[0].onAir.includes(true), false, 'физический ON AIR не включается мгновенно');
  assert.equal(clock.jobs.size, 1, 'работает только countdown timer');

  clock.tick(2100);
  assert.equal(h.renderCalls.at(-1).props.countdown, null);
  assert.equal(h.renderCalls.at(-1).props.prompterGroup, 'Ветер качает деревья', 'первая группа появляется после countdown');
  assert.equal(h.studios[0].onAir.at(-1), true, 'индикатор включается после countdown');
  assert.equal(clock.jobs.size, 1, 'после countdown остался один teleprompter timer');
  unmount();
});

test('repeated restored on_air and reconnect during countdown do not start a duplicate countdown', () => {
  const h = makeHarness();
  const clock = fakeClock();
  const unmount = mountRadioPreview({
    api: h.api, root: h.root, window: h.win,
    studioFactory: h.studioFactory, mountUI: h.mountUI, unmountUI: h.unmountUI,
    countdownFactory: (options) => createCountdown({ ...options, timers: clock, intervalMs: 700 }),
    teleprompterFactory: (options) => createTeleprompter({ ...options, timers: clock, now: clock.now }),
  });
  const message = {
    taskId: TASK_ID,
    state: { stage: 'on_air', category: 'science', script: { category: 'science', title: 'Факт', text: 'Маленький сценарий для эфира.' } },
  };
  h.emit('welcome', {});
  h.emit('task_state', message);
  h.emit('task_state', message);
  assert.equal(h.renderCalls.at(-1).props.countdown, 3);
  assert.equal(clock.jobs.size, 1);

  h.emit('status', { status: 'closed' });
  h.emit('status', { status: 'open' });
  h.emit('welcome', {});
  h.emit('task_state', message);
  assert.equal(h.renderCalls.at(-1).props.countdown, 3, 'reconnect сохраняет уже запущенный countdown');
  assert.equal(clock.jobs.size, 1, 'повторное состояние не добавляет timer');
  clock.tick(700);
  assert.equal(h.renderCalls.at(-1).props.countdown, 2, 'текущий отсчёт продолжился, а не начался заново');

  clock.tick(1400);
  const onAirCount = h.studios[0].onAir.filter(Boolean).length;
  const liveGroup = h.renderCalls.at(-1).props.prompterGroup;
  assert.equal(onAirCount, 1);
  h.emit('task_state', message);
  assert.equal(h.studios[0].onAir.filter(Boolean).length, onAirCount, 'повтор live-состояния не дублирует ON AIR');
  assert.equal(h.renderCalls.at(-1).props.prompterGroup, liveGroup, 'повтор live-состояния не сбрасывает телесуфлёр');
  assert.equal(clock.jobs.size, 1, 'повтор live-состояния не создаёт второй teleprompter timer');
  unmount();
});

test('dispose during restored countdown cancels it without turning ON AIR on or retaining listeners', () => {
  const h = makeHarness();
  const clock = fakeClock();
  const unmount = mountRadioPreview({
    api: h.api, root: h.root, window: h.win,
    studioFactory: h.studioFactory, mountUI: h.mountUI, unmountUI: h.unmountUI,
    countdownFactory: (options) => createCountdown({ ...options, timers: clock, intervalMs: 700 }),
    teleprompterFactory: (options) => createTeleprompter({ ...options, timers: clock, now: clock.now }),
  });
  h.emit('welcome', {});
  h.emit('task_state', {
    taskId: TASK_ID,
    state: { stage: 'on_air', category: 'weather', script: { category: 'weather', title: 'Погода', text: 'Текст выпуска.' } },
  });
  assert.equal(clock.jobs.size, 1);

  unmount();

  assert.equal(clock.jobs.size, 0, 'dispose очищает countdown timer');
  assert.equal(h.studios[0].onAir.includes(true), false, 'отмена countdown не включает ON AIR');
  assert.equal(h.studios[0].disposeCalls, 1);
  assert.equal([...h.listeners.values()].reduce((sum, set) => sum + set.size, 0), 0, 'dispose снимает listeners');
  clock.tick(5000);
  assert.equal(h.studios[0].onAir.includes(true), false, 'отменённый callback не меняет индикатор позже');
});

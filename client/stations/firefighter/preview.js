import { createClient } from '../../engine/app.js';
import { mountUI } from '../../ui/index.js';
import { connectFireNetwork } from './network.js';
import { createFirefighterScene } from './scene.js';
import { createInitialState } from './state.js';
import { createTaskSync } from './tasks.js';
import { mountStationUI } from './ui.js';
import './style.css';

const sceneRoot = document.querySelector('#scene');
const uiRoot = document.querySelector('#ui');
let world;
let network = null;
let sync = null;
let busy = false; // ждём подтверждение действия от сервера
let online = false; // вошли на сервер и получили welcome: до этого сцена только фон под экраном входа
let state = createInitialState();
let dialog = null;
let prompt = '';
let notice = 'Сетевой режим: прогресс станции хранится на сервере.';
let hoseActive = false;
let noticeTimer;

const refresh = () => {
  mountStationUI(uiRoot, {
    state,
    prompt,
    notice,
    dialog,
    hoseActive,
    busy,
    onChoose: (option) => option.onSelect?.(),
    onCloseDialog: closeDialog,
  });
};

function setNotice(message, duration = 2600) {
  notice = message;
  refresh();
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice = ''; refresh(); }, duration);
}

const syncBlocked = () => world?.setUiBlocked(!online || dialog !== null);

function closeDialog() {
  dialog = null;
  syncBlocked();
  refresh();
}

function showDialog(nextDialog) {
  dialog = nextDialog;
  syncBlocked();
  refresh();
}

/** Просит сервер выполнить действие; результат придёт в onServerState, диалоги продолжаются после подтверждения. */
function dispatch(actionType, handlers) {
  return sync ? sync.send(actionType, handlers) : false;
}

function onServerState(next, meta) {
  const previous = state;
  state = next;
  world?.setTaskState(state);
  refresh();
  // Каждое попадание по мишени не комментируем, остальные подтверждённые действия — да.
  if (meta.changed && meta.feedback && (state.stage !== previous.stage || state.fireHits === previous.fireHits)) setNotice(meta.feedback);
}

function openProfessionCard() {
  showDialog({
    title: 'Работа в команде',
    body: 'Пожарные регулярно тренируются, распределяют роли и учатся пользоваться оборудованием. В этой игре упражнения условные: они знакомят с профессией, но не обучают действиям при реальном пожаре.',
    options: [
      { label: 'Понятно', primary: true, onSelect: () => openBriefing() },
    ],
  });
}

function acceptBriefingOption() {
  return {
    label: 'Поняла, к экипировке',
    primary: true,
    onSelect: () => dispatch('accept_briefing', { onConfirmed: closeDialog, onRejected: closeDialog }),
  };
}

function showBriefingStep() {
  showDialog({
    title: 'Короткий инструктаж',
    body: 'Надень учебную экипировку, затем выполни упражнение на мишени и доставь манекен к зелёной отметке. Здесь всё условно — следуй только игровым подсказкам.',
    options: [acceptBriefingOption()],
  });
}

function openBriefing() {
  if (state.stage === 'not_started') {
    showDialog({
      title: 'Добро пожаловать!',
      body: 'Привет! Я Маруся. Добро пожаловать на учебную смену пожарного! Сегодня ты познакомишься с нашей работой и выполнишь небольшую тренировку.',
      options: [
        { label: 'Начать тренировку', primary: true, onSelect: () => {
          dispatch('start', { onConfirmed: showBriefingStep, onRejected: closeDialog });
        } },
        { label: 'Узнать о профессии', onSelect: openProfessionCard },
        { label: 'Позже', onSelect: closeDialog },
      ],
    });
  } else if (state.stage === 'briefing') {
    showDialog({
      title: 'Короткий инструктаж',
      body: 'Надень учебную экипировку, затем выполни упражнение на мишени и доставь манекен к зелёной отметке. Здесь всё условно — следуй только игровым подсказкам.',
      options: [acceptBriefingOption()],
    });
  } else {
    openProfessionCard();
  }
}

function openDebrief() {
  showDialog({
    title: 'Учебная смена позади',
    body: 'Ты подготовилась, выполнила упражнение на учебной мишени и доставила манекен в отмеченную зону. В этой профессии важны подготовка, внимание и согласованная работа команды.',
    options: [{
      label: 'Завершить смену',
      primary: true,
      onSelect: () => dispatch('report', { onConfirmed: closeDialog, onRejected: closeDialog }),
    }],
  });
}

function onWorldAction(action) {
  if (action === 'open_briefing') return openBriefing();
  if (action === 'open_debrief') return openDebrief();
  dispatch(action);
}

world = createFirefighterScene({
  container: sceneRoot,
  onPrompt: (value) => { prompt = value; refresh(); },
  onAction: onWorldAction,
  onNotice: setNotice,
  onHoseMode: (value) => { hoseActive = value; refresh(); },
  onPosition: (position) => network?.sendPosition(position),
});
world.setTaskState(state);
syncBlocked();
refresh();

// Вход и сеть: тот же клиент, что у основной страницы, но без второго рендерера.
const client = createClient({ container: sceneRoot, networkOnly: true });
const unmountAuth = mountUI(client.api);
network = connectFireNetwork({
  api: client.api,
  world,
  onSession: (value) => {
    online = value;
    if (!online) {
      dialog = null;
      sync.reset();
      setNotice('Вы вышли. Войдите снова, чтобы вернуться на полигон.');
    }
    syncBlocked();
    refresh();
  },
});
sync = createTaskSync({
  api: client.api,
  onState: onServerState,
  onNotice: setNotice,
  onBusy: (value) => { busy = value; refresh(); },
  // Сервер проверяет позицию и взгляд по последнему принятому pos: досылаем его перед действием.
  beforeSend: () => network?.sendPosition(world.localPosition(), { force: true }),
});
client.start();

window.addEventListener('keydown', (event) => {
  if (event.code === 'Escape' && dialog) closeDialog();
});

window.addEventListener('pagehide', (event) => {
  if (event.persisted) return; // страница уходит в bfcache и может вернуться
  clearTimeout(noticeTimer);
  sync?.dispose();
  network?.dispose();
  unmountAuth?.();
  client.stop();
  world?.dispose();
});

import { createFirefighterScene } from './scene.js';
import { createPreviewState, transitionPreview } from './preview-state.js';
import { mountStationUI } from './ui.js';
import './style.css';

const sceneRoot = document.querySelector('#scene');
const uiRoot = document.querySelector('#ui');
let world;
let state = createPreviewState();
let targetWindow = null;
let dialog = null;
let prompt = '';
let notice = 'Демонстрационный режим: прогресс не сохраняется на сервере.';
let hoseActive = false;
let noticeTimer;

const refresh = () => {
  mountStationUI(uiRoot, {
    state,
    prompt,
    notice,
    dialog,
    hoseActive,
    targetWindow,
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

function closeDialog() {
  dialog = null;
  world?.setUiBlocked(false);
  refresh();
}

function showDialog(nextDialog) {
  dialog = nextDialog;
  world?.setUiBlocked(true);
  if (document.pointerLockElement) document.exitPointerLock();
  refresh();
}

function dispatch(actionType, index) {
  const previous = state;
  const result = transitionPreview(state, { type: actionType, index });
  state = result.state;
  world?.setTaskState(state);
  refresh();
  const stageChanged = state?.stage !== previous?.stage;
  if (result.feedback && (actionType !== 'window_hit' || stageChanged || result.state.windows[index]?.status === 'done')) setNotice(result.feedback);
  return result;
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

function openBriefing() {
  if (state.stage === 'not_started') {
    showDialog({
      title: 'Добро пожаловать!',
      body: 'Привет! Я Маруся. Добро пожаловать на учебную смену пожарного! Сегодня ты познакомишься с нашей работой и выполнишь небольшую тренировку.',
      options: [
        { label: 'Начать тренировку', primary: true, onSelect: () => {
          dispatch('start');
          showDialog({
            title: 'Короткий инструктаж',
            body: 'Надень учебную экипировку, потуши все окна учебной стены и доставь манекен к зелёной отметке. Здесь всё условно — следуй только игровым подсказкам.',
            options: [
              { label: 'Поняла, к экипировке', primary: true, onSelect: () => { dispatch('accept_briefing'); closeDialog(); } },
            ],
          });
        } },
        { label: 'Узнать о профессии', onSelect: openProfessionCard },
        { label: 'Позже', onSelect: closeDialog },
      ],
    });
  } else if (state.stage === 'briefing') {
    showDialog({
      title: 'Короткий инструктаж',
      body: 'Надень учебную экипировку, потуши все окна учебной стены и доставь манекен к зелёной отметке. Здесь всё условно — следуй только игровым подсказкам.',
      options: [{ label: 'Поняла, к экипировке', primary: true, onSelect: () => { dispatch('accept_briefing'); closeDialog(); } }],
    });
  } else {
    openProfessionCard();
  }
}

function openDebrief() {
  showDialog({
    title: 'Учебная смена позади',
    body: 'Ты подготовилась, потушила все окна учебной стены и доставила манекен в отмеченную зону. В этой профессии важны подготовка, внимание и согласованная работа команды.',
    options: [{ label: 'Завершить смену', primary: true, onSelect: () => { dispatch('report'); closeDialog(); } }],
  });
}

function onWorldAction(action, index) {
  if (action === 'open_briefing') return openBriefing();
  if (action === 'open_debrief') return openDebrief();
  dispatch(action, index);
}

world = createFirefighterScene({
  container: sceneRoot,
  onPrompt: (value) => { prompt = value; refresh(); },
  onAction: onWorldAction,
  onNotice: setNotice,
  onTarget: (value) => { if (targetWindow !== value) { targetWindow = value; refresh(); } },
  onHoseMode: (value) => { hoseActive = value; refresh(); },
});
world.setTaskState(state);
refresh();

window.addEventListener('keydown', (event) => {
  if (event.code === 'Escape' && dialog) closeDialog();
});

window.addEventListener('beforeunload', () => {
  clearTimeout(noticeTimer);
  world?.dispose();
});

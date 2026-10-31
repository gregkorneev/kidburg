import { createClient } from '../../engine/app.js';
import { bindCityExit } from '../../engine/room-exit.js';
import { mountUI } from '../../ui/index.js';
import { connectFireNetwork } from './network.js';
import { createMarusyaChat } from './chat-flow.js';
import { createFirefighterScene } from './scene.js';
import { createInitialState } from './state.js';
import { createTaskSync } from './tasks.js';
import { mountStationUI } from './ui.js';
import { readQuality } from '../../engine/art/quality.js';
import './style.css';

const CONTROLS_KEY = 'kidburg.firefighter.controls';
function readControlsOpen() {
  try { return globalThis.localStorage?.getItem(CONTROLS_KEY) !== 'closed'; } catch { return true; }
}
function saveControlsOpen(open) {
  try { globalThis.localStorage?.setItem(CONTROLS_KEY, open ? 'open' : 'closed'); } catch { /* не критично */ }
}

const sceneRoot = document.querySelector('#scene');
const uiRoot = document.querySelector('#ui');
let world;
let network = null;
let sync = null;
let busy = false; // ждём подтверждение действия от сервера
let online = false; // вошли на сервер и получили welcome: до этого сцена только фон под экраном входа
let state = createInitialState();
let dialog = null;
let chat = null; // панель разговора через npc_talk (client/ui/npc-chat.js)
let marusya = null; // сценарий разговора с Марусей поверх панели (chat-flow.js)
let chatOpen = false;
let prompt = '';
let notice = '';
let controlsOpen = readControlsOpen();
let quality = 'medium';
let hoseActive = false;
let targetWindow = null;
let noticeTimer;

const refresh = () => {
  marusya?.sync();
  mountStationUI(uiRoot, {
    state,
    prompt,
    notice,
    dialog,
    hoseActive,
    targetWindow,
    busy,
    controlsOpen,
    quality,
    onChoose: (option) => option.onSelect?.(),
    onCloseDialog: closeDialog,
    onToggleControls: toggleControls,
    onQuality: (level) => { quality = world?.setQuality(level) ?? level; refresh(); },
  });
};

function setNotice(message, duration = 2600) {
  notice = message;
  refresh();
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice = ''; refresh(); }, duration);
}

function toggleControls() {
  controlsOpen = !controlsOpen;
  saveControlsOpen(controlsOpen);
  refresh();
}

const syncBlocked = () => world?.setUiBlocked(!online || dialog !== null || chatOpen);

function closeDialog() {
  dialog = null;
  syncBlocked();
  refresh();
}

/** Просит сервер выполнить действие; результат придёт в onServerState, диалоги продолжаются после подтверждения. */
function dispatch(actionType, handlers) {
  return sync ? sync.send(actionType, handlers) : false;
}

function onServerState(next, meta) {
  state = next;
  world?.setTaskState(state);
  refresh();
  // Сервер присылает feedback для всех подтверждённых действий, кроме обычных попаданий по окну.
  if (meta.changed && meta.feedback) setNotice(meta.feedback);
}

/** Разговор с Марусей: реплики генерирует ИИ на сервере, действия подтверждает сервер (chat-flow.js). */
function openChat() {
  dialog = null;
  if (!marusya?.open()) return;
  syncBlocked();
  refresh();
}

function onWorldAction(action, index) {
  if (action === 'open_chat') return openChat();
  dispatch(action, { index });
}

world = createFirefighterScene({
  container: sceneRoot,
  onPrompt: (value) => { prompt = value; refresh(); },
  onAction: onWorldAction,
  onNotice: setNotice,
  onHoseMode: (value) => { hoseActive = value; refresh(); },
  onTarget: (value) => { if (targetWindow !== value) { targetWindow = value; refresh(); } },
  onPosition: (position) => network?.sendPosition(position),
});
quality = world.getQuality?.() ?? readQuality();
world.setTaskState(state);
syncBlocked();
refresh();

// Вход и сеть: тот же клиент, что у основной страницы, но без второго рендерера.
const client = createClient({ container: sceneRoot, networkOnly: true });
const unmountAuth = mountUI(client.api);
chat = unmountAuth.chat;
marusya = createMarusyaChat({
  chat,
  getState: () => state,
  dispatch,
  isOnline: () => online,
  isBusy: () => busy,
  getNotice: () => notice,
});
chat.onOpenChange((open) => {
  chatOpen = open;
  world?.setNpcTalking(open);
  syncBlocked();
  refresh();
});
network = connectFireNetwork({
  api: client.api,
  world,
  onSession: (value) => {
    online = value;
    if (!online) {
      dialog = null;
      marusya?.reset();
      sync.reset();
      setNotice('Вы вышли. Введите имя и код комнаты, чтобы вернуться на полигон.');
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
  if (event.code === 'KeyH' && !event.repeat && !event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) toggleControls();
});

// ?debug=1 открывает сцену в консоли (window.__fire) для ручной проверки графики и производительности.
if (new URLSearchParams(location.search).has('debug')) window.__fire = world.debug;

const unbindCityExit = bindCityExit({
  onExit: () => window.location.assign('/'),
  isBlocked: () => dialog !== null || chatOpen,
});

window.addEventListener('pagehide', (event) => {
  if (event.persisted) return; // страница уходит в bfcache и может вернуться
  clearTimeout(noticeTimer);
  unbindCityExit();
  sync?.dispose();
  network?.dispose();
  unmountAuth?.();
  client.stop();
  world?.dispose();
});

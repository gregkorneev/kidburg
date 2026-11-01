import { bindCityExit } from '../../engine/room-exit.js';
import { readQuality } from '../../engine/art/quality.js';
import { currentPlayerAppearance } from '../../engine/player-appearance.js';
import { applyBakeryAction, createInitialState } from './state.js';
import { createBakeryScene } from './scene.js';
import { bindControlsToggle, mountBakeryUI } from './ui.js';
import { startTelemetry } from '../../engine/telemetry.js';
import { openStationLink, showOfflineProgressWarning } from '../../engine/station-link-browser.js';
import { createStationProgress } from '../../engine/station-progress.js';
import { createStationChatFlow } from '../../engine/station-chat-flow.js';
import { STATION_TASK_IDS } from '../../../shared/station-npcs.js';
import { BAKER, hintForStage, planActions } from './chat-flow.js';
import './style.css';

const sceneRoot = document.querySelector('#scene');
const uiRoot = document.querySelector('#ui');
let state = createInitialState();
let prompt = '';
let notice = '';
let quality = 'medium';
let controlsOpen = true;
let noticeTimer;
let world;
let link = null; // сессия станции и связь с сервером (station-link.js); без неё станция полностью локальная
let progress = null; // зеркало прогресса на сервере
let flow = null; // разговор с мастером-пекарем
let chatOpen = false;

function refresh() {
  flow?.sync();
  mountBakeryUI(uiRoot, { state, prompt, notice, quality, controlsOpen, onToggleControls: toggleControls, onQuality: setQuality });
}

function toggleControls() {
  controlsOpen = !controlsOpen;
  refresh();
}

const unbindControlsToggle = bindControlsToggle(window, toggleControls);

function setNotice(message) {
  notice = message;
  refresh();
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice = ''; refresh(); }, 2400);
}

function setQuality(level) {
  quality = world?.setQuality(level) ?? level;
  refresh();
}

function onAction(action) {
  const result = applyBakeryAction(state, action);
  if (result.accepted) {
    state = result.state;
    world.setState(state);
    // Сервер повторяет действие по тем же правилам и проверяет расстояние: его состояние видит наставник.
    link?.syncPosition();
    progress?.send({ action });
  }
  setNotice(result.feedback);
}

function openChat() {
  if (flow?.open()) world?.setUiBlocked(true);
}

world = createBakeryScene({
  container: sceneRoot,
  appearance: currentPlayerAppearance(),
  onPrompt: (value) => { prompt = value; refresh(); },
  onAction,
  onNotice: setNotice,
  talk: { enabled: () => Boolean(link?.ready) && !chatOpen, onTalk: openChat },
});
quality = world.getQuality();
world.setState(state);
refresh();

// Разговор с пекарем: общий адаптер станции, панель и прогресс на сервере. Без входа игра идёт локально.
link = openStationLink({ stationId: 'bakery', container: sceneRoot, getPosition: () => world?.getPosition(), onChange: refresh });
progress = createStationProgress({
  api: link.api,
  taskId: STATION_TASK_IDS.bakery,
  project: (value) => ({ stage: value.stage, completedOrders: value.completedOrders }),
  getLocal: () => state,
  canSend: () => link.ready,
  onDiverged: showOfflineProgressWarning,
  onReject: (message) => setNotice(message),
  adopt: (server) => {
    state = { stage: server.stage, completedOrders: server.completedOrders };
    world.setState(state);
    refresh();
  },
});
flow = createStationChatFlow({
  chat: link.chat,
  npc: BAKER,
  getStage: () => state.stage,
  hint: hintForStage,
  plan: (stage, helpers) => planActions(stage, helpers, onAction),
  isOnline: () => link.ready,
  getNotice: () => notice,
});
link.chat.onOpenChange((open) => {
  chatOpen = open;
  world.setUiBlocked(open);
});
link.start();

// Temporary local screenshot positions, removed after the visual capture pass.
const captureViews = {
  spawn: { position: { x: 0, z: 5.25 } },
  overview: { position: { x: 0, z: 3.2 }, yaw: 0 },
  ingredients: { position: { x: -4.5, z: 0.5 }, yaw: Math.PI / 2 },
  worktable: { position: { x: 0, z: -1.1 }, yaw: 0 },
  oven: { position: { x: 5, z: 2.25 }, yaw: 0 },
  npc: { position: { x: -5.8, z: 5.7 }, yaw: 0 },
  gameplay: { position: { x: 2.1, z: 3.8 }, yaw: 0.25 },
};
const captureView = new URLSearchParams(location.search).get('view');
if (captureViews[captureView]) {
  world.setPosition(captureViews[captureView].position);
  if (Number.isFinite(captureViews[captureView].yaw)) world.debug.setCameraLook(captureViews[captureView].yaw);
}

const unbindCityExit = bindCityExit({
  onExit: () => window.location.assign('/'),
  isBlocked: () => chatOpen,
});

// Центральный мониторинг Control Center: FPS и ping этой страницы; кадры — по фактическим вызовам renderer.render.
const telemetry = startTelemetry({
  loc: 'bakery',
  getQuality: () => quality,
  getFrameCount: () => world?.debug.renderer?.info.render.frame,
  getRenderInfo: () => {
    const info = world?.debug.renderer?.info;
    return info ? { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures } : null;
  },
});

if (new URLSearchParams(location.search).has('debug')) window.__bakery = world.debug;

window.addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  clearTimeout(noticeTimer);
  unbindCityExit();
  unbindControlsToggle();
  progress?.dispose();
  link?.dispose();
  telemetry.stop();
  world?.dispose();
});

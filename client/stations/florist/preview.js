import { createFloristScene } from './scene.js';
import { currentPlayerAppearance } from '../../engine/player-appearance.js';
import { createInitialState, orderMatches, ribbonForKey, transitionTask } from './state.js';
import { mountFloristUI } from './ui.js';
import { startTelemetry } from '../../engine/telemetry.js';
import { openStationLink, showOfflineProgressWarning } from '../../engine/station-link-browser.js';
import { createStationProgress } from '../../engine/station-progress.js';
import { createStationChatFlow } from '../../engine/station-chat-flow.js';
import { STATION_TASK_IDS } from '../../../shared/station-npcs.js';
import { LILIA, hintForStage, planActions } from './chat-flow.js';
import './style.css';

const isTyping = (target) => !!target?.closest?.('input, textarea, select, [contenteditable="true"]');
const root = document.querySelector('#florist-scene');
const uiRoot = document.querySelector('#florist-ui');
let state = createInitialState();
let prompt = '';
let notice = '';
let noticeType = 'success';
let controlsOpen = true;
let quality = 'medium';
let noticeTimer = null;
let statsTimer = null;
let scene;
let link = null; // сессия станции и связь с сервером; без неё станция полностью локальная
let progress = null; // зеркало прогресса на сервере (station_tasks.js)
let flow = null; // разговор с Лилией
let chatOpen = false;

function renderUI() {
  flow?.sync();
  mountFloristUI(uiRoot, {
    state,
    prompt,
    notice,
    noticeType,
    controlsOpen,
    quality,
    onQuality: (level) => {
      const result = scene.setQuality(level);
      quality = result.level;
      showNotice(`Качество графики: ${result.label.toLowerCase()}.`);
    },
    onAcceptOrder: () => commit({ type: 'accept_order' }),
    onRibbon: (ribbon) => commit({ type: 'choose_ribbon', ribbon }),
    onRepeat: () => commit({ type: 'repeat' }),
    onToggleControls: () => { controlsOpen = !controlsOpen; renderUI(); },
  });
}

function showNotice(message, type = 'info') {
  notice = message ?? '';
  noticeType = type;
  renderUI();
  clearTimeout(noticeTimer);
  if (notice) noticeTimer = setTimeout(() => { notice = ''; renderUI(); }, 3000);
}

function serverPayload(action) {
  const payload = { action: action.type };
  if (typeof action.flower === 'string') payload.flower = action.flower;
  if (typeof action.ribbon === 'string') payload.ribbon = action.ribbon;
  return payload;
}

function openChat() {
  return flow?.open() === true;
}

function commit(action) {
  const result = transitionTask(state, action);
  if (!result.changed) {
    if (result.feedback) showNotice(result.feedback, 'error');
    return false;
  }
  state = result.state;
  scene.setTaskState(state);
  const modal = ['briefing', 'completed'].includes(state.stage);
  scene.setUiBlocked(modal || chatOpen);
  scene.setTalking(modal);
  // Сервер повторяет действие по тем же правилам и проверяет расстояние: его состояние видит Лилия.
  link?.syncPosition();
  progress?.send(serverPayload(action));
  notice = result.feedback;
  noticeType = 'success';
  renderUI();
  clearTimeout(noticeTimer);
  if (notice) noticeTimer = setTimeout(() => { notice = ''; renderUI(); }, 3000);
  return true;
}

scene = createFloristScene({
  container: root,
  appearance: currentPlayerAppearance(),
  onPrompt: (value) => {
    if (prompt === value) return;
    prompt = value;
    renderUI();
  },
  canTalk: () => Boolean(link?.ready) && !chatOpen,
  onAction: (target) => {
    if (target.kind === 'lilia') {
      if (openChat()) return;
      if (state.stage === 'not_started') commit({ type: 'start_briefing' });
      else if (state.stage === 'completed') showNotice('Нажми «Повторить заказ», чтобы начать заново.');
      else showNotice('Лилия улыбается и ждёт, пока ты продолжишь заказ.');
    } else if (target.kind === 'take') commit({ type: 'take_flower', flower: target.flower });
    else if (target.kind === 'add') commit({ type: 'add_flower' });
    else if (target.kind === 'remove') commit({ type: 'remove_last' });
    else if (target.kind === 'wrap') commit({ type: 'wrap' });
    else if (target.kind === 'handoff') commit({ type: 'handoff' });
  },
});

quality = scene.getQuality();

// Разговор с Лилией: общий адаптер станции, панель и прогресс на сервере. Без входа игра идёт локально.
link = openStationLink({ stationId: 'florist', container: root, getPosition: () => scene?.getPosition(), setPosition: (p) => scene?.setPosition(p), onChange: renderUI });
progress = createStationProgress({
  api: link.api,
  taskId: STATION_TASK_IDS.florist,
  project: (value) => ({
    stage: value.stage,
    held: value.heldFlower?.type ?? null,
    stems: value.stems.map((stem) => stem.type),
    ribbon: value.ribbon,
    wrapped: value.wrapped,
  }),
  getLocal: () => state,
  canSend: () => link.ready,
  onDiverged: showOfflineProgressWarning,
  onReject: (message) => showNotice(message, 'error'),
  adopt: (server) => {
    state = { stage: server.stage, heldFlower: server.heldFlower, stems: server.stems, ribbon: server.ribbon, wrapped: server.wrapped };
    scene.setTaskState(state);
    const modal = ['briefing', 'completed'].includes(state.stage);
    scene.setUiBlocked(modal || chatOpen);
    scene.setTalking(modal);
    renderUI();
  },
});
flow = createStationChatFlow({
  chat: link.chat,
  npc: LILIA,
  getStage: () => state.stage,
  hint: hintForStage,
  // Кнопка действия закрывает панель: дальше игру продолжает окно инструктажа.
  plan: (stage, helpers) => planActions(stage, helpers, (action) => { link.chat.close(); commit(action); }),
  isOnline: () => link.ready,
  getNotice: () => notice,
});
link.chat.onOpenChange((open) => {
  chatOpen = open;
  scene.setUiBlocked(open || ['briefing', 'completed'].includes(state.stage));
  scene.setTalking(open);
});
link.start();

if (new URLSearchParams(window.location.search).has('debug')) {
  window.__floristDebug = {
    setQuality: (level) => { quality = scene.setQuality(level).level; renderUI(); },
    getRenderStats: () => scene.getRenderStats(),
    getState: () => state,
    getPosition: () => scene.getPosition(),
  };
  statsTimer = window.setInterval(() => {
    const canvas = root.querySelector('canvas');
    if (canvas) canvas.dataset.renderStats = JSON.stringify(scene.getRenderStats());
  }, 500);
}

scene.setTaskState(state);
renderUI();

// Центральный мониторинг Control Center: FPS и ping этой страницы.
// Кадры — по фактическим вызовам renderer.render (счётчик renderer.info.render.frame из getRenderStats).
const telemetry = startTelemetry({ loc: 'florist', getQuality: () => quality, getRenderInfo: () => scene.getRenderStats(), getFrameCount: () => scene.getRenderStats().frame });

function onKeyDown(event) {
  if (isTyping(event.target) || event.repeat) return;
  const ribbon = ribbonForKey(event.code);
  if (ribbon && state.stage === 'wrapping' && orderMatches(state.stems)) {
    commit({ type: 'choose_ribbon', ribbon });
  } else if (event.code === 'KeyH') {
    controlsOpen = !controlsOpen;
    renderUI();
  } else if (event.code === 'KeyL' && !chatOpen && !['briefing', 'completed'].includes(state.stage)) {
    window.location.assign('/');
  }
}

window.addEventListener('keydown', onKeyDown);
window.addEventListener('pagehide', () => {
  clearTimeout(noticeTimer);
  clearInterval(statsTimer);
  window.removeEventListener('keydown', onKeyDown);
  progress?.dispose();
  link?.dispose();
  telemetry.stop();
  scene.dispose();
}, { once: true });

import { createPianistScene } from './scene.js';
import { bindCityExit } from '../../engine/room-exit.js';
import { currentPlayerAppearance } from '../../engine/player-appearance.js';
import { createInitialState, transitionTask } from './state.js';
import { MELODY } from './melody.js';
import { noteById } from './melody.js';
import { createPianoAudio } from './audio.js';
import { mountPianistUI } from './ui.js';
import { openStationLink, showOfflineProgressWarning } from '../../engine/station-link-browser.js';
import { createStationProgress } from '../../engine/station-progress.js';
import { createStationChatFlow } from '../../engine/station-chat-flow.js';
import { STATION_TASK_IDS } from '../../../shared/station-npcs.js';
import { MAESTRO, hintForStage, planActions } from './chat-flow.js';
import './style.css';

const sceneRoot = document.querySelector('#pianist-scene');
const uiRoot = document.querySelector('#pianist-ui');
let state = createInitialState();
let prompt = ''; let notice = ''; let noticeType = 'info'; let controlsOpen = true; let quality = 'medium';
let noticeTimer = 0; let statsTimer = 0;
const sampleTimers = new Set();
const audio = createPianoAudio();
let scene;
let link = null; // сессия станции и связь с сервером; без неё станция полностью локальная
let progress = null; // зеркало прогресса на сервере (station_tasks.js)
let flow = null; // разговор с Маэстро
let chatOpen = false;
const isTyping = (target) => !!target?.closest?.('input, textarea, select, [contenteditable="true"]');

function renderUI() {
  flow?.sync();
  mountPianistUI(uiRoot, {
    state, prompt, notice, noticeType, controlsOpen, quality,
    online: Boolean(link?.ready), chatOpen, onTalk: () => { openChat(); },
    onQuality: (level) => { const result = scene.setQuality(level); quality = result.level; showNotice(`Качество графики: ${result.label.toLowerCase()}.`); },
    onAccept: () => commit({ type: 'accept' }), onRepeat: () => commit({ type: 'repeat' }),
    onListen: () => {
      for (const timer of sampleTimers) clearTimeout(timer);
      sampleTimers.clear(); audio.setEnabled(state.soundEnabled); audio.setVolume(state.volume);
      MELODY.forEach((id, i) => {
        const timer = window.setTimeout(() => { sampleTimers.delete(timer); audio.play(id); }, i * 430);
        sampleTimers.add(timer);
      });
    },
    onToggleSound: () => { const result = transitionTask(state, { type: 'toggle_sound' }); state = result.state; audio.setEnabled(state.soundEnabled); renderUI(); },
    onVolume: (value) => { const result = transitionTask(state, { type: 'volume', value }); state = result.state; audio.setVolume(value); renderUI(); },
    onToggleControls: () => { controlsOpen = !controlsOpen; renderUI(); },
  });
}

function showNotice(message, type = 'info') {
  notice = message ?? ''; noticeType = type; renderUI(); clearTimeout(noticeTimer);
  if (notice) noticeTimer = window.setTimeout(() => { notice = ''; renderUI(); }, 3200);
}

// Громкость и звук — настройки браузера; на сервер уходят только игровые действия.
const SERVER_ACTIONS = new Set(['start_briefing', 'accept', 'enter_piano', 'leave_piano', 'repeat', 'note']);

function serverPayload(action) {
  const payload = { action: action.type };
  if (action.type === 'note') payload.note = action.note;
  return payload;
}

function openChat() {
  return flow?.open() === true;
}

function commit(action) {
  const result = transitionTask(state, action);
  if (!result.changed) { if (result.feedback) showNotice(result.feedback, 'error'); return false; }
  state = result.state; scene.setTaskState(state);
  const modal = ['briefing', 'completed'].includes(state.stage);
  scene.setUiBlocked(modal || chatOpen);
  // Сервер повторяет действие по тем же правилам и проверяет расстояние: звук и клавиши остаются мгновенными, факты — на сервере.
  if (SERVER_ACTIONS.has(action.type)) {
    link?.syncPosition();
    progress?.send(serverPayload(action));
  }
  notice = result.feedback; noticeType = action.type === 'note' ? 'success' : 'info'; renderUI();
  clearTimeout(noticeTimer); if (notice) noticeTimer = window.setTimeout(() => { notice = ''; renderUI(); }, 3200);
  return true;
}

scene = createPianistScene({
  container: sceneRoot,
  appearance: currentPlayerAppearance(),
  onPrompt: (value) => { if (prompt !== value) { prompt = value; renderUI(); } },
  canTalk: () => Boolean(link?.ready) && !chatOpen,
  onNote: (noteId) => { audio.setEnabled(state.soundEnabled); audio.setVolume(state.volume); audio.play(noteId); },
  onAction: (event) => {
    if (event.kind === 'maestro') {
      if (openChat()) return;
      if (state.stage === 'not_started') commit({ type: 'start_briefing' });
      else if (state.stage === 'completed') showNotice('Маэстро Артём улыбается. Нажми «Повторить урок», чтобы сыграть снова.');
      else showNotice('Маэстро Артём кивает тебе: продолжай тренировку!');
    } else if (event.kind === 'practice-piano') commit({ type: 'enter_piano' });
    else if (event.kind === 'stage-piano') commit({ type: 'enter_piano', atStage: true });
    else if (event.kind === 'leave-piano') commit({ type: 'leave_piano' });
    else if (event.kind === 'note') commit({ type: 'note', note: event.note, at: event.at });
  },
});
quality = scene.getQuality();
scene.setTaskState(state); renderUI();

// Разговор с Маэстро: общий адаптер станции, панель и прогресс на сервере. Без входа игра идёт локально.
link = openStationLink({ stationId: 'pianist', container: sceneRoot, getPosition: () => scene?.getPosition(), setPosition: (p) => scene?.setPosition(p), onChange: renderUI });
progress = createStationProgress({
  api: link.api,
  taskId: STATION_TASK_IDS.pianist,
  project: (value) => ({ stage: value.stage, index: value.index, pianoMode: value.pianoMode === true }),
  getLocal: () => state,
  canSend: () => link.ready,
  onDiverged: showOfflineProgressWarning,
  onReject: (message) => showNotice(message, 'error'),
  adopt: (server) => {
    // Звук и громкость — настройки браузера: подставляется только игровой прогресс сервера.
    state = { ...state, stage: server.stage, index: server.index, pianoMode: server.pianoMode === true };
    scene.setTaskState(state);
    scene.setUiBlocked(['briefing', 'completed'].includes(state.stage) || chatOpen);
    renderUI();
  },
});
// При входе сервер сбрасывает режим инструмента после первоначального task_state из hello.
const unbindStationResume = link.api.on('station_state', (msg) => {
  if (msg.stationId === 'pianist' && msg.ok) progress.send({ action: 'resume' });
});
flow = createStationChatFlow({
  chat: link.chat,
  npc: MAESTRO,
  getStage: () => state.stage,
  hint: hintForStage,
  // Кнопка действия закрывает панель: дальше игру продолжает окно урока.
  plan: (stage, helpers) => planActions(stage, helpers, (action) => { link.chat.close(); commit(action); }),
  isOnline: () => link.ready,
  getNotice: () => notice,
});
link.chat.onOpenChange((open) => {
  chatOpen = open;
  scene.setUiBlocked(open || ['briefing', 'completed'].includes(state.stage));
  renderUI();
});
link.start();

function onKeyDown(event) {
  if (event.repeat || isTyping(event.target)) return;
  if (event.code === 'KeyH' && !state.pianoMode) { controlsOpen = !controlsOpen; renderUI(); }
}
window.addEventListener('keydown', onKeyDown);
const unbindCityExit = bindCityExit({ onExit: () => window.location.assign('/'), isBlocked: () => chatOpen });
if (new URLSearchParams(window.location.search).has('debug')) {
  window.__pianistDebug = {
    setQuality: (level) => { quality = scene.setQuality(level).level; renderUI(); },
    getRenderStats: () => scene.getRenderStats(), getState: () => state, getPosition: () => scene.getPosition(),
    playNote: (id) => { audio.play(id); },
  };
  statsTimer = window.setInterval(() => {
    const canvas = sceneRoot.querySelector('canvas');
    if (canvas) {
      canvas.dataset.renderStats = JSON.stringify(scene.getRenderStats());
      canvas.dataset.keyPositions = JSON.stringify(scene.getKeyScreenPositions());
      canvas.dataset.taskDebug = JSON.stringify({ stage: state.stage, pianoMode: state.pianoMode, position: scene.getPosition() });
    }
  }, 500);
}
window.addEventListener('pagehide', () => {
  clearTimeout(noticeTimer); clearInterval(statsTimer);
  for (const timer of sampleTimers) clearTimeout(timer); sampleTimers.clear();
  window.removeEventListener('keydown', onKeyDown); unbindCityExit(); unbindStationResume(); progress?.dispose(); link?.dispose(); scene.dispose(); audio.dispose();
}, { once: true });

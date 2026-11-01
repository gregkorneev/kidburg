import { createPianistScene } from './scene.js';
import { currentPlayerAppearance } from '../../engine/player-appearance.js';
import { createInitialState, transitionTask } from './state.js';
import { MELODY } from './melody.js';
import { noteById } from './melody.js';
import { createPianoAudio } from './audio.js';
import { mountPianistUI } from './ui.js';
import './style.css';

const sceneRoot = document.querySelector('#pianist-scene');
const uiRoot = document.querySelector('#pianist-ui');
let state = createInitialState();
let prompt = ''; let notice = ''; let noticeType = 'info'; let controlsOpen = true; let quality = 'medium';
let noticeTimer = 0; let statsTimer = 0;
const sampleTimers = new Set();
const audio = createPianoAudio();
let scene;

function renderUI() {
  mountPianistUI(uiRoot, {
    state, prompt, notice, noticeType, controlsOpen, quality,
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

function commit(action) {
  const result = transitionTask(state, action);
  if (!result.changed) { if (result.feedback) showNotice(result.feedback, 'error'); return false; }
  state = result.state; scene.setTaskState(state);
  const modal = ['briefing', 'completed'].includes(state.stage);
  scene.setUiBlocked(modal);
  notice = result.feedback; noticeType = action.type === 'note' ? 'success' : 'info'; renderUI();
  clearTimeout(noticeTimer); if (notice) noticeTimer = window.setTimeout(() => { notice = ''; renderUI(); }, 3200);
  return true;
}

scene = createPianistScene({
  container: sceneRoot,
  appearance: currentPlayerAppearance(),
  onPrompt: (value) => { if (prompt !== value) { prompt = value; renderUI(); } },
  onNote: (noteId) => { audio.setEnabled(state.soundEnabled); audio.setVolume(state.volume); audio.play(noteId); },
  onAction: (event) => {
    if (event.kind === 'maestro') {
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

function onKeyDown(event) {
  if (event.repeat) return;
  if (event.code === 'KeyH' && !state.pianoMode) { controlsOpen = !controlsOpen; renderUI(); }
}
window.addEventListener('keydown', onKeyDown);
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
  window.removeEventListener('keydown', onKeyDown); scene.dispose(); audio.dispose();
}, { once: true });

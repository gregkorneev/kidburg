import { createFloristScene } from './scene.js';
import { createInitialState, transitionTask } from './state.js';
import { mountFloristUI } from './ui.js';
import './style.css';

const isTyping = (target) => !!target?.closest?.('input, textarea, select, [contenteditable="true"]');
const root = document.querySelector('#florist-scene');
const uiRoot = document.querySelector('#florist-ui');
let state = createInitialState();
let prompt = '';
let notice = '';
let controlsOpen = true;
let noticeTimer = null;
let scene;

function renderUI() {
  mountFloristUI(uiRoot, {
    state,
    prompt,
    notice,
    controlsOpen,
    onAcceptOrder: () => commit({ type: 'accept_order' }),
    onRibbon: (ribbon) => commit({ type: 'choose_ribbon', ribbon }),
    onRepeat: () => commit({ type: 'repeat' }),
    onToggleControls: () => { controlsOpen = !controlsOpen; renderUI(); },
  });
}

function showNotice(message) {
  notice = message ?? '';
  renderUI();
  clearTimeout(noticeTimer);
  if (notice) noticeTimer = setTimeout(() => { notice = ''; renderUI(); }, 3000);
}

function commit(action) {
  const result = transitionTask(state, action);
  if (!result.changed) {
    if (result.feedback) showNotice(result.feedback);
    return false;
  }
  state = result.state;
  scene.setTaskState(state);
  const modal = ['briefing', 'completed'].includes(state.stage);
  scene.setUiBlocked(modal);
  scene.setTalking(modal);
  notice = result.feedback;
  renderUI();
  clearTimeout(noticeTimer);
  if (notice) noticeTimer = setTimeout(() => { notice = ''; renderUI(); }, 3000);
  return true;
}

scene = createFloristScene({
  container: root,
  onPrompt: (value) => {
    if (prompt === value) return;
    prompt = value;
    renderUI();
  },
  onAction: (target) => {
    if (target.kind === 'lilia') {
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

scene.setTaskState(state);
renderUI();

function onKeyDown(event) {
  if (isTyping(event.target) || event.repeat) return;
  if (event.code === 'KeyH') {
    controlsOpen = !controlsOpen;
    renderUI();
  } else if (event.code === 'KeyL' && !['briefing', 'completed'].includes(state.stage)) {
    window.location.assign('/');
  }
}

window.addEventListener('keydown', onKeyDown);
window.addEventListener('pagehide', () => {
  clearTimeout(noticeTimer);
  window.removeEventListener('keydown', onKeyDown);
  scene.dispose();
}, { once: true });

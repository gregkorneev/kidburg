import { bindCityExit } from '../../engine/room-exit.js';
import { readQuality } from '../../engine/art/quality.js';
import { applyBakeryAction, createInitialState } from './state.js';
import { createBakeryScene } from './scene.js';
import { mountBakeryUI } from './ui.js';
import './style.css';

const sceneRoot = document.querySelector('#scene');
const uiRoot = document.querySelector('#ui');
let state = createInitialState();
let prompt = '';
let notice = '';
let quality = 'medium';
let noticeTimer;
let world;

function refresh() {
  mountBakeryUI(uiRoot, { state, prompt, notice, quality, onQuality: setQuality });
}

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
  }
  setNotice(result.feedback);
}

world = createBakeryScene({
  container: sceneRoot,
  onPrompt: (value) => { prompt = value; refresh(); },
  onAction,
  onNotice: setNotice,
});
quality = world.getQuality();
world.setState(state);
refresh();

const unbindCityExit = bindCityExit({
  onExit: () => window.location.assign('/'),
});

if (new URLSearchParams(location.search).has('debug')) window.__bakery = world.debug;

window.addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  clearTimeout(noticeTimer);
  unbindCityExit();
  world?.dispose();
});

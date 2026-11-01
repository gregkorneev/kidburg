import { bindCityExit } from '../../engine/room-exit.js';
import { readQuality } from '../../engine/art/quality.js';
import { currentPlayerAppearance } from '../../engine/player-appearance.js';
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
  appearance: currentPlayerAppearance(),
  onPrompt: (value) => { prompt = value; refresh(); },
  onAction,
  onNotice: setNotice,
});
quality = world.getQuality();
world.setState(state);
refresh();

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
});

if (new URLSearchParams(location.search).has('debug')) window.__bakery = world.debug;

window.addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  clearTimeout(noticeTimer);
  unbindCityExit();
  world?.dispose();
});

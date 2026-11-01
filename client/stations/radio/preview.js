import { createRadioTaskSync } from './tasks.js';
import { createCountdown } from './countdown.js';
import { createTeleprompter } from './teleprompter.js';
import { createRadioStudio } from './scene.js';
import { mountRadioUI, unmountRadioUI } from './ui.js';
import { navigateWithLoading } from '../../engine/location-loading.js';

/** Orchestrates the isolated studio, existing server task sync, and Radio UI. */
export function mountRadioPreview({
  api,
  root,
  window: win = globalThis.window,
  studioFactory = createRadioStudio,
  mountUI = mountRadioUI,
  unmountUI = unmountRadioUI,
  teleprompterFactory = createTeleprompter,
  countdownFactory = createCountdown,
}) {
  const doc = root.ownerDocument ?? globalThis.document;
  if (!doc?.createElement) throw new TypeError('Radio preview needs a document');
  const stage = doc.createElement('div');
  stage.className = 'radio-studio-stage';
  root.replaceChildren(stage);

  let studio;
  try {
    studio = studioFactory({ container: stage, window: win });
  } catch (error) {
    stage.remove?.();
    throw error;
  }
  const monitorMount = typeof studio.getMonitorMount === 'function'
    ? studio.getMonitorMount()
    : studio.monitorMount;
  if (!monitorMount?.mount) {
    studio.dispose();
    stage.remove?.();
    throw new TypeError('Radio Studio must provide a monitor mount');
  }
  const uiRoot = doc.createElement('div');
  uiRoot.className = 'radio-studio-ui-root';
  let uiMounted = false;
  const cleanupUI = () => {
    if (!uiMounted) return;
    uiMounted = false;
    unmountUI(uiRoot);
  };
  try {
    if (!monitorMount.mount(uiRoot, cleanupUI)) throw new Error('Radio monitor mount is unavailable');
    uiMounted = true;
  } catch (error) {
    studio.dispose();
    stage.remove?.();
    throw error;
  }

  let state = null;
  let pending = null;
  let connected = api.net.status === 'open';
  let notice = '';
  let countdownValue = null;
  let presentationPhase = 'idle';
  let prompterGroup = '';
  let selectedSpeed = 'normal';
  let recoveryRequested = false;
  let noticeTimer = null;
  let sync;
  let offAuth = () => {};
  let offPreviewError = () => {};
  let disposed = false;

  const teleprompter = teleprompterFactory({
    onChange(group) {
      prompterGroup = group;
      if (!disposed) refresh();
    },
  });
  const countdown = countdownFactory({ onTick: (value) => {
    const finishedCountdown = presentationPhase === 'countdown' && value === null;
    countdownValue = value;
    if (value !== null) studio.setOnAir(false);
    if (finishedCountdown && !disposed && state?.stage === 'on_air') {
      presentationPhase = 'live';
      teleprompter.start(state.script?.text ?? '');
      studio.setOnAir(true);
    }
    if (!disposed) refresh();
  } });

  const refresh = () => mountUI(uiRoot, {
    state, pending, connected, notice, countdown: countdownValue, prompterGroup,
    speed: selectedSpeed, paused: teleprompter.paused,
    onStart: () => sync.send('start_broadcast'),
    onComplete: () => sync.send('complete_broadcast'),
    onNew: () => sync.send('new_broadcast'),
    onSpeed: (speed) => { selectedSpeed = speed; teleprompter.setSpeed(speed); refresh(); },
    onPause: () => { teleprompter.togglePause(); refresh(); },
    onLeave: leaveStation,
  });

  function showNotice(value) {
    notice = value;
    refresh();
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice = ''; refresh(); }, 6000);
  }

  function beginCountdown() {
    if (disposed || presentationPhase !== 'idle') return;
    presentationPhase = 'countdown';
    studio.setOnAir(false);
    teleprompter.stop();
    countdown.start();
  }

  sync = createRadioTaskSync({
    api,
    onState(next) {
      state = next;
      if (next.stage !== 'choose_topic') recoveryRequested = false;
      if (next.stage === 'on_air') {
        if (presentationPhase === 'idle') beginCountdown();
        else if (presentationPhase === 'countdown') studio.setOnAir(false);
        else if (presentationPhase === 'live' && !teleprompter.matches(next.script?.text)) {
          teleprompter.start(next.script?.text ?? '');
        }
      } else {
        presentationPhase = 'idle';
        studio.setOnAir(false);
        countdown.cancel();
        teleprompter.stop();
      }
      refresh();
      if ((next.stage === 'idle' || (next.stage === 'choose_topic' && !next.category)) && !sync.pending) sync.send('open');
      if (next.stage === 'choose_topic' && next.category && !sync.pending && !recoveryRequested) {
        recoveryRequested = true;
        sync.send('generate_script');
      }
    },
    onNotice: showNotice,
    onPending(value) { pending = value; refresh(); },
    onConnection(value) {
      connected = value;
      if (!value && state?.stage === 'on_air' && presentationPhase === 'live') {
        presentationPhase = 'idle';
        studio.setOnAir(false);
        teleprompter.stop();
      }
      refresh();
    },
  });

  offAuth = api.on('auth', (info) => {
    if (!info) {
      state = null;
      pending = null;
      presentationPhase = 'idle';
      countdown.cancel();
      countdownValue = null;
      studio.setOnAir(false);
      refresh();
    }
  });
  offPreviewError = api.on('preview_error', ({ message }) => showNotice(message));

  function dispose() {
    if (disposed) return;
    disposed = true;
    presentationPhase = 'disposed';
    clearTimeout(noticeTimer);
    countdown.cancel();
    teleprompter.dispose();
    sync.dispose();
    offAuth();
    offPreviewError();
    studio.dispose();
    stage.remove?.();
  }

  function leaveStation() {
    dispose();
    navigateWithLoading(win, doc, '/');
  }

  refresh();
  return dispose;
}

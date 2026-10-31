import { createInitialState, transitionTask, FIRE_HIT_LIMIT } from './state.js';

export const WINDOW_COUNT = 4;
export const WINDOW_HIT_LIMIT = 12;
export function createPreviewState() {
  return { ...createInitialState(), windows: Array.from({ length: WINDOW_COUNT }, () => ({ status: 'active', hits: 0 })) };
}
export function transitionPreview(state, action) {
  if (action.type !== 'window_hit') return transitionTask(state, action);
  const index = action.index;
  if (state.stage !== 'fire_drill' || !Number.isInteger(index) || !state.windows[index] || state.windows[index].status === 'done') {
    return { state, changed: false, feedback: 'Эта цель сейчас недоступна.' };
  }
  const windows = state.windows.map((window, i) => {
    if (i !== index) return window;
    const hits = Math.min(WINDOW_HIT_LIMIT, window.hits + 1);
    return { hits, status: hits === WINDOW_HIT_LIMIT ? 'done' : 'extinguishing' };
  });
  const done = windows.filter((window) => window.status === 'done').length;
  const complete = done === WINDOW_COUNT;
  return {
    state: { ...state, windows, ...(complete ? { stage: 'rescue', fireHits: FIRE_HIT_LIMIT } : {}) },
    changed: true,
    feedback: complete ? 'Все окна потушены! Теперь найдите учебный манекен.' : windows[index].status === 'done' ? `Окно ${index + 1} потушено! Осталось: ${WINDOW_COUNT - done}.` : '',
  };
}

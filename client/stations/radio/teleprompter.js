// Group the approved script into short, timed prompts for the live monitor.
export const TELEPROMPTER_SPEEDS = Object.freeze({ slow: 1600, normal: 1000, fast: 650 });
export const TELEPROMPTER_SPEED_LABELS = Object.freeze({ slow: 'Медленно', normal: 'Обычно', fast: 'Быстро' });

export function groupTeleprompterWords(text) {
  const words = String(text ?? '').trim().split(/\s+/u).filter(Boolean);
  const groups = [];
  let offset = 0;
  while (words.length - offset > 3) {
    const left = words.length - offset;
    const size = left === 4 ? 2 : 3;
    groups.push(words.slice(offset, offset + size).join(' '));
    offset += size;
  }
  if (offset < words.length) groups.push(words.slice(offset).join(' '));
  return groups;
}

export function createTeleprompter({
  onChange = () => {},
  timers = globalThis,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
} = {}) {
  let speed = 'normal';
  let paused = false;
  let active = false;
  let groups = [];
  let index = 0;
  let sourceText = '';
  let timer = null;
  let dueAt = 0;
  let remainingMs = 0;
  let disposed = false;

  const clearTimer = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };
  const notify = () => onChange(groups[index] ?? '', {
    index,
    total: groups.length,
    isLast: groups.length > 0 && index === groups.length - 1,
  });

  function schedule(delay = TELEPROMPTER_SPEEDS[speed]) {
    clearTimer();
    if (!active || paused || index >= groups.length - 1) return;
    remainingMs = Math.max(0, delay);
    dueAt = now() + remainingMs;
    timer = timers.setTimeout(() => {
      timer = null;
      if (!active || paused || index >= groups.length - 1) return;
      index += 1;
      notify();
      schedule(TELEPROMPTER_SPEEDS[speed]);
    }, remainingMs);
  }

  function stop(notifyChange = true) {
    clearTimer();
    active = false;
    paused = false;
    groups = [];
    index = 0;
    sourceText = '';
    remainingMs = 0;
    if (notifyChange) notify();
  }

  return {
    get speed() { return speed; },
    get paused() { return paused; },
    get active() { return active; },
    get group() { return groups[index] ?? ''; },
    get groups() { return [...groups]; },
    get index() { return index; },
    get total() { return groups.length; },
    get isLast() { return groups.length > 0 && index === groups.length - 1; },
    matches(text) { return active && sourceText === String(text ?? '').trim(); },
    start(text) {
      if (disposed) return '';
      stop(false);
      sourceText = String(text ?? '').trim();
      groups = groupTeleprompterWords(sourceText);
      active = groups.length > 0;
      if (active) {
        index = 0;
        notify();
        schedule();
      } else notify();
      return this.group;
    },
    setSpeed(value) {
      if (!(value in TELEPROMPTER_SPEEDS)) return false;
      if (value === speed) return true;
      speed = value;
      if (active) {
        if (paused) remainingMs = TELEPROMPTER_SPEEDS[speed];
        else schedule(TELEPROMPTER_SPEEDS[speed]);
      }
      return true;
    },
    pause() {
      if (!active || paused) return paused;
      remainingMs = Math.max(0, dueAt - now());
      clearTimer();
      paused = true;
      return true;
    },
    resume() {
      if (!active || !paused) return false;
      paused = false;
      schedule(remainingMs);
      return true;
    },
    togglePause() { return paused ? (this.resume(), false) : this.pause(); },
    stop() { stop(); },
    dispose() {
      if (disposed) return;
      stop(false);
      disposed = true;
    },
  };
}

// Минимальное хранилище и хук подписки: перерисовываются только компоненты, чей выбранный срез изменился.

import { useEffect, useRef, useState } from 'preact/hooks';

export function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : { ...state, ...patch };
      if (next === state) return;
      state = next;
      for (const fn of [...listeners]) fn(state);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** Подписка на срез состояния: selector(state) сравнивается через Object.is. */
export function useStore(store, selector = (s) => s) {
  const [value, setValue] = useState(() => selector(store.get()));
  const ref = useRef(selector);
  ref.current = selector;
  useEffect(() => {
    const check = (s) => setValue((prev) => {
      const next = ref.current(s);
      return Object.is(prev, next) ? prev : next;
    });
    check(store.get());
    return store.subscribe(check);
  }, [store]);
  return value;
}

// Общие часы: один таймер на всё приложение, работает только пока есть подписчики.
const clockListeners = new Set();
let clockTimer = null;
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const fn = () => setNow(Date.now());
    clockListeners.add(fn);
    if (clockTimer === null) clockTimer = setInterval(() => clockListeners.forEach((f) => f()), intervalMs);
    fn();
    return () => {
      clockListeners.delete(fn);
      if (clockListeners.size === 0) {
        clearInterval(clockTimer);
        clockTimer = null;
      }
    };
  }, [intervalMs]);
  return now;
}

/** Безобидные предпочтения (вкладка, фильтры): только localStorage, всё в try/catch. */
const PREFS_KEY = 'carrierium_admin_prefs';
export function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const data = raw ? JSON.parse(raw) : {};
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}
export function savePrefs(patch) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...patch }));
  } catch {
    // хранилище недоступно: не критично
  }
}

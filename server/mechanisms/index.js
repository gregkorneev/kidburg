// Общее состояние механизмов мира (shared/mechanisms.js). Хранится в памяти процесса: после перезапуска сервера
// все механизмы в исходном положении. Сервер знает цель и время переключения; анимацию доигрывает клиент.
import { MECHANISM_IDS, MECHANISM_REACH_MARGIN, MECHANISMS, isMechanismId } from '../../shared/mechanisms.js';

export function createMechanisms({ now = Date.now } = {}) {
  /** @type {Map<string, {active: boolean, since: number}>} */
  const states = new Map(MECHANISM_IDS.map((id) => [id, { active: false, since: now(), start: 0 }]));
  const listeners = new Set();
  const progress = (id, state) => {
    const distance = Math.max(0, now() - state.since) / (MECHANISMS[id].duration * 1000);
    return Math.max(0, Math.min(1, state.start + (state.active ? distance : -distance)));
  };
  const wire = (id, state) => ({ id, active: state.active, ageMs: Math.max(0, Math.round(now() - state.since)), progress: progress(id, state) });

  /** Единая точка переключения: пересчитывает стартовый прогресс, чтобы смена направления шла без скачка. */
  function switchTo(id, active) {
    const state = states.get(id);
    if (state.active === active) return { ok: true, changed: false, state: wire(id, state) };
    state.start = progress(id, state);
    state.active = active;
    state.since = now();
    const message = wire(id, state);
    for (const listener of listeners) listener(message);
    return { ok: true, changed: true, state: message };
  }

  return {
    snapshot: () => MECHANISM_IDS.map((id) => wire(id, states.get(id))),
    get: (id) => (isMechanismId(id) ? wire(id, states.get(id)) : null),
    /** Игрок на (x, z) пытается выставить состояние. Возвращает { ok, changed, state?, reason? }. */
    set(id, active, position) {
      if (!isMechanismId(id)) return { ok: false, reason: 'unknown' };
      if (typeof active !== 'boolean') return { ok: false, reason: 'bad_value' };
      const spec = MECHANISMS[id];
      const dist = Math.hypot((position?.x ?? Infinity) - spec.x, (position?.z ?? Infinity) - spec.z);
      if (!(dist <= spec.radius + MECHANISM_REACH_MARGIN)) return { ok: false, reason: 'too_far' };
      return switchTo(id, active);
    },
    /** Закрывает двери, которые оставили открытыми дольше autoCloseS. Вызывается из игрового тика. */
    sweep() {
      let closed = 0;
      for (const id of MECHANISM_IDS) {
        const spec = MECHANISMS[id];
        const state = states.get(id);
        if (spec.autoCloseS && state.active && now() - state.since >= spec.autoCloseS * 1000) {
          switchTo(id, false);
          closed += 1;
        }
      }
      return closed;
    },
    /** Подписка на изменения; возвращает функцию отписки. */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

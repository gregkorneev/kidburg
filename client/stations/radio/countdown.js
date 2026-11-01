/** Клиентский отсчёт, запускаемый только после подтверждённого перехода в on_air. */
export function createCountdown({ onTick = () => {}, timers = globalThis, intervalMs = 700 } = {}) {
  let timer = null;
  let value = null;
  function cancel() {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
    value = null;
  }
  return {
    get value() { return value; },
    start() {
      cancel();
      value = 3;
      onTick(value);
      const step = () => {
        if (value === null) return;
        value -= 1;
        if (value === 0) {
          value = null;
          timer = null;
          onTick(null);
          return;
        }
        onTick(value);
        timer = timers.setTimeout(step, intervalMs);
      };
      timer = timers.setTimeout(step, intervalMs);
    },
    cancel() {
      cancel();
      onTick(null);
    },
  };
}

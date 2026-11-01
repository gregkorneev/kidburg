// Проверка размещения на сервере для «призрака» на карте: debounce, минимальный интервал (лимит сервера —
// 40 изменяющих запросов за 10 секунд), кэш результатов, отбрасывание устаревших ответов. Без DOM.

const defaultSchedule = (fn, ms) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

/**
 * @param {{post: (body:any)=>Promise<{ok:boolean,code?:string,message?:string}>, onChange: (r:{key:string,status:'checking'|'ok'|'bad'|'unknown',code?:string,message?:string}|null)=>void,
 *   debounceMs?: number, minGapMs?: number, now?: ()=>number, schedule?: (fn:()=>void, ms:number)=>()=>void}} opts
 */
export function createValidator({ post, onChange, debounceMs = 150, minGapMs = 350, now = Date.now, schedule = defaultSchedule }) {
  const cache = new Map();
  let cancelTimer = null;
  let latest = null;
  let lastSentAt = -Infinity;
  let blockedUntil = 0;

  const toResult = (key, res) => (res.ok ? { key, status: 'ok' } : { key, status: 'bad', code: res.code, message: res.message });

  async function run(key, body) {
    lastSentAt = now();
    try {
      const res = await post(body);
      const r = toResult(key, res);
      cache.set(key, r);
      if (cache.size > 80) cache.delete(cache.keys().next().value);
      return r;
    } catch (err) {
      if (err?.code === 'rate_limit' || err?.status === 429) blockedUntil = now() + 2500;
      return { key, status: 'unknown', message: err?.code === 'rate_limit' ? 'Проверка временно приостановлена: слишком много запросов' : 'Не удалось проверить размещение' };
    }
  }

  return {
    /** Запланировать проверку (для движения мыши и ввода). */
    check(body) {
      const key = JSON.stringify(body);
      latest = key;
      cancelTimer?.();
      cancelTimer = null;
      const hit = cache.get(key);
      if (hit) {
        onChange(hit);
        return;
      }
      onChange({ key, status: 'checking' });
      const wait = Math.max(debounceMs, lastSentAt + minGapMs - now(), blockedUntil - now());
      cancelTimer = schedule(async () => {
        cancelTimer = null;
        const r = await run(key, body);
        if (latest === key) onChange(r);
      }, wait);
    },
    /** Проверить сразу (перед сохранением). Не зависит от debounce. */
    async now(body) {
      const key = JSON.stringify(body);
      latest = key;
      cancelTimer?.();
      cancelTimer = null;
      const r = cache.get(key) ?? (await run(key, body));
      if (latest === key) onChange(r);
      return r;
    },
    /** Сбросить кэш (мир изменился: результаты могли устареть). */
    invalidate() {
      cache.clear();
    },
    /** Отменить ожидающую проверку и очистить состояние. */
    cancel() {
      cancelTimer?.();
      cancelTimer = null;
      latest = null;
      onChange(null);
    },
  };
}

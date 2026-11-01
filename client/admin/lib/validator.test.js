import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createValidator } from './validator.js';

function harness({ results = [], gap = 350 } = {}) {
  let t = 0;
  const timers = [];
  const posted = [];
  const events = [];
  const v = createValidator({
    post: async (body) => {
      posted.push(body);
      const r = results.shift() ?? { ok: true };
      if (r instanceof Error) throw r;
      return r;
    },
    onChange: (r) => events.push(r),
    minGapMs: gap,
    now: () => t,
    schedule: (fn, ms) => {
      const item = { fn, ms, at: t + ms, live: true };
      timers.push(item);
      return () => { item.live = false; };
    },
  });
  const flush = async () => {
    for (const item of timers.splice(0)) if (item.live) { t = item.at; await item.fn(); }
  };
  return { v, posted, events, flush, timers, setT: (x) => { t = x; } };
}

test('debounce: частые вызовы отправляют только последний запрос', async () => {
  const h = harness();
  h.v.check({ x: 1 });
  h.v.check({ x: 2 });
  h.v.check({ x: 3 });
  await h.flush();
  assert.deepEqual(h.posted, [{ x: 3 }]);
  assert.equal(h.events.at(-1).status, 'ok');
  assert.equal(h.events[0].status, 'checking');
});

test('отказ сервера превращается в bad с сообщением; результат кэшируется', async () => {
  const h = harness({ results: [{ ok: false, code: 'forbidden_zone', message: 'Запретная зона: Площадь' }] });
  h.v.check({ x: 1 });
  await h.flush();
  assert.deepEqual(h.events.at(-1), { key: '{"x":1}', status: 'bad', code: 'forbidden_zone', message: 'Запретная зона: Площадь' });
  h.v.check({ x: 1 });
  assert.equal(h.posted.length, 1, 'повтор взят из кэша');
  assert.equal(h.events.at(-1).status, 'bad');
  h.v.invalidate();
  h.v.check({ x: 1 });
  await h.flush();
  assert.equal(h.posted.length, 2);
});

test('минимальный интервал между запросами (лимит сервера)', async () => {
  const h = harness({ gap: 350 });
  h.v.check({ x: 1 });
  assert.equal(h.timers[0].ms, 150, 'первый запрос — только debounce');
  await h.flush(); // отправка в момент t=150
  h.v.check({ x: 2 });
  assert.equal(h.timers[0].ms, 350, 'следующий не раньше minGap после предыдущей отправки');
  await h.flush();
  assert.equal(h.posted.length, 2);
});

test('устаревший ответ не затирает более новую проверку', async () => {
  const h = harness();
  h.v.check({ x: 1 });
  const first = h.flush();
  h.v.check({ x: 2 });
  await first;
  await h.flush();
  const last = h.events.at(-1);
  assert.equal(last.key, '{"x":2}');
});

test('429 и сетевые ошибки дают unknown, а не красный отказ', async () => {
  const rate = Object.assign(new Error('x'), { code: 'rate_limit', status: 429 });
  const h = harness({ results: [rate, new Error('net')] });
  h.v.check({ x: 1 });
  await h.flush();
  assert.equal(h.events.at(-1).status, 'unknown');
  assert.match(h.events.at(-1).message, /слишком много/);
  h.v.check({ x: 2 });
  await h.flush();
  assert.equal(h.events.at(-1).status, 'unknown');
});

test('now() проверяет сразу и cancel() сбрасывает состояние', async () => {
  const h = harness({ results: [{ ok: false, code: 'overlap', message: 'Пересечение' }] });
  const r = await h.v.now({ x: 9 });
  assert.equal(r.status, 'bad');
  assert.equal(h.posted.length, 1);
  h.v.cancel();
  assert.equal(h.events.at(-1), null);
});

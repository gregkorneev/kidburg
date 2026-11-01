import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStream } from './sse.js';

class FakeES {
  static instances = [];
  constructor(url, opts) {
    this.url = url;
    this.opts = opts;
    this.readyState = 0;
    this.listeners = {};
    this.closed = false;
    FakeES.instances.push(this);
  }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  close() { this.closed = true; this.readyState = 2; }
  emit(name, data) { this.listeners[name]?.({ data: typeof data === 'string' ? data : JSON.stringify(data) }); }
}

test('события разбираются, битый JSON пропускается, close закрывает поток', () => {
  FakeES.instances = [];
  const got = [];
  const states = [];
  const s = openStream({ url: '/api/admin/stream', handlers: { tick: (d) => got.push(d) }, onState: (x) => states.push(x), EventSourceImpl: FakeES });
  const es = FakeES.instances[0];
  assert.equal(es.opts.withCredentials, true);
  es.onopen();
  es.emit('tick', { a: 1 });
  es.emit('tick', '{broken');
  assert.deepEqual(got, [{ a: 1 }]);
  assert.deepEqual(states, ['connecting', 'online']);
  s.close();
  assert.equal(es.closed, true);
});

test('временная ошибка — «Переподключение», окончательное закрытие — новый EventSource с паузой', () => {
  FakeES.instances = [];
  const states = [];
  let closedCalls = 0;
  const timers = [];
  const s = openStream({
    url: '/x', handlers: {}, onState: (x) => states.push(x), onClosed: () => closedCalls++, EventSourceImpl: FakeES,
    setTimeoutImpl: (fn, ms) => (timers.push({ fn, ms }), timers.length), clearTimeoutImpl: () => {},
  });
  const first = FakeES.instances[0];
  first.onopen();
  first.readyState = 0;
  first.onerror();
  assert.equal(states.at(-1), 'reconnecting');
  assert.equal(timers.length, 0, 'браузер переподключается сам');
  first.readyState = 2;
  first.onerror();
  assert.equal(closedCalls, 1);
  assert.equal(timers[0].ms, 3000);
  timers[0].fn();
  assert.equal(FakeES.instances.length, 2);
  assert.equal(states.at(-1), 'reconnecting');
  s.close();
  // после close запланированный повтор не создаёт соединение
  timers[0].fn();
  assert.equal(FakeES.instances.length, 2);
});

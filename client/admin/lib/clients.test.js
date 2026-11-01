import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterClients, sortClients, tabSuffixes, reuseClients, seedHistories, mergeTick, appendSeries, metricHealth, chunksText, HISTORY_MAX } from './clients.js';

const c = (sid, over = {}) => ({ sid, userId: sid, name: sid, status: 'online', loc: 'city', fps: 60, ping: 5, lastSeen: 1000, ...over });

test('фильтры по локации и состоянию', () => {
  const list = [c('a'), c('b', { loc: 'bakery' }), c('c', { status: 'offline' })];
  assert.deepEqual(filterClients(list, { loc: 'bakery' }).map((x) => x.sid), ['b']);
  assert.deepEqual(filterClients(list, { status: 'offline' }).map((x) => x.sid), ['c']);
  assert.equal(filterClients(list, {}).length, 3);
});

test('сортировка: null всегда в конце в обоих направлениях', () => {
  const list = [c('a', { fps: 30 }), c('b', { fps: null }), c('c', { fps: 60 })];
  assert.deepEqual(sortClients(list, { key: 'fps', dir: 'asc' }).map((x) => x.sid), ['a', 'c', 'b']);
  assert.deepEqual(sortClients(list, { key: 'fps', dir: 'desc' }).map((x) => x.sid), ['c', 'a', 'b']);
  assert.deepEqual(sortClients([c('x', { name: 'Яна' }), c('y', { name: 'Аня' })], { key: 'name' }).map((x) => x.sid), ['y', 'x']);
  assert.deepEqual(sortClients([c('x', { lastSeen: 5 }), c('y', { lastSeen: 9 })], { key: 'lastSeen', dir: 'desc' }).map((x) => x.sid), ['y', 'x']);
});

test('суффикс sid только у игроков с несколькими вкладками', () => {
  const list = [c('abcd1234', { userId: 1, name: 'Аня' }), c('efgh5678', { userId: 1, name: 'Аня' }), c('solo0000', { userId: 2 })];
  const s = tabSuffixes(list);
  assert.equal(s.get('abcd1234'), '1234');
  assert.equal(s.get('efgh5678'), '5678');
  assert.equal(s.has('solo0000'), false);
});

test('reuseClients сохраняет ссылки на неизменившиеся строки и отбрасывает history', () => {
  const prev = [c('a'), c('b')];
  const next = [{ ...c('a'), history: [1] }, c('b', { fps: 20 })];
  const out = reuseClients(prev, next);
  assert.equal(out[0], prev[0]);
  assert.notEqual(out[1], prev[1]);
  assert.equal('history' in out[0], false);
});

test('история: точка только при смене lastSeen, лимит и удаление исчезнувших', () => {
  let h = seedHistories([c('a', { history: [{ t: 1, fps: 60, ping: 4 }] }), c('gone')]);
  assert.equal(h.a.length, 1);
  h = mergeTick(h, [c('a', { lastSeen: 1 })]);
  assert.equal(h.a.length, 1, 'lastSeen не менялся');
  assert.equal('gone' in h, false, 'история исчезнувшего sid удалена');
  h = mergeTick(h, [c('a', { lastSeen: 2, fps: null, ping: 7 })]);
  assert.deepEqual(h.a[1], { t: 2, fps: null, ping: 7 });
  const before = h.a;
  h = mergeTick(h, [c('a', { lastSeen: 2 })]);
  assert.equal(h.a, before, 'массив не пересоздаётся без изменений');
  let long = { a: Array.from({ length: HISTORY_MAX }, (_, i) => ({ t: i, fps: 1, ping: 1 })) };
  long = mergeTick(long, [c('a', { lastSeen: 999 })]);
  assert.equal(long.a.length, HISTORY_MAX);
  assert.equal(long.a.at(-1).t, 999);
  assert.equal(long.a[0].t, 1);
});

test('appendSeries ограничивает длину', () => {
  let s = [];
  for (let i = 0; i < 200; i++) s = appendSeries(s, { t: i, fps: i, ping: null });
  assert.equal(s.length, HISTORY_MAX);
  assert.equal(s[0].t, 20);
});

test('metricHealth и chunksText', () => {
  const th = { lowFps: 30, highPingMs: 150 };
  assert.equal(metricHealth('fps', 20, th), 'bad');
  assert.equal(metricHealth('fps', 45, th), 'ok');
  assert.equal(metricHealth('fps', null, th), null);
  assert.equal(metricHealth('ping', 200, th), 'bad');
  assert.equal(chunksText({ chunks: { loaded: 9, max: 14 } }), '9 / 14');
  assert.equal(chunksText({ chunks: null }), null);
  assert.equal(chunksText({ chunks: { loaded: null, max: 3 } }), null);
});

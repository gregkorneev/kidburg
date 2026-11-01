import { test } from 'node:test';
import assert from 'node:assert/strict';
import { niceMax, linePath, yOf, ageLabel } from './series.js';

test('niceMax', () => {
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(58), 100);
  assert.equal(niceMax(63), 100);
  assert.equal(niceMax(14), 20);
  assert.equal(niceMax(3.2), 5);
});

test('linePath: разрывы на null и границы', () => {
  const pts = [{ t: 0, fps: 0 }, { t: 10, fps: null }, { t: 20, fps: 50 }, { t: 30, fps: 100 }];
  const r = linePath(pts, 'fps', { width: 30, height: 100, max: 100 });
  assert.equal(r.d, 'M0 100M20 50L30 0');
  assert.equal(r.count, 3);
  assert.deepEqual(r.last, { x: 30, y: 0 });
  const empty = linePath([{ t: 1, fps: null }], 'fps', { width: 10, height: 10 });
  assert.equal(empty.d, '');
  assert.equal(empty.last, null);
});

test('yOf и ageLabel', () => {
  assert.equal(yOf(30, { height: 100, max: 60 }), 50);
  assert.equal(yOf(999, { height: 100, max: 60 }), 0);
  assert.equal(ageLabel(0), 'сейчас');
  assert.equal(ageLabel(45_000), '−45 с');
  assert.equal(ageLabel(180_000), '−3 мин');
});

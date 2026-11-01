import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtNum, relativeTime, formatUptime, plural, radToDeg, degToRad, fmtBytes, locLabel, fmtInt } from './format.js';

test('fmtNum: null и NaN дают прочерк, а не ноль', () => {
  assert.equal(fmtNum(null), '—');
  assert.equal(fmtNum(undefined), '—');
  assert.equal(fmtNum(NaN), '—');
  assert.equal(fmtNum(0), '0');
  assert.equal(fmtNum(58.24, 1), '58,2');
});

test('relativeTime', () => {
  const now = 1_000_000_000;
  assert.equal(relativeTime(null, now), '—');
  assert.equal(relativeTime(now - 500, now), 'только что');
  assert.equal(relativeTime(now - 3000, now), '3 с назад');
  assert.equal(relativeTime(now - 125_000, now), '2 мин назад');
  assert.equal(relativeTime(now - 3 * 3600_000, now), '3 ч назад');
  assert.equal(relativeTime(now - 50 * 3600_000, now), '2 д назад');
  assert.equal(relativeTime(now + 5000, now), 'только что');
});

test('formatUptime', () => {
  assert.equal(formatUptime(null), '—');
  assert.equal(formatUptime(12), '12 с');
  assert.equal(formatUptime(192), '3 мин 12 с');
  assert.equal(formatUptime(2 * 3600 + 5 * 60), '2 ч 05 мин');
  assert.equal(formatUptime(28 * 3600), '1 д 4 ч');
});

test('plural, углы, размеры, локации', () => {
  assert.equal(plural(1, ['объект', 'объекта', 'объектов']), 'объект');
  assert.equal(plural(3, ['объект', 'объекта', 'объектов']), 'объекта');
  assert.equal(plural(11, ['объект', 'объекта', 'объектов']), 'объектов');
  assert.equal(plural(21, ['объект', 'объекта', 'объектов']), 'объект');
  assert.equal(radToDeg(Math.PI / 2), 90);
  assert.equal(radToDeg(-Math.PI / 2), 270);
  assert.ok(Math.abs(degToRad(450) - Math.PI / 2) < 1e-9);
  assert.equal(fmtBytes(2048), '2,0 КБ');
  assert.equal(locLabel('florist'), 'Цветочная лавка');
  assert.equal(locLabel('mars'), 'Другое');
  assert.equal(fmtInt(1234567), '1 234 567');
});

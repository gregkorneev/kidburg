import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BAKERY_ENTRANCE,
  FIRE_STATION_ENTRANCE,
  FLORIST_ENTRANCE,
  RADIO_STATION_ENTRANCE,
  isNearFireStationEntrance,
  isNearFloristEntrance,
  isNearBakeryEntrance,
  isNearRadioStationEntrance,
} from './city-entrance.js';

test('fire station entrance is reachable from the west path', () => {
  assert.equal(isNearFireStationEntrance(395, 412), true);
});

test('bakery entrance is reachable from the plaza and rejects distant or invalid coordinates', () => {
  assert.equal(isNearBakeryEntrance(436, 412), true);
  assert.equal(isNearBakeryEntrance(416, 416), false);
  assert.equal(isNearBakeryEntrance(BAKERY_ENTRANCE.x - BAKERY_ENTRANCE.radius, BAKERY_ENTRANCE.z), true);
  assert.equal(isNearBakeryEntrance(Number.NaN, 412), false);
  assert.equal(BAKERY_ENTRANCE.href, './bakery-preview.html');
});

test('entrance prompt does not appear while the player is far away', () => {
  assert.equal(isNearFireStationEntrance(416, 416), false);
});

test('entrance is usable at its threshold and rejects invalid coordinates', () => {
  assert.equal(isNearFireStationEntrance(FIRE_STATION_ENTRANCE.x + FIRE_STATION_ENTRANCE.radius, FIRE_STATION_ENTRANCE.z), true);
  assert.equal(isNearFireStationEntrance(Number.NaN, 0), false);
  assert.equal(FIRE_STATION_ENTRANCE.href, '/firefighter-preview.html');
});

test('florist entrance is reachable from the south-west path', () => {
  assert.equal(isNearFloristEntrance(394, 442), true);
  assert.equal(isNearFloristEntrance(410, 416), false);
  assert.equal(isNearFloristEntrance(FLORIST_ENTRANCE.x + FLORIST_ENTRANCE.radius, FLORIST_ENTRANCE.z), true);
  assert.equal(FLORIST_ENTRANCE.href, '/florist-preview.html');
});

test('radio station entrance is reachable from the south-east path', () => {
  assert.equal(isNearRadioStationEntrance(438, 442), true);
  assert.equal(isNearRadioStationEntrance(416, 416), false);
  assert.equal(isNearRadioStationEntrance(Number.NaN, 445), false);
  assert.equal(RADIO_STATION_ENTRANCE.href, '/radio-preview.html');
});

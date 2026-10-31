import test from 'node:test';
import assert from 'node:assert/strict';
import { FIRE_STATION_ENTRANCE, isNearFireStationEntrance } from './city-entrance.js';

test('fire station entrance is reachable from the west path', () => {
  assert.equal(isNearFireStationEntrance(395, 412), true);
});

test('entrance prompt does not appear while the player is far away', () => {
  assert.equal(isNearFireStationEntrance(416, 416), false);
});

test('entrance is usable at its threshold and rejects invalid coordinates', () => {
  assert.equal(isNearFireStationEntrance(FIRE_STATION_ENTRANCE.x + FIRE_STATION_ENTRANCE.radius, FIRE_STATION_ENTRANCE.z), true);
  assert.equal(isNearFireStationEntrance(Number.NaN, 0), false);
  assert.equal(FIRE_STATION_ENTRANCE.href, '/firefighter-preview.html');
});

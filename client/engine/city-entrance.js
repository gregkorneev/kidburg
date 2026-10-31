// Точка входа у боковой двери пожарной части в центральном городе.
// Координаты двери получены из локальной модели: (7.72, 6.94), повернутой на π/2
// вокруг центра здания (382, 412). Радиус включает конец западной пешеходной дорожки.
export const FIRE_STATION_ENTRANCE = Object.freeze({
  x: 388.94,
  z: 404.28,
  radius: 10,
  href: '/firefighter-preview.html',
  label: 'Войти в пожарную часть',
});

export function isNearFireStationEntrance(x, z) {
  return Number.isFinite(x) && Number.isFinite(z) &&
    Math.hypot(x - FIRE_STATION_ENTRANCE.x, z - FIRE_STATION_ENTRANCE.z) <= FIRE_STATION_ENTRANCE.radius;
}

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

// Центральная дверь цветочной лавки (центр здания 384,449; поворот 2.37 рад).
export const FLORIST_ENTRANCE = Object.freeze({
  x: 387.4,
  z: 445.5,
  radius: 10,
  href: '/florist-preview.html',
  label: 'Войти в цветочную лавку',
});

export function isNearFireStationEntrance(x, z) {
  return Number.isFinite(x) && Number.isFinite(z) &&
    Math.hypot(x - FIRE_STATION_ENTRANCE.x, z - FIRE_STATION_ENTRANCE.z) <= FIRE_STATION_ENTRANCE.radius;
}

export function isNearFloristEntrance(x, z) {
  return Number.isFinite(x) && Number.isFinite(z) &&
    Math.hypot(x - FLORIST_ENTRANCE.x, z - FLORIST_ENTRANCE.z) <= FLORIST_ENTRANCE.radius;
}

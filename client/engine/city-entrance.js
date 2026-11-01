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

// Фасад пекарни обращён к площади: центр (450, 412), поворот -π/2.
export const BAKERY_ENTRANCE = Object.freeze({
  x: 443.5,
  z: 412,
  radius: 10,
  href: './bakery-preview.html',
  label: 'Войти в пекарню',
});

// Сохраняем координаты входов для интерактивных дверей; сейчас они не ведут на отдельные страницы.
export const RADIO_STATION_ENTRANCE = Object.freeze({ x: 444.06, z: 444.95, radius: 10, href: '/radio-preview.html', label: 'Войти в радиостанцию' });
export const MUSIC_SCHOOL_ENTRANCE = Object.freeze({ x: 416, z: 450.9, radius: 10, href: '/musician-preview.html', label: 'Войти в музыкальную школу' });

/** Входы с доступными игровыми страницами. */
export const CITY_ENTRANCES = Object.freeze({ florist: FLORIST_ENTRANCE, fire: FIRE_STATION_ENTRANCE, bakery: BAKERY_ENTRANCE });

export function isNearFireStationEntrance(x, z) {
  return Number.isFinite(x) && Number.isFinite(z) &&
    Math.hypot(x - FIRE_STATION_ENTRANCE.x, z - FIRE_STATION_ENTRANCE.z) <= FIRE_STATION_ENTRANCE.radius;
}

export function isNearFloristEntrance(x, z) {
  return Number.isFinite(x) && Number.isFinite(z) &&
    Math.hypot(x - FLORIST_ENTRANCE.x, z - FLORIST_ENTRANCE.z) <= FLORIST_ENTRANCE.radius;
}

export function isNearBakeryEntrance(x, z) {
  return Number.isFinite(x) && Number.isFinite(z) &&
    Math.hypot(x - BAKERY_ENTRANCE.x, z - BAKERY_ENTRANCE.z) <= BAKERY_ENTRANCE.radius;
}

export function isNearRadioStationEntrance(x, z) {
  return Number.isFinite(x) && Number.isFinite(z) &&
    Math.hypot(x - RADIO_STATION_ENTRANCE.x, z - RADIO_STATION_ENTRANCE.z) <= RADIO_STATION_ENTRANCE.radius;
}

export function isNearMusicSchoolEntrance(x, z) {
  return Number.isFinite(x) && Number.isFinite(z) &&
    Math.hypot(x - MUSIC_SCHOOL_ENTRANCE.x, z - MUSIC_SCHOOL_ENTRANCE.z) <= MUSIC_SCHOOL_ENTRANCE.radius;
}

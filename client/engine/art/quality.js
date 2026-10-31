// Графические настройки: Низкие / Средние / Высокие. Выбор хранится только в браузере игрока
// (sessionStorage недоступен для общих настроек, поэтому localStorage с защитой от ошибок).

export const QUALITY_LEVELS = Object.freeze(['low', 'medium', 'high']);

export const QUALITY_LABELS = Object.freeze({ low: 'Низкая', medium: 'Средняя', high: 'Высокая' });

/** Параметры уровней: ограничение плотности пикселей, теневая карта и доля мелких деталей. */
export const QUALITY_PRESETS = Object.freeze({
  low: Object.freeze({ pixelRatio: 1, shadowSize: 0, detail: 0.35, antialias: false }),
  medium: Object.freeze({ pixelRatio: 1.5, shadowSize: 1024, detail: 0.7, antialias: true }),
  high: Object.freeze({ pixelRatio: 2, shadowSize: 2048, detail: 1, antialias: true }),
});

const STORAGE_KEY = 'kidburg.quality';

export const isQuality = (value) => QUALITY_LEVELS.includes(value);

/** Уровень из адреса (?quality=low) или localStorage; по умолчанию — средний. */
export function readQuality(search = globalThis.location?.search ?? '', storage = globalThis.localStorage) {
  const fromUrl = new URLSearchParams(search).get('quality');
  if (isQuality(fromUrl)) return fromUrl;
  try {
    const stored = storage?.getItem(STORAGE_KEY);
    if (isQuality(stored)) return stored;
  } catch { /* хранилище может быть закрыто политикой браузера */ }
  return 'medium';
}

export function saveQuality(level, storage = globalThis.localStorage) {
  if (!isQuality(level)) return;
  try { storage?.setItem(STORAGE_KEY, level); } catch { /* не критично */ }
}

// Настройки агентов: черновик против серверного состояния. Без DOM.

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export const cloneSettings = clone;

/** Приведение к виду, который хранит сервер (пустые темы -> null, лишние пробелы убраны). */
export function normalizeDraft(settings, schema) {
  const out = {};
  for (const f of schema) {
    let v = settings[f.key];
    if (f.kind === 'list') {
      const items = Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : [];
      v = items.length ? items : null;
    } else if (f.kind === 'text' || f.kind === 'longtext') v = typeof v === 'string' ? v.trim() : '';
    else if (f.kind === 'number') v = typeof v === 'number' && Number.isFinite(v) ? v : null;
    out[f.key] = v === undefined ? f.default : v;
  }
  return out;
}

export function isDirty(draft, saved, schema) {
  return JSON.stringify(normalizeDraft(draft, schema)) !== JSON.stringify(normalizeDraft(saved, schema));
}

/** Ключи полей, отличающихся от значений по умолчанию. */
export function customizedKeys(settings, schema) {
  const n = normalizeDraft(settings, schema);
  return schema.filter((f) => JSON.stringify(n[f.key]) !== JSON.stringify(f.default)).map((f) => f.key);
}

/** Подпись значения для краткой сводки в карточке. */
export function summarizeSettings(settings, schema) {
  const get = (key) => schema.find((f) => f.key === key);
  const label = (key) => {
    const f = get(key);
    const v = settings[key];
    return f?.labels?.[v] ?? String(v);
  };
  const out = [];
  out.push({ key: 'enabled', label: 'Доступность', value: settings.enabled ? 'Доступен' : 'Выключен', tone: settings.enabled ? 'ok' : 'warn' });
  out.push({ key: 'verbosity', label: 'Подробность', value: label('verbosity') });
  out.push({ key: 'topicMode', label: 'Темы', value: label('topicMode') });
  out.push({ key: 'friendliness', label: 'Дружелюбие', value: `${settings.friendliness} из ${get('friendliness')?.max ?? 5}` });
  return out;
}

/** Реплика для проверки: допустимая длина (как на сервере: 1..300). */
export const TEST_TEXT_MAX = 300;

/** Сообщение для кодов ошибки проверки агента. */
export function testErrorMessage(error) {
  const code = error?.code;
  if (code === 'unavailable' || code === 'model_missing' || code === 'not_configured') {
    return {
      unavailable: 'Ollama недоступна: проверьте, что она запущена на сервере (команда «ollama serve») и адрес в настройках верный.',
      model_missing: 'Модель не загружена в Ollama: скачайте её командой «ollama pull <модель>» на компьютере сервера.',
      not_configured: 'Ollama не настроена на сервере: задайте адрес и модель в переменных окружения и перезапустите сервер.',
    }[code] + ' Настройки при этом можно сохранять и редактировать.';
  }
  return error?.message || 'Не удалось получить ответ модели';
}

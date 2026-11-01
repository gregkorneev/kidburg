// Журнал: подписи, слияние записей, аккуратный диф «до/после». Без DOM.

import { radToDeg, isNum } from './format.js';

export const ACTION_LABELS = Object.freeze({
  'admin.login': 'Вход',
  'admin.logout': 'Выход',
  'world.create': 'Создан объект',
  'world.update': 'Перемещён или изменён объект',
  'world.delete': 'Удалён объект',
  'world.clear': 'Удалены все динамические объекты',
  'world.undo': 'Отмена изменения',
  'agent.update': 'Изменены настройки агента',
  'agent.reset': 'Сброшены настройки агента',
  'agent.test': 'Проверка агента',
});
export const ENTITY_LABELS = Object.freeze({ world_object: 'Объект мира', world: 'Мир', agent: 'Агент', session: 'Сессия' });
export const RESULT_LABELS = Object.freeze({ ok: 'Успешно', rejected: 'Отклонено', error: 'Ошибка' });

export const actionLabel = (action) => ACTION_LABELS[action] ?? action ?? '—';
export const resultLabel = (result) => RESULT_LABELS[result] ?? result ?? '—';

export function entityText(entry) {
  const kind = ENTITY_LABELS[entry.entityType] ?? entry.entityType ?? '—';
  return entry.entityId ? `${kind}: ${entry.entityId}` : kind;
}

/** Подпись поля для дифа. */
export const FIELD_LABELS = Object.freeze({
  type: 'Тип', x: 'x, м', z: 'z, м', ry: 'Поворот', scale: 'Масштаб', rev: 'Версия', id: 'Идентификатор',
  enabled: 'Агент доступен', displayName: 'Имя в разговоре', personalityNotes: 'Дополнение к личности', speechStyle: 'Манера речи',
  topics: 'Темы', topicMode: 'Разрешённые темы', verbosity: 'Подробность', friendliness: 'Дружелюбие', initiative: 'Инициативность',
  temperature: 'Свобода формулировок', introduceSelf: 'Представляться', reactToTaskProgress: 'Реагировать на задание',
});

function formatValue(key, value) {
  if (value === null || value === undefined) return 'нет';
  if (key === 'ry' && isNum(value)) return `${radToDeg(value)}°`;
  if (typeof value === 'boolean') return value ? 'да' : 'нет';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'пусто';
  if (typeof value === 'object') return JSON.stringify(value);
  if (value === '') return 'пусто';
  return String(value);
}

function flatten(value, prefix = '', out = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else out[prefix] = value;
  return out;
}

/**
 * Сравнение состояний до/после по ключам. Для списков (например, очистка мира) возвращает сводку.
 * @returns {{kind: 'fields', rows: Array<{key,label,before,after,change}>} | {kind: 'list', before: number, after: number} | {kind: 'none'}}
 */
export function diffStates(before, after) {
  if (Array.isArray(before) || Array.isArray(after)) {
    return { kind: 'list', before: Array.isArray(before) ? before.length : 0, after: Array.isArray(after) ? after.length : 0 };
  }
  if (before == null && after == null) return { kind: 'none' };
  const a = flatten(before ?? {});
  const b = flatten(after ?? {});
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const rows = [];
  for (const key of keys) {
    const va = a[key];
    const vb = b[key];
    const same = JSON.stringify(va) === JSON.stringify(vb);
    if (same && before != null && after != null) continue; // у пары «до/после» показываем только изменения
    const base = key.split('.').pop();
    rows.push({
      key,
      label: FIELD_LABELS[key] ?? (key.startsWith('params.') ? `Параметр «${base}»` : FIELD_LABELS[base] ?? key),
      before: before == null ? null : formatValue(base, va),
      after: after == null ? null : formatValue(base, vb),
      change: va === undefined ? 'added' : vb === undefined ? 'removed' : same ? 'same' : 'changed',
    });
  }
  // служебные поля (версия, идентификатор) не показываем, если есть содержательные отличия
  const meaningful = rows.filter((r) => r.key !== 'rev' && r.key !== 'id');
  const shown = meaningful.length ? meaningful : rows.filter((r) => r.key !== 'id');
  return shown.length ? { kind: 'fields', rows: shown } : { kind: 'none' };
}

/** Объединяет записи без дублей, новые (с большим id) сверху. */
export function mergeEntries(current, incoming) {
  const byId = new Map(current.map((e) => [e.id, e]));
  for (const e of incoming) byId.set(e.id, { ...byId.get(e.id), ...e });
  return [...byId.values()].sort((a, b) => b.id - a.id);
}

/** Последняя запись мира, которую ещё можно отменить (как на сервере: ok и не отменённая). */
export const WORLD_UNDOABLE = new Set(['world.create', 'world.update', 'world.delete', 'world.clear']);
export const canUndoWorld = (entries) => entries.some((e) => WORLD_UNDOABLE.has(e.action) && e.result === 'ok' && !e.undone);

/** Тон результата для оформления. */
export const resultTone = (result) => (result === 'ok' ? 'ok' : result === 'rejected' ? 'warn' : 'bad');

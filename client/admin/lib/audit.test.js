import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionLabel, diffStates, mergeEntries, canUndoWorld, entityText, resultTone } from './audit.js';

test('подписи действий и сущностей', () => {
  assert.equal(actionLabel('world.create'), 'Создан объект');
  assert.equal(actionLabel('agent.reset'), 'Сброшены настройки агента');
  assert.equal(actionLabel('unknown.x'), 'unknown.x');
  assert.equal(entityText({ entityType: 'world_object', entityId: 'o_1' }), 'Объект мира: o_1');
  assert.equal(entityText({ entityType: 'world', entityId: null }), 'Мир');
  assert.equal(resultTone('rejected'), 'warn');
});

test('diff: показываются только изменённые ключи, поворот в градусах', () => {
  const d = diffStates({ x: 1, z: 2, ry: 0, params: { tone: 0 } }, { x: 5, z: 2, ry: Math.PI / 2, params: { tone: 1 } });
  assert.equal(d.kind, 'fields');
  const keys = d.rows.map((r) => r.key);
  assert.deepEqual(keys, ['x', 'ry', 'params.tone']);
  assert.equal(d.rows[1].after, '90°');
  assert.equal(d.rows[2].label, 'Параметр «tone»');
});

test('diff: только после (создание), только до (удаление), списки, пусто', () => {
  const created = diffStates(null, { type: 'bench', x: 1 });
  assert.equal(created.kind, 'fields');
  assert.ok(created.rows.every((r) => r.before === null && r.change === 'added'));
  const removed = diffStates({ type: 'bench' }, null);
  assert.ok(removed.rows.every((r) => r.after === null));
  assert.deepEqual(diffStates([{ id: 1 }, { id: 2 }], []), { kind: 'list', before: 2, after: 0 });
  assert.equal(diffStates(null, null).kind, 'none');
  assert.equal(diffStates({ a: 1 }, { a: 1 }).kind, 'none');
});

test('diff: служебные поля rev и id скрыты, если есть другие отличия', () => {
  const d = diffStates({ id: 'o_1', x: 1, rev: 1 }, { id: 'o_1', x: 2, rev: 4 });
  assert.deepEqual(d.rows.map((r) => r.key), ['x']);
  const only = diffStates({ id: 'o_1', x: 1, rev: 1 }, { id: 'o_1', x: 1, rev: 4 });
  assert.deepEqual(only.rows.map((r) => r.key), ['rev']);
});

test('diff: булевы значения и массивы читаемо', () => {
  const d = diffStates({ enabled: true, topics: null }, { enabled: false, topics: ['пожары', 'спасение'] });
  assert.equal(d.rows[0].before, 'да');
  assert.equal(d.rows[0].after, 'нет');
  assert.equal(d.rows[1].before, 'нет');
  assert.equal(d.rows[1].after, 'пожары, спасение');
});

test('mergeEntries: без дублей, по убыванию id, обновляет undone', () => {
  const a = [{ id: 2, undone: false }, { id: 1 }];
  const m = mergeEntries(a, [{ id: 3 }, { id: 2, undone: true }]);
  assert.deepEqual(m.map((e) => e.id), [3, 2, 1]);
  assert.equal(m[1].undone, true);
});

test('canUndoWorld как на сервере', () => {
  assert.equal(canUndoWorld([{ action: 'world.create', result: 'ok', undone: true }]), false);
  assert.equal(canUndoWorld([{ action: 'agent.update', result: 'ok' }]), false);
  assert.equal(canUndoWorld([{ action: 'world.create', result: 'rejected' }]), false);
  assert.equal(canUndoWorld([{ action: 'world.delete', result: 'ok', undone: false }]), true);
});

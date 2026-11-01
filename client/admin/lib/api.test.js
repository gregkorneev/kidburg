import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ApiError, errorText } from './api.js';

const reply = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

test('CSRF добавляется только к изменяющим запросам, Content-Type только с телом', async () => {
  const calls = [];
  const api = createApi({ fetchImpl: async (url, init) => (calls.push({ url, init }), reply(200, { ok: 1 })) });
  api.setCsrf('tok');
  await api.get('/overview');
  await api.post('/world/undo');
  await api.patch('/world/objects/o_1', { x: 1 });
  await api.del('/world/objects/o_1', { query: { rev: 3 } });
  assert.equal(calls[0].init.headers['X-CSRF-Token'], undefined);
  assert.equal(calls[1].init.headers['X-CSRF-Token'], 'tok');
  assert.equal(calls[1].init.headers['Content-Type'], undefined);
  assert.equal(calls[2].init.headers['Content-Type'], 'application/json');
  assert.equal(calls[2].init.body, '{"x":1}');
  assert.equal(calls[3].url, '/api/admin/world/objects/o_1?rev=3');
  assert.equal(calls[3].init.credentials, 'same-origin');
});

test('401 вызывает обработчик выхода, но не на экране входа', async () => {
  let unauth = 0;
  const api = createApi({ fetchImpl: async () => reply(401, { error: 'unauth', message: 'Нужен вход' }), onUnauth: () => unauth++ });
  await assert.rejects(api.get('/overview'), (e) => e instanceof ApiError && e.status === 401);
  assert.equal(unauth, 1);
  await assert.rejects(api.post('/login', { password: 'x' }));
  assert.equal(unauth, 1);
});

test('ошибки: поля валидации, сеть, текст', async () => {
  const api = createApi({ fetchImpl: async () => reply(422, { error: 'invalid_settings', message: 'Не прошли', fields: { topics: 'много' } }) });
  await assert.rejects(api.put('/agents/a', {}), (e) => e.code === 'invalid_settings' && e.fields.topics === 'много');
  const down = createApi({ fetchImpl: async () => { throw new TypeError('fail'); } });
  await assert.rejects(down.get('/x'), (e) => e.code === 'network');
  assert.match(errorText(new ApiError(0, 'network', 'x')), /Нет связи/);
});

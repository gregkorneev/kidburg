import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../server/index.js';
import { reply } from '../server/agents/index.js';

test('GET /health возвращает {"ok":true}', async () => {
  const app = await buildApp({ dbPath: ':memory:', logLevel: 'silent' });
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
  await app.close();
});

test('reply() из контракта: без модели и без запущенного модуля — понятная ошибка, а не эхо', async () => {
  const drain = async (req) => {
    for await (const _ of reply(req)); // eslint-disable-line no-unused-vars
  };
  const req = { userId: 1, agentId: 'therapist', text: 'как дела доктор' };
  await assert.rejects(drain(req), /не запущен/);

  const app = await buildApp({ dbPath: ':memory:', logLevel: 'silent', agents: { model: '' } });
  await assert.rejects(drain(req), /OLLAMA_MODEL/);
  await app.close();
  await assert.rejects(drain(req), /не запущен/);
});

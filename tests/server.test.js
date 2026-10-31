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

test('заглушка reply(): эхо по словам', async () => {
  const parts = [];
  for await (const tok of reply({ userId: 1, agentId: 'therapist', text: 'как дела  доктор' })) parts.push(tok);
  assert.equal(parts.join(''), 'как дела доктор');
  assert.equal(parts.length, 3);
});

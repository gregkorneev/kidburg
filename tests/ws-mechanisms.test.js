import test from 'node:test';
import assert from 'node:assert/strict';
import { listen, joinGame, seedPlayerState, tempDb } from './helpers.js';
import { MECHANISMS } from '../shared/mechanisms.js';

test('механизм синхронизируется между двумя WebSocket-клиентами и восстанавливается при подключении', async () => {
  const db = tempDb();
  const id = 'fire-city-gate-0';
  let server = await listen({ dbPath: db.dbPath });
  const clients = [];
  try {
    for (const name of ['Механик', 'Наблюдатель', 'Поздний']) {
      const p = await joinGame(server.app, server.port, name);
      await p.client.close();
    }
    await server.app.close();
    for (const name of ['Механик', 'Наблюдатель', 'Поздний']) seedPlayerState(db.dbPath, name, { ...MECHANISMS[id], y: 0 });
    server = await listen({ dbPath: db.dbPath });
    const a = (await joinGame(server.app, server.port, 'Механик')).client;
    const b = (await joinGame(server.app, server.port, 'Наблюдатель')).client;
    clients.push(a, b);
    await Promise.all([a.nextOfType('mech_snapshot'), b.nextOfType('mech_snapshot')]);
    a.send({ t: 'mech_set', id, active: true });
    const states = await Promise.all([a.nextOfType('mech_state'), b.nextOfType('mech_state')]);
    assert.ok(states.every((s) => s.id === id && s.active && s.progress === 0));
    const late = (await joinGame(server.app, server.port, 'Поздний')).client;
    clients.push(late);
    const row = (await late.nextOfType('mech_snapshot')).list.find((s) => s.id === id);
    assert.equal(row.active, true);
    assert.ok(row.progress >= 0 && row.progress <= 1);
    a.send({ t: 'mech_set', id, active: false });
    const reversed = await b.nextOfType('mech_state');
    assert.equal(reversed.active, false);
    assert.ok(reversed.progress >= row.progress);
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await server.app.close();
    db.cleanup();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRadioNetworkClient } from './network.js';

test('network client восстанавливает сессию и сообщает auth без запуска city runtime', async () => {
  const events = new Map();
  const calls = [];
  const session = {
    current: null,
    token() { return this.current?.token ?? null; },
    user() { return this.current?.user ?? null; },
    save(token, user) { this.current = { token, user }; },
    clear() { this.current = null; },
  };
  const client = createRadioNetworkClient({
    session,
    previewBootstrap: false,
    http: {
      async me(token) { calls.push(['me', token]); return { user: { id: 7, name: 'Ведущий' } }; },
      async join(name, room) { calls.push(['join', name, room]); return { token: 'token', user: { id: 8, name } }; },
      async localRoom() { return { room: 'abcd' }; },
    },
    netFactory({ emitter }) {
      return {
        status: 'closed',
        connect() { calls.push(['connect']); },
        disconnect() { calls.push(['disconnect']); },
        send() { return true; },
      };
    },
  });
  client.api.on('auth', (value) => events.set('auth', value));

  client.start();
  await Promise.resolve();
  assert.equal(events.get('auth'), null);
  assert.deepEqual(await client.api.auth.localRoom(), 'ABCD');
  const user = await client.api.auth.join('Ведущий', 'ABCD');
  assert.equal(user.name, 'Ведущий');
  assert.deepEqual(session.current, { token: 'token', user });
  assert.deepEqual(calls.at(-1), ['connect']);
  client.stop();
  assert.ok(calls.some(([name]) => name === 'disconnect'));
});

test('standalone preview creates a session through the existing local-room and join endpoints', async () => {
  const calls = [];
  const authEvents = [];
  const session = {
    current: null,
    token() { return this.current?.token ?? null; },
    user() { return this.current?.user ?? null; },
    save(token, user) { this.current = { token, user }; },
    clear() { this.current = null; },
  };
  const client = createRadioNetworkClient({
    session,
    http: {
      async localRoom() { calls.push(['localRoom']); return { room: 'aBcD' }; },
      async join(name, room) {
        calls.push(['join', name, room]);
        return { token: 'preview-token', user: { id: 23, name } };
      },
    },
    netFactory() {
      return {
        status: 'closed',
        connect() { calls.push(['connect']); },
        disconnect() {},
        send() { return true; },
      };
    },
  });
  client.api.on('auth', (info) => authEvents.push(info));
  client.start();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(calls, [['localRoom'], ['join', 'Radio Preview', 'ABCD'], ['connect']]);
  assert.equal(authEvents[0].user.name, 'Radio Preview');
  assert.equal(session.token(), 'preview-token');
  client.stop();
});

test('network client validates a saved token before connecting', async () => {
  const events = [];
  const calls = [];
  const user = { id: 4, name: 'Диктор' };
  const session = {
    token: () => 'saved-token', user: () => user,
    save(token, nextUser) { calls.push(['save', token, nextUser]); }, clear() {},
  };
  const client = createRadioNetworkClient({
    session,
    http: { async me(token) { calls.push(['me', token]); return { user }; } },
    netFactory() { return { status: 'closed', connect() { calls.push(['connect']); }, disconnect() {} }; },
  });
  client.api.on('auth', (value) => events.push(value));
  client.start();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(events, [{ user }]);
  assert.deepEqual(calls.map(([name]) => name), ['me', 'save', 'connect']);
  client.stop();
});

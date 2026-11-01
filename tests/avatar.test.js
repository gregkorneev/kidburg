import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { AVATAR_VARIANT_COUNT, DEFAULT_AVATAR, normalizeAvatar } from '../shared/avatar.js';
import { openDb } from '../server/db/index.js';
import { makeApp } from './helpers.js';

const avatar = { skin: 3, clothes: 1, hair: 2, hairColor: 1, shoes: 0 };
const post = (app, url, payload) => app.inject({ method: 'POST', url, payload });

test('avatar: strict fields, ranges and unusual objects', () => {
  assert.equal(AVATAR_VARIANT_COUNT, 4);
  assert.deepEqual(DEFAULT_AVATAR, { skin: 0, clothes: 0, hair: 0, hairColor: 0, shoes: 0 });
  for (const field of Object.keys(avatar)) {
    for (const value of [0, 1, 2, 3]) assert.deepEqual(normalizeAvatar({ ...avatar, [field]: value }), { ...avatar, [field]: value });
    for (const value of [-1, 4, '1', 1.5, NaN, Infinity, null]) assert.equal(normalizeAvatar({ ...avatar, [field]: value }), null);
  }
  for (const value of [undefined, null, [], {}, { ...avatar, extra: 0 }, JSON.parse('{"skin":0,"clothes":0,"hair":0,"shoes":0,"__proto__":{}}'), Object.assign(Object.create({ polluted: true }), avatar), { ...avatar, get hair() { throw Error('getter'); } }]) assert.equal(normalizeAvatar(value), null);
  assert.deepEqual(normalizeAvatar(Object.assign(Object.create(null), avatar)), avatar);
});

test('SQLite persists independent avatars and reads legacy and malformed JSON', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'city-avatar-db-'));
  const file = path.join(dir, 'city.db');
  try {
    let db = openDb(file);
    const create = (name, appearance) => db.createUser({ name, passHash: 'hash', salt: 'salt', appearance });
    const a = create('Anna', { avatar, color: 123 });
    const b = create('Boris', { avatar: DEFAULT_AVATAR });
    const legacy = create('Legacy', {});
    const color = create('Color', { color: 42 });
    assert.deepEqual(db.getUser(a.id).appearance, { avatar, color: 123 });
    db.close();
    const raw = new Database(file);
    raw.prepare('UPDATE users SET appearance = ? WHERE id = ?').run('{bad', legacy.id);
    raw.close();
    db = openDb(file);
    assert.deepEqual(db.getUser(a.id).appearance, { avatar, color: 123 });
    assert.deepEqual(db.getUser(b.id).appearance, { avatar: DEFAULT_AVATAR });
    assert.deepEqual(db.getUser(legacy.id).appearance, {});
    assert.deepEqual(db.getUser(color.id).appearance, { color: 42 });
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('join persists avatar; repeated join and legacy keep their saved appearance', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'city-avatar-auth-'));
  const dbPath = path.join(dir, 'city.db');
  const seed = openDb(dbPath);
  seed.createUser({ name: 'Legacy', passHash: 'h', salt: 's', appearance: { color: 42 } });
  const oldAvatar = { skin: 3, clothes: 2, hair: 3, shoes: 0 };
  seed.createUser({ name: 'OldAvatar', passHash: 'h', salt: 's', appearance: { avatar: oldAvatar } });
  seed.createUser({ name: 'Empty', passHash: 'h', salt: 's', appearance: {} });
  seed.close();
  let app = await makeApp({ dbPath, roomCode: 'ABCD' });
  try {
    for (const invalid of [undefined, null, {}, { skin: 3, clothes: 1, hair: 2, shoes: 0 }, { ...avatar, skin: 4 }, { ...avatar, extra: 1 }]) {
      const res = await post(app, '/api/join', { name: 'Invalid', room: 'ABCD', appearance: { avatar: invalid } });
      assert.equal(res.statusCode, 400); assert.equal(res.json().error, 'bad_appearance');
    }
    const first = await post(app, '/api/join', { name: 'Anna', room: 'ABCD', appearance: { avatar } });
    assert.equal(first.statusCode, 200);
    const { token, user } = first.json();
    assert.deepEqual(user.appearance, { avatar });
    assert.deepEqual((await app.inject({ url: '/api/me', headers: { authorization: `Bearer ${token}` } })).json().user.appearance, { avatar });
    const again = await post(app, '/api/join', { name: 'Anna', room: 'ABCD', appearance: { avatar: DEFAULT_AVATAR } });
    assert.deepEqual(again.json().user.appearance, { avatar });
    const legacy = await post(app, '/api/join', { name: 'Legacy', room: 'ABCD' });
    assert.equal(legacy.json().error, 'appearance_required');
    const migrated = await post(app, '/api/join', { name: 'Legacy', room: 'ABCD', appearance: { avatar } });
    assert.deepEqual(migrated.json().user.appearance, { color: 42, avatar });
    const old = await post(app, '/api/join', { name: 'OldAvatar', room: 'ABCD', appearance: { avatar } });
    assert.deepEqual(old.json().user.appearance, { avatar: oldAvatar });
    const empty = await post(app, '/api/join', { name: 'Empty', room: 'ABCD', appearance: { avatar } });
    assert.deepEqual(empty.json().user.appearance, { avatar });
    const db = openDb(dbPath); assert.deepEqual(db.getUser(user.id).appearance, { avatar }); assert.deepEqual(db.findUserByName('OldAvatar').appearance, { avatar: oldAvatar }); db.close();
    await app.close();
    app = await makeApp({ dbPath, roomCode: 'ABCD' });
    assert.deepEqual((await post(app, '/api/join', { name: 'Anna', room: 'ABCD' })).json().user.appearance, { avatar });
    assert.deepEqual((await post(app, '/api/join', { name: 'OldAvatar', room: 'ABCD' })).json().user.appearance, { avatar: oldAvatar });
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('password register requires avatar; login never replaces it', async () => {
  const app = await makeApp({ passwordAuth: true });
  try {
    for (const invalid of [undefined, null, { skin: 3, clothes: 1, hair: 2, shoes: 0 }, { ...avatar, hair: '1' }]) {
      const res = await post(app, '/api/register', { name: 'Anna', password: 'secret', appearance: { avatar: invalid } });
      assert.equal(res.statusCode, 400); assert.equal(res.json().error, 'bad_appearance');
    }
    const registered = await post(app, '/api/register', { name: 'Anna', password: 'secret', appearance: { avatar } });
    assert.equal(registered.statusCode, 201); assert.deepEqual(registered.json().user.appearance, { avatar });
    for (let i = 0; i < 2; i++) {
      const login = await post(app, '/api/login', { name: 'Anna', password: 'secret', appearance: { avatar: DEFAULT_AVATAR } });
      assert.equal(login.statusCode, 200); assert.deepEqual(login.json().user.appearance, { avatar });
      const me = await app.inject({ url: '/api/me', headers: { authorization: `Bearer ${login.json().token}` } });
      assert.deepEqual(me.json().user.appearance, { avatar });
    }
  } finally { await app.close(); }
});


test('join: skin is requested only when missing; probe creates neither user nor session', async () => {
  const db = openDb(':memory:');
  const app = await makeApp({ roomCode: 'ABCD', db });
  try {
    const probe = await post(app, '/api/join', { name: 'Newcomer', room: 'ABCD' });
    assert.equal(probe.statusCode, 400);
    assert.equal(probe.json().error, 'appearance_required');
    assert.equal(probe.json().token, undefined);
    assert.equal(db.findUserByName('Newcomer'), null);
    for (const stored of [{}, { color: 42 }, { avatar: { skin: 9 } }]) {
      const user = db.createUser({ name: 'Legacy' + Object.keys(stored).join(''), passHash: 'h', salt: 's', appearance: stored });
      const required = await post(app, '/api/join', { name: user.name, room: 'ABCD' });
      assert.equal(required.json().error, 'appearance_required');
      assert.equal(required.json().token, undefined);
      const saved = await post(app, '/api/join', { name: user.name, room: 'ABCD', appearance: { avatar } });
      assert.equal(saved.statusCode, 200);
      assert.equal(saved.json().user.id, user.id);
      assert.deepEqual(saved.json().user.appearance, { ...stored, avatar });
      const repeated = await post(app, '/api/join', { name: user.name, room: 'ABCD' });
      assert.equal(repeated.statusCode, 200);
      assert.deepEqual(repeated.json().user.appearance.avatar, avatar);
    }
  } finally { await app.close(); }
});

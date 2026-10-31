import test from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode, validate, C2S, S2C } from '../shared/protocol.js';

test('encode/decode: туда и обратно', () => {
  const msg = { t: 'pos', x: 1.5, y: 0, z: -3, ry: 0.25, anim: 1, seq: 7 };
  assert.deepEqual(decode(encode(msg)), msg);
});

test('encode/decode: бинарные данные чанка сохраняются', () => {
  const data = new Uint8Array([1, 2, 3, 255]);
  const out = decode(encode({ t: 'chunk_load', cx: 6, cz: 6, data }));
  assert.deepEqual(Array.from(out.data), [1, 2, 3, 255]);
});

test('validate: корректные сообщения проходят', () => {
  assert.equal(validate({ t: 'hello', ticket: 'abc', proto: 1 }).ok, true);
  assert.equal(validate({ t: 'pos', x: 0, y: 0, z: 0, ry: 0, anim: 2, seq: 1 }).ok, true);
  assert.equal(validate({ t: 'chat', text: 'привет' }).ok, true);
  assert.equal(validate({ t: 'chat', from: 'bot1', text: 'привет', ts: 1 }, 's2c').ok, true);
  assert.equal(validate({ t: 'error', code: 'rate_limit', message: 'м' }).ok, true);
});

test('validate: невалидные сообщения отклоняются', () => {
  assert.equal(validate(null).ok, false);
  assert.equal(validate({}).ok, false);
  assert.equal(validate({ t: 'nope' }).ok, false);
  assert.equal(validate({ t: 'hello', ticket: 1, proto: 1 }).ok, false);
  assert.equal(validate({ t: 'pos', x: NaN, y: 0, z: 0, ry: 0, anim: 0, seq: 1 }).ok, false);
  assert.equal(validate({ t: 'pos', x: 0, y: 0, z: 0, ry: 0, anim: 5, seq: 1 }).ok, false);
  assert.equal(validate({ t: 'chat', text: 'x'.repeat(201) }).ok, false);
  assert.equal(validate({ t: 'chat', text: '' }).ok, false);
  assert.equal(validate({ t: 'error', code: 'weird', message: 'м' }).ok, false);
  assert.equal(validate({ t: 'players', tick: 1, list: [[1, 2, 3]] }).ok, false);
});

test('каждый тип из C2S и S2C имеет схему валидации', () => {
  for (const t of [...Object.values(C2S), ...Object.values(S2C)]) {
    const res = validate({ t, bogus: true });
    assert.notEqual(res.error, `неизвестный тип: ${t}`);
  }
});

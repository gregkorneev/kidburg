import test from 'node:test';
import assert from 'node:assert/strict';
import { wikiRemote } from '../scripts/wiki.mjs';

test('wikiRemote: адрес Wiki из адреса репозитория', () => {
  assert.equal(wikiRemote('git@github.com:o/r.git'), 'git@github.com:o/r.wiki.git');
  assert.equal(wikiRemote('https://github.com/o/r'), 'https://github.com/o/r.wiki.git');
});

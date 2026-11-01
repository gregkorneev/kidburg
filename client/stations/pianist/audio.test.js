import test from 'node:test';
import assert from 'node:assert/strict';
import { createPianoAudio } from './audio.js';

class FakeAudioContext {
  static instances = [];
  constructor() { this.state = 'running'; this.currentTime = 1; this.destination = {}; this.frequencies = []; FakeAudioContext.instances.push(this); }
  createGain() { return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} }, connect() { return this; } }; }
  createOscillator() { const context = this; return { frequency: { set value(v) { context.frequencies.push(v); }, setValueAtTime(v) { context.frequencies.push(v); } }, type: '', connect() { return this; }, start() {}, stop() {} }; }
  close() { this.closed = true; return Promise.resolve(); }
}

test('AudioContext создаётся после действия, ноты используют собственные частоты и контекст закрывается', async () => {
  FakeAudioContext.instances = [];
  const piano = createPianoAudio({ AudioContextClass: FakeAudioContext });
  assert.equal(FakeAudioContext.instances.length, 0);
  piano.play('C4'); piano.play('A4');
  assert.deepEqual(FakeAudioContext.instances[0].frequencies.slice(0, 6).map((n) => Math.round(n * 1e6) / 1e6), [261.625565, 523.25113, 784.876695, 440, 880, 1320]);
  assert.equal(piano.active, true);
  await piano.dispose();
  assert.equal(FakeAudioContext.instances[0].closed, true);
  assert.equal(piano.active, false);
});

test('выключенный звук не запускает аудио и громкость ограничена диапазоном', () => {
  FakeAudioContext.instances = [];
  const piano = createPianoAudio({ AudioContextClass: FakeAudioContext });
  piano.setEnabled(false);
  assert.equal(piano.play('C4'), false);
  assert.equal(FakeAudioContext.instances.length, 0);
  piano.setVolume(2);
  piano.setEnabled(true);
  assert.equal(piano.play('E4'), true);
  assert.ok(FakeAudioContext.instances[0].frequencies[0] > 329 && FakeAudioContext.instances[0].frequencies[0] < 330);
  piano.dispose();
});

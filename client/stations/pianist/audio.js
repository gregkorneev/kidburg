import { noteById } from './melody.js';

export function createPianoAudio({ AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext } = {}) {
  let context = null;
  let master = null;
  let volume = 0.55;
  let enabled = true;
  function activate() {
    if (!AudioContextClass) return null;
    if (!context) {
      context = new AudioContextClass();
      master = context.createGain();
      master.gain.value = volume;
      master.connect(context.destination);
    }
    if (context.state === 'suspended') context.resume().catch(() => {});
    return context;
  }
  return {
    play(noteId) {
      const note = noteById(noteId);
      if (!enabled || !note) return false;
      const ctx = activate();
      if (!ctx) return false;
      const now = ctx.currentTime;
      const envelope = ctx.createGain();
      envelope.gain.setValueAtTime(0.0001, now);
      envelope.gain.linearRampToValueAtTime(0.19, now + 0.025);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + 1.25);
      envelope.connect(master);
      for (const [multiple, level] of [[1, 1], [2, 0.28], [3, 0.12]]) {
        const oscillator = ctx.createOscillator();
        const partial = ctx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = note.frequency * multiple;
        partial.gain.value = level;
        oscillator.connect(partial).connect(envelope);
        oscillator.start(now);
        oscillator.stop(now + 1.3);
      }
      return true;
    },
    tick() {
      if (!enabled) return false;
      const ctx = activate();
      if (!ctx) return false;
      const now = ctx.currentTime;
      const oscillator = ctx.createOscillator();
      const envelope = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(1240, now);
      envelope.gain.setValueAtTime(0.0001, now);
      envelope.gain.linearRampToValueAtTime(0.045, now + 0.004);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
      oscillator.connect(envelope).connect(master);
      oscillator.start(now);
      oscillator.stop(now + 0.06);
      return true;
    },
    setVolume(value) {
      volume = Math.min(1, Math.max(0, Number(value) || 0));
      if (master && context) master.gain.setTargetAtTime(volume, context.currentTime, 0.03);
    },
    setEnabled(value) { enabled = Boolean(value); },
    dispose() {
      if (!context) return Promise.resolve();
      const current = context;
      context = null;
      master = null;
      return current.close();
    },
    get active() { return context !== null; },
  };
}

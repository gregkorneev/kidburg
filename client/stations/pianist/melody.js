export const NOTES = Object.freeze([
  Object.freeze({ id: 'C4', label: 'До', frequency: 261.625565, key: 'KeyA', black: false }),
  Object.freeze({ id: 'C#4', label: 'До♯', frequency: 277.182631, key: null, black: true }),
  Object.freeze({ id: 'D4', label: 'Ре', frequency: 293.664768, key: 'KeyS', black: false }),
  Object.freeze({ id: 'D#4', label: 'Ре♯', frequency: 311.126984, key: null, black: true }),
  Object.freeze({ id: 'E4', label: 'Ми', frequency: 329.627557, key: 'KeyD', black: false }),
  Object.freeze({ id: 'F4', label: 'Фа', frequency: 349.228231, key: 'KeyF', black: false }),
  Object.freeze({ id: 'F#4', label: 'Фа♯', frequency: 369.994423, key: null, black: true }),
  Object.freeze({ id: 'G4', label: 'Соль', frequency: 391.995436, key: 'KeyG', black: false }),
  Object.freeze({ id: 'G#4', label: 'Соль♯', frequency: 415.304698, key: null, black: true }),
  Object.freeze({ id: 'A4', label: 'Ля', frequency: 440, key: 'KeyH', black: false }),
  Object.freeze({ id: 'A#4', label: 'Ля♯', frequency: 466.163762, key: null, black: true }),
  Object.freeze({ id: 'B4', label: 'Си', frequency: 493.883301, key: 'KeyJ', black: false }),
  Object.freeze({ id: 'C5', label: 'До', frequency: 523.251131, key: 'KeyK', black: false }),
]);

export const LESSON = Object.freeze(['C4', 'D4', 'E4', 'G4']);
export const MELODY = Object.freeze(['C4', 'D4', 'E4', 'G4', 'G4', 'E4', 'D4', 'C4']);
export const RHYTHM_BPM = 90;
export const RHYTHM_TOLERANCE_MS = 230;
export const noteById = (id) => NOTES.find((note) => note.id === id);
export const noteByKey = (code) => NOTES.find((note) => note.key === code);

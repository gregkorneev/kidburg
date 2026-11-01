import test from 'node:test';
import assert from 'node:assert/strict';
import { targetsForState } from './targets.js';

const layout = {
  buckets: {
    pink_tulip: { position: 'tulips' }, white_daisy: { position: 'daisies' },
    red_rose: { position: 'roses' }, greenery: { position: 'greenery' },
  },
  stations: { lilia: 'lilia', workbench: 'workbench', wrapping: 'wrapping', handoff: 'handoff' },
};

test('неправильный готовый букет можно исправить у рабочего стола', () => {
  const state = { stage: 'wrapping', stems: Array.from({ length: 5 }, (_, i) => ({ id: i, type: 'red_rose' })) };
  assert.deepEqual(targetsForState(state, layout).map(({ kind, position }) => [kind, position]), [
    ['remove', 'workbench'],
  ]);
  const valid = { ...state, stems: [
    { type: 'pink_tulip' }, { type: 'pink_tulip' }, { type: 'white_daisy' },
    { type: 'white_daisy' }, { type: 'greenery' },
  ] };
  assert.deepEqual(targetsForState(valid, layout).map(({ kind, position }) => [kind, position]), [
    ['remove', 'workbench'], ['wrap', 'wrapping'],
  ]);
});

test('выбор стеблей, перенос, сдача и повтор используют только доступные цели', () => {
  assert.equal(targetsForState({ stage: 'collecting', heldFlower: null, stems: [] }, layout).filter((t) => t.kind === 'take').length, 4);
  assert.deepEqual(targetsForState({ stage: 'collecting', heldFlower: { type: 'pink_tulip' }, stems: [] }, layout).map((t) => t.kind), ['add']);
  assert.deepEqual(targetsForState({ stage: 'handoff', stems: [], wrapped: true }, layout).map((t) => t.kind), ['handoff']);
});

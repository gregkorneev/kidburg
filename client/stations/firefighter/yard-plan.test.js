import test from 'node:test';
import assert from 'node:assert/strict';
import { BENCHES, BUSHES, CONES, FENCES, KEEP_CLEAR, KEY_POINTS, LAMPS, PAVED, PLANTERS, TREES, insideRect, isYardClear } from './yard-plan.js';

test('двор: деревья, кусты, лавочки и фонари не стоят на дорожках и рабочих площадках', () => {
  for (const [name, list, margin] of [['дерево', TREES, 0.6], ['куст', BUSHES, 0.3], ['лавочка', BENCHES, 0.2], ['фонарь', LAMPS, 0.2]]) {
    for (const item of list) assert.ok(isYardClear(item.x, item.z, margin), `${name} (${item.x}, ${item.z}) попадает в зону без декора`);
  }
});

test('двор: интерактивные точки заданий свободны от декора с запасом', () => {
  const decor = [...TREES, ...BUSHES, ...BENCHES, ...LAMPS, ...CONES, ...PLANTERS];
  for (const [name, point] of Object.entries(KEY_POINTS)) {
    if (typeof point.x !== 'number') continue;
    for (const item of decor) {
      const distance = Math.hypot(item.x - point.x, item.z - point.z);
      // Конусы и вазоны — низкий декор; деревья, кусты, лавки и фонари держим подальше.
      const low = CONES.includes(item) || PLANTERS.includes(item);
      assert.ok(distance > (low ? 0.5 : 0.9), `${name}: предмет (${item.x}, ${item.z}) в ${distance.toFixed(2)} м от точки`);
    }
  }
});

test('двор: покрытия имеют разные высоты там, где пересекаются (без мерцания плоскостей)', () => {
  const list = Object.values(PAVED);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
      if (overlap) assert.notEqual(a.y, b.y, 'пересекающиеся покрытия на одной высоте');
    }
  }
});

test('двор: заборы лежат на задней и боковой границе, а зоны без декора не вырождены', () => {
  for (const fence of FENCES) assert.ok(fence.z0 < 0 || fence.x0 < 0, 'забор не перекрывает главный проход');
  for (const r of KEEP_CLEAR) assert.ok(r.x1 > r.x0 && r.z1 > r.z0);
  assert.ok(insideRect({ x0: 0, x1: 1, z0: 0, z1: 1 }, 0.5, 0.5));
  assert.ok(!insideRect({ x0: 0, x1: 1, z0: 0, z1: 1 }, 1.2, 0.5));
  assert.ok(insideRect({ x0: 0, x1: 1, z0: 0, z1: 1 }, 1.2, 0.5, 0.5), 'margin расширяет прямоугольник');
});

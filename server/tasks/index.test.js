import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { FIREFIGHTER_TASK_ID } from './firefighter_station_v1.js';
import { getState, handle, registerTasks } from './index.js';

test('registerTasks exposes the handler and restores state through the task dispatcher', async () => {
  const db = openDb(':memory:');
  try {
    const user = db.createUser({ name: 'dispatcher-player', passHash: 'test', salt: 'test' });
    const points = { npc: { x: 2, y: 0, z: 2, radius: 2 } };
    const decorators = new Map();
    const app = {
      hasDecorator: (name) => decorators.has(name),
      decorate: (name, value) => decorators.set(name, value),
    };

    registerTasks(app, { db, config: { firefighterInteractionPoints: points, now: () => 2000 } });
    const registered = decorators.get('taskHandlers');
    assert.equal(typeof registered.handle, 'function');
    assert.equal(typeof registered.getState, 'function');

    const accepted = await handle(user.id, FIREFIGHTER_TASK_ID, {
      action: 'start',
      done: true,
      progress: 100,
      position: { x: 200, y: 0, z: 200 },
    }, { playerPosition: { x: 2, y: 0, z: 2 } });
    assert.equal(accepted.state.stage, 'briefing');
    assert.equal(accepted.done, false);

    const restored = getState(user.id);
    assert.equal(restored.state.stage, 'briefing');
    assert.equal(registered.getState(user.id).state.stage, 'briefing');

    const resumed = await handle(user.id, FIREFIGHTER_TASK_ID, { action: 'resume' });
    assert.equal(resumed.state.stage, 'briefing');
    assert.equal(resumed.done, false);
  } finally {
    db.close();
  }
});

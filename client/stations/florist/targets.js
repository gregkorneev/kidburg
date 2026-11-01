import { ORDER, orderMatches } from './state.js';

export function targetDistance(target, x, z) {
  if (!target.desk) return Math.hypot(x - target.position.x, z - target.position.z);
  const { desk } = target;
  return Math.hypot(Math.max(0, Math.abs(x - desk.x) - desk.width / 2), Math.max(0, Math.abs(z - desk.z) - desk.depth / 2));
}

export function targetsForState(state, layout) {
  if (!state) return [];
  if (['not_started', 'briefing', 'completed'].includes(state.stage)) {
    return [{ kind: 'lilia', position: layout.stations.lilia }];
  }
  if (state.stage === 'collecting') {
    const targets = [];
    if (!state.heldFlower && state.stems.length < ORDER.total) {
      for (const [flower, bucket] of Object.entries(layout.buckets)) targets.push({ kind: 'take', flower, position: bucket.position });
    }
    if (state.heldFlower) targets.push({ kind: 'add', position: layout.stations.workbench, desk: layout.plan?.desks.workbench });
    else if (state.stems.length) targets.push({ kind: 'remove', position: layout.stations.workbench, desk: layout.plan?.desks.workbench });
    return targets;
  }
  if (state.stage === 'wrapping') {
    const targets = [{ kind: 'remove', position: layout.stations.workbench, desk: layout.plan?.desks.workbench }];
    if (orderMatches(state.stems)) targets.push({ kind: 'wrap', position: layout.stations.wrapping, desk: layout.plan?.desks.wrapping });
    return targets;
  }
  if (state.stage === 'handoff') return [{ kind: 'handoff', position: layout.stations.handoff }];
  return [];
}

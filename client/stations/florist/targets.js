import { ORDER, orderMatches } from './state.js';

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
    if (state.heldFlower) targets.push({ kind: 'add', position: layout.stations.workbench });
    else if (state.stems.length) targets.push({ kind: 'remove', position: layout.stations.workbench });
    return targets;
  }
  if (state.stage === 'wrapping') {
    const targets = [{ kind: 'remove', position: layout.stations.workbench }];
    if (orderMatches(state.stems)) targets.push({ kind: 'wrap', position: layout.stations.wrapping });
    return targets;
  }
  if (state.stage === 'handoff') return [{ kind: 'handoff', position: layout.stations.handoff }];
  return [];
}

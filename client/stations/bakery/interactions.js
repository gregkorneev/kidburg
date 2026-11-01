import { ZONES } from './layout.js';
import { actionForStage, OBJECTIVES } from './state.js';

export function activeZone(state) {
  const action = actionForStage(state.stage);
  return ZONES.find((zone) => zone.action === action) ?? (action === 'repeat_order' ? ZONES[0] : null);
}

export function nearestZone(position, zones = ZONES) {
  let nearest = null;
  let distance = Infinity;
  for (const zone of zones) {
    const d = Math.hypot(position.x - zone.x, position.z - zone.z);
    if (d <= zone.radius && d < distance) { nearest = zone; distance = d; }
  }
  return nearest;
}

export function interactionPrompt(state, position) {
  const near = nearestZone(position);
  if (!near) return '';
  const target = activeZone(state);
  return near === target ? (state.stage === 'completed' ? 'Новый заказ' : near.label)
    : `Сначала: ${OBJECTIVES[state.stage]}`;
}

export function resolveInteraction(state, position) {
  const near = nearestZone(position);
  if (!near) return { action: null, feedback: '' };
  const target = activeZone(state);
  if (near !== target) return { action: null, feedback: `Сначала: ${OBJECTIVES[state.stage]}` };
  return { action: state.stage === 'completed' ? 'repeat_order' : near.action, feedback: '' };
}

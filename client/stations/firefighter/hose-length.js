export const MAX_HOSE_DISTANCE = 10;

// Allow a player already outside the limit to return, but never move farther away.
export function canMoveWithHose(active, current, next, anchor) {
  if (!active) return true;
  const distanceSquared = (point) => (point.x - anchor.x) ** 2 + (point.z - anchor.z) ** 2;
  const nextDistance = distanceSquared(next);
  return nextDistance <= MAX_HOSE_DISTANCE ** 2 || nextDistance < distanceSquared(current);
}

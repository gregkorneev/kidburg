// Reject movement segments that would pass through another player's horizontal footprint.
const distance = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

export function overlapsPlayerPath(from, to, other, radius) {
  if (to.y >= other.y + other.height || to.y + other.height <= other.y) return false;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length2 = dx * dx + dz * dz;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((other.x - from.x) * dx + (other.z - from.z) * dz) / length2));
  const closestX = from.x + dx * t;
  const closestZ = from.z + dz * t;
  const minDistance = radius + other.radius;
  if (distance(closestX, closestZ, other.x, other.z) >= minDistance) return false;
  const startDistance = distance(from.x, from.z, other.x, other.z);
  const endDistance = distance(to.x, to.z, other.x, other.z);
  // If a spawn or terrain correction already overlaps, allow movement that separates the players.
  return startDistance >= minDistance || endDistance + 1e-6 < startDistance;
}

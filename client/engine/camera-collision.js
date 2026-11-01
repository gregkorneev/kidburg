const AXES = Object.freeze(['x', 'y', 'z']);

function rayBoxEntry(origin, direction, maxDistance, box, radius) {
  let entry = 0;
  let exit = maxDistance;
  for (const axis of AXES) {
    const min = box[`min${axis.toUpperCase()}`] - radius;
    const max = box[`max${axis.toUpperCase()}`] + radius;
    const component = direction[axis];
    if (Math.abs(component) < 1e-8) {
      if (origin[axis] < min || origin[axis] > max) return null;
      continue;
    }
    let near = (min - origin[axis]) / component;
    let far = (max - origin[axis]) / component;
    if (near > far) [near, far] = [far, near];
    entry = Math.max(entry, near);
    exit = Math.min(exit, far);
    if (entry > exit) return null;
  }
  return exit >= 0 && entry <= maxDistance ? Math.max(0, entry) : null;
}

/** Distance along focus→desired before the camera sphere reaches the nearest blocker. */
export function safeCameraDistance(focus, desired, blockers, { radius = 0.22, clearance = 0.1 } = {}) {
  const dx = desired.x - focus.x;
  const dy = desired.y - focus.y;
  const dz = desired.z - focus.z;
  const fullDistance = Math.hypot(dx, dy, dz);
  if (fullDistance < 1e-8 || !blockers?.length) return fullDistance;

  const direction = { x: dx / fullDistance, y: dy / fullDistance, z: dz / fullDistance };
  let nearest = fullDistance;
  for (const box of blockers) {
    const hit = rayBoxEntry(focus, direction, fullDistance, box, radius);
    if (hit !== null && hit < nearest) nearest = hit;
  }
  return nearest === fullDistance ? fullDistance : Math.max(0.12, nearest - clearance);
}

/** Obstruction clamps immediately; an unobstructed camera eases back to its normal arm length. */
export function approachCameraDistance(current, target, dt, returnSpeed = 4) {
  if (target <= current) return target;
  const alpha = 1 - Math.exp(-returnSpeed * Math.max(0, dt));
  return current + (target - current) * alpha;
}

export const REEL_RADIUS = 0.48;
export const INITIAL_REEL_TURNS = 4.5;

// Distance is measured between the reel centre and the held coupling.
export function advanceReel(angle, previousLength, length, radius = REEL_RADIUS) {
  if (previousLength === null) return angle;
  return angle - (length - previousLength) / radius;
}

export function woundTurns(angle) {
  return INITIAL_REEL_TURNS + angle / (Math.PI * 2);
}

// One selection drives both the E prompt and its action.
export function nearestInteraction(candidates) {
  let nearest = null;
  for (const candidate of candidates) {
    if (candidate.distance < candidate.radius && (!nearest || candidate.distance < nearest.distance)) nearest = candidate;
  }
  return nearest;
}

import { createSession } from './session.js';
import { appearanceFromSeed } from './art/character-appearance.js';

/** One stable appearance for a player ID; profile color is shared with remote avatars. */
export function createPlayerAppearance(user, playerId = user?.id) {
  if (!Number.isSafeInteger(playerId) || playerId < 0) return null;
  const color = typeof user?.appearance?.color === 'number' ? user.appearance.color : null;
  return appearanceFromSeed(playerId, color);
}

/** Current same-origin session, used by standalone location pages. */
export function currentPlayerAppearance(storage) {
  try {
    return createPlayerAppearance(createSession(storage).user());
  } catch {
    return null;
  }
}

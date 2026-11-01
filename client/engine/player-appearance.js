import { createSession } from './session.js';
import { appearanceFromSeed } from './art/character-appearance.js';
import { normalizeAvatar } from '../../shared/avatar.js';

const SKINS = ['#f7d6b8', '#e9ae83', '#c98b63', '#a96a49'];
const CLOTHES = [
  { top: 'tee', outfit: '#3f8a68', pants: '#4d6478', topAccent: '#e2b94f' },
  { top: 'hoodie', outfit: '#5f78b0', pants: '#5b6770', topAccent: '#e8c777' },
  { top: 'jacket', outfit: '#b45a4d', pants: '#6b7a5a', topAccent: '#f0d8ae' },
  { top: 'sweater', outfit: '#9872a8', pants: '#6a5f78', topAccent: '#a9d7cf' },
];
const HAIR = ['short', 'bob', 'curly', 'ponytail'];
const SHOES = [
  { shoes: 'sneaker', shoeColor: '#ece3d2' },
  { shoes: 'sneaker', shoeColor: '#426eac' },
  { shoes: 'boot', bootColor: '#70452f' },
  { shoes: 'boot', bootColor: '#292d39' },
];

/** Resolve a saved profile or a bare avatar for both game players and previews. */
export function resolvePlayerAppearance({ id = 0, appearance = {} } = {}) {
  if (!Number.isSafeInteger(id) || id < 0) return null;
  const avatar = normalizeAvatar(appearance?.avatar ?? appearance);
  const color = typeof appearance?.color === 'number' ? appearance.color : null;
  const base = appearanceFromSeed(id, color);
  if (!avatar) return base;
  return { ...base, skin: SKINS[avatar.skin], ...CLOTHES[avatar.clothes], hairStyle: HAIR[avatar.hair], ...SHOES[avatar.shoes], accessory: 'none' };
}

/** One stable appearance for a player ID; profile color is shared with remote avatars. */
export function createPlayerAppearance(user, playerId = user?.id) {
  if (!Number.isSafeInteger(playerId) || playerId < 0) return null;
  return resolvePlayerAppearance({ id: playerId, appearance: user?.appearance });
}

/** Current same-origin session, used by standalone location pages. */
export function currentPlayerAppearance(storage) {
  try {
    return createPlayerAppearance(createSession(storage).user());
  } catch {
    return null;
  }
}

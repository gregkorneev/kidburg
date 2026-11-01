// Выбор цели клавиши E в городе. Вход в цветочную лавку, вход в пожарную часть и ворота — разные цели, но подсказка
// одна: побеждает ближайшая. Ворота имеют малый радиус (рядом с ними), входы — большой (весь подход к зданию).

/**
 * @param {{x: number, z: number}} player
 * @param {{florist: object, fire: object}} entrances объекты с x, z, radius, href, label
 * @param {{id: string, kind: string, object: object, x: number, z: number, radius: number}[]} mechanisms
 * @returns {{kind: 'florist'|'fire'|'mechanism', label: string, distance: number, href?: string, mechanism?: object} | null}
 */
export function pickCityInteraction(player, { florist, fire }, mechanisms = [], npc = null) {
  if (!Number.isFinite(player?.x) || !Number.isFinite(player?.z)) return null;
  const candidates = [];
  const add = (kind, target, extra) => {
    const distance = Math.hypot(player.x - target.x, player.z - target.z);
    if (distance <= target.radius) candidates.push({ kind, distance, ...extra });
  };
  add('florist', florist, { label: florist.label, href: florist.href });
  add('fire', fire, { label: fire.label, href: fire.href });
  if (npc) add('npc', npc, { npc });
  for (const m of mechanisms) {
    if (m.kind !== 'gate') continue;
    add('mechanism', m, { label: `${m.object.label}`, mechanism: m });
  }
  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) => (c.distance < best.distance ? c : best));
}

/** Коллизии ворот города: створки блокируют проём до тех пор, пока не освободили его почти полностью. */
export function cityGateColliders(mechanisms = []) {
  return mechanisms.filter((m) => m.kind === 'gate' && m.object?.blocking).map((m) => ({
    x: m.x,
    z: m.z,
    minX: m.x - m.width / 2,
    maxX: m.x + m.width / 2,
    minY: m.minY,
    maxY: m.maxY,
    minZ: m.z - m.depth / 2,
    maxZ: m.z + m.depth / 2,
    halfWidth: m.width / 2,
    halfDepth: m.depth / 2,
    rotationY: m.rotationY,
  }));
}

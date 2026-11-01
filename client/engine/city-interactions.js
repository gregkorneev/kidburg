// Выбор цели клавиши E в городе. Вход в цветочную лавку, вход в пожарную часть и ворота — разные цели, но подсказка
// одна: побеждает ближайшая. Ворота имеют малый радиус (рядом с ними), входы — большой (весь подход к зданию).

/**
 * @param {{x: number, z: number}} player
 * @param {Record<string, object>} entrances входы по типу цели ({florist, fire, bakery}): объекты с x, z, radius, href, label
 * @param {{id: string, kind: string, object: object, x: number, z: number, radius: number}[]} mechanisms
 * @returns {{kind: string (вход) | 'npc' | 'mechanism', label: string, distance: number, href?: string, mechanism?: object} | null}
 */
export function pickCityInteraction(player, entrances, mechanisms = [], npc = null) {
  if (!Number.isFinite(player?.x) || !Number.isFinite(player?.z)) return null;
  const candidates = [];
  const add = (kind, target, extra) => {
    const distance = Math.hypot(player.x - target.x, player.z - target.z);
    if (distance <= target.radius) candidates.push({ kind, distance, ...extra });
  };
  const doorHrefs = new Set(mechanisms.filter((m) => m.kind === 'door' && m.href).map((m) => m.href));
  for (const [kind, entrance] of Object.entries(entrances ?? {})) {
    if (entrance && !doorHrefs.has(entrance.href)) add(kind, entrance, { label: entrance.label, href: entrance.href });
  }
  if (npc) add('npc', npc, { npc });
  const hasYaw = Number.isFinite(player.yaw);
  const forward = hasYaw ? { x: -Math.sin(player.yaw), z: -Math.cos(player.yaw) } : null;
  for (const m of mechanisms) {
    if (m.kind === 'gate') add('mechanism', m, { label: `${m.object.label}`, mechanism: m });
    // Дверь с адресом перехода сама является точкой входа; так работают и здания без старых статических координат.
    else if (m.kind === 'door' && m.href) add('entrance', m, { label: `Войти в ${m.doorLabel ?? 'здание'}`, href: m.href });
    // Дверь без страницы интерьера открывается и закрывается клавишей E, если игрок смотрит в её сторону.
    else if (m.kind === 'door' && !m.href) {
      const dx = m.x - player.x;
      const dz = m.z - player.z;
      const d = Math.hypot(dx, dz);
      if (forward && d > 0.6 && (dx * forward.x + dz * forward.z) / d < 0.15) continue;
      add('mechanism', m, { label: `${m.object.label}`, mechanism: m });
    }
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

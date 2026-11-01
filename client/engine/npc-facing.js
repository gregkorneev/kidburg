const TWO_PI = Math.PI * 2;

// Поворачивает персонажа к ближайшему локальному игроку и возвращает его в исходное положение.
export function turnNpcToward(npc, position, player, dt, restYaw, radius = 10, forwardOffset = 0) {
  const dx = player ? player.x - position.x : 0;
  const dz = player ? player.z - position.z : 0;
  const near = player && Math.abs(player.y - position.y) < 3 && dx * dx + dz * dz < radius * radius;
  const target = near && (dx || dz) ? Math.atan2(dx, dz) - forwardOffset : restYaw;
  const turn = ((((target - npc.rotation.y) % TWO_PI) + Math.PI * 3) % TWO_PI) - Math.PI;
  npc.rotation.y += turn * Math.min(1, Math.max(0, dt) * 3.2);
  return Boolean(near);
}

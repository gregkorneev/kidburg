export function playerForward(yaw) {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/** createCharacter faces local +Z, while the player/camera faces local -Z at yaw 0. */
export function characterYawForPlayer(yaw) {
  return yaw + Math.PI;
}

export function characterForward(yaw) {
  const facing = characterYawForPlayer(yaw);
  return { x: Math.sin(facing), z: Math.cos(facing) };
}

export function setCameraFocus(focus, player) {
  return focus.set(player.x, player.y + 1.5, player.z);
}

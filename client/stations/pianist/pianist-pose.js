export const PIANIST_BENCH_LOCAL_Z = 1.35;
export const PIANIST_SEATED_LEG_ANGLE = -0.68;
export const PIANIST_PLAYING_ARM_ANGLE = -1.42;

export function getPianoSeatPose(position, rotationY = 0) {
  return {
    x: position.x + Math.sin(rotationY) * PIANIST_BENCH_LOCAL_Z,
    y: position.y ?? 0,
    z: position.z + Math.cos(rotationY) * PIANIST_BENCH_LOCAL_Z,
    yaw: rotationY,
  };
}

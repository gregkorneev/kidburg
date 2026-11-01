export const ROOM = Object.freeze({ width: 20, depth: 15, height: 6 });

export const PIANIST_PLAN = Object.freeze({
  spawn: Object.freeze({ x: 10, z: 4.2 }),
  maestro: Object.freeze({ x: 6.2, z: 3.2 }),
  practicePiano: Object.freeze({ x: 4.2, z: 6.5 }),
  stagePiano: Object.freeze({ x: 10.8, z: 12.55 }),
  stage: Object.freeze({ minX: 6.2, maxX: 15.4, minZ: 11.25, maxZ: 14.55, height: 0.3 }),
  stairs: Object.freeze({ centerX: 10.8, width: 4.4, startZ: 9.99, stepDepth: 0.42, stepHeight: 0.1, count: 3 }),
  instrumentCamera: Object.freeze({ practice: Object.freeze({ x: -2.4, z: 3.0 }), concert: Object.freeze({ x: 3.6, z: 1.5 }) }),
  audienceRows: Object.freeze([7.85, 9.35]),
  audienceLeftXs: Object.freeze([5.5, 6.45, 7.4, 8.35]),
  audienceRightXs: Object.freeze([12.9, 13.85, 14.8, 15.75]),
  betweenPianosChairZ: 6.85,
  betweenPianosLeftXs: Object.freeze([7.4, 8.5]),
  betweenPianosRightXs: Object.freeze([12.9, 14.0]),
  practiceRadius: 2.5,
  stageRadius: 2.5,
});

export const AUDIENCE_CHAIRS = Object.freeze(PIANIST_PLAN.audienceRows.flatMap((z, row) => [
  ...PIANIST_PLAN.audienceLeftXs.map((x, seat) => Object.freeze({ x, z, row, seat, side: 'left', rotationY: 0 })),
  ...PIANIST_PLAN.audienceRightXs.map((x, seat) => Object.freeze({ x, z, row, seat, side: 'right', rotationY: 0 })),
]));

export const BETWEEN_PIANOS_CHAIRS = Object.freeze([
  ...PIANIST_PLAN.betweenPianosLeftXs.map((x, seat) => Object.freeze({ x, z: PIANIST_PLAN.betweenPianosChairZ, row: -1, seat, side: 'left', rotationY: 0 })),
  ...PIANIST_PLAN.betweenPianosRightXs.map((x, seat) => Object.freeze({ x, z: PIANIST_PLAN.betweenPianosChairZ, row: -1, seat, side: 'right', rotationY: 0 })),
]);

export const POSTER_MOUNTS = Object.freeze([
  Object.freeze({ x: -0.015, y: 3.55, z: 5.0, rotationY: Math.PI / 2 }),
  Object.freeze({ x: -0.015, y: 3.55, z: 9.4, rotationY: Math.PI / 2 }),
  Object.freeze({ x: ROOM.width - 0.165, y: 3.55, z: 5.0, rotationY: -Math.PI / 2 }),
  Object.freeze({ x: ROOM.width - 0.165, y: 3.55, z: 9.4, rotationY: -Math.PI / 2 }),
]);

export function pianistGroundHeight(x, z) {
  const { stage, stairs } = PIANIST_PLAN;
  const stairMinX = stairs.centerX - stairs.width / 2;
  const stairMaxX = stairs.centerX + stairs.width / 2;
  const stairMaxZ = stairs.startZ + stairs.stepDepth * stairs.count;
  if (x >= stairMinX && x <= stairMaxX && z >= stairs.startZ && z < stairMaxZ) {
    const step = Math.min(stairs.count, Math.floor((z - stairs.startZ) / stairs.stepDepth) + 1);
    return step * stairs.stepHeight;
  }
  if (x >= stage.minX && x <= stage.maxX && z >= stage.minZ && z <= stage.maxZ) return stage.height;
  return 0;
}

export const AUDIENCE_COLLIDERS = Object.freeze([...AUDIENCE_CHAIRS, ...BETWEEN_PIANOS_CHAIRS].map(({ x, z }) => Object.freeze({
  minX: x - 0.34, maxX: x + 0.34, minY: 0, maxY: 1.25, minZ: z - 0.34, maxZ: z + 0.34,
})));

const stairMinX = PIANIST_PLAN.stairs.centerX - PIANIST_PLAN.stairs.width / 2;
const stairMaxX = PIANIST_PLAN.stairs.centerX + PIANIST_PLAN.stairs.width / 2;
export const STAGE_COLLIDERS = Object.freeze([
  ...[
    [PIANIST_PLAN.stage.minX, stairMinX],
    [stairMaxX, PIANIST_PLAN.stage.maxX],
  ].map(([minX, maxX]) => Object.freeze({ minX, maxX, minY: 0, maxY: PIANIST_PLAN.stage.height, minZ: PIANIST_PLAN.stage.minZ - 0.08, maxZ: PIANIST_PLAN.stage.minZ + 0.08 })),
  Object.freeze({ minX: PIANIST_PLAN.stage.minX - 0.08, maxX: PIANIST_PLAN.stage.minX + 0.08, minY: 0, maxY: PIANIST_PLAN.stage.height, minZ: PIANIST_PLAN.stage.minZ, maxZ: PIANIST_PLAN.stage.maxZ }),
  Object.freeze({ minX: PIANIST_PLAN.stage.maxX - 0.08, maxX: PIANIST_PLAN.stage.maxX + 0.08, minY: 0, maxY: PIANIST_PLAN.stage.height, minZ: PIANIST_PLAN.stage.minZ, maxZ: PIANIST_PLAN.stage.maxZ }),
]);

const collisionBox = (minX, maxX, minZ, maxZ, maxY) => Object.freeze({ minX, maxX, minY: 0, maxY, minZ, maxZ });
export const ROOM_COLLIDERS = Object.freeze([
  collisionBox(0, ROOM.width, 0, 0.2, ROOM.height),
  collisionBox(0, 0.2, 0, ROOM.depth, ROOM.height),
  collisionBox(ROOM.width - 0.2, ROOM.width, 0, ROOM.depth, ROOM.height),
  collisionBox(0, ROOM.width, ROOM.depth - 0.12, ROOM.depth, ROOM.height),
]);

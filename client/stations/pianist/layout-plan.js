export const ROOM = Object.freeze({ width: 20, depth: 15, height: 6 });

export const PIANIST_PLAN = Object.freeze({
  spawn: Object.freeze({ x: 10, z: 2.4 }),
  maestro: Object.freeze({ x: 6.2, z: 3.2 }),
  practicePiano: Object.freeze({ x: 10.8, z: 7.1 }),
  stagePiano: Object.freeze({ x: 10.8, z: 11.8 }),
  stage: Object.freeze({ minX: 6.3, maxX: 15.4, minZ: 11.1, maxZ: 14.4 }),
  practiceRadius: 2.5,
  stageRadius: 2.5,
});

const collisionBox = (minX, maxX, minZ, maxZ, maxY) => Object.freeze({ minX, maxX, minY: 0, maxY, minZ, maxZ });
export const ROOM_COLLIDERS = Object.freeze([
  collisionBox(0, ROOM.width, 0, 0.2, ROOM.height),
  collisionBox(0, 0.2, 0, ROOM.depth, ROOM.height),
  collisionBox(ROOM.width - 0.2, ROOM.width, 0, ROOM.depth, ROOM.height),
  collisionBox(0, ROOM.width, ROOM.depth - 0.12, ROOM.depth, ROOM.height),
]);

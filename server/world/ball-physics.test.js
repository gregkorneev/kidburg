import test from 'node:test';
import assert from 'node:assert/strict';
import { createBallWorld, ballPhase, boxFromBounds } from './ball-physics.js';
import { BALL, BALL_HOMES, FIELD } from '../../shared/interaction-contracts.js';

const DT = 1 / BALL.stepHz;
const run = (world, seconds, players = []) => {
  const events = [];
  for (let i = 0; i < seconds * BALL.stepHz; i++) events.push(...world.step(DT, players));
  return events;
};
const player = (id, x, z, ry = Math.PI / 2) => ({ id, x, z, ry }); // ry = π/2: смотрит в −X? forward = (−sin, −cos) = (−1, 0)

test('мячи стоят на старте, это покой', () => {
  const world = createBallWorld({ now: () => 0 });
  assert.equal(world.list().length, BALL_HOMES.length);
  for (const ball of world.list()) assert.equal(ballPhase(ball), 'resting');
  assert.equal(world.activeCount, 0);
});

test('удар даёт направление взгляда, подъём и скорость в пределах лимита', () => {
  const world = createBallWorld({ now: () => 1000 });
  const ball = world.get('ball-1');
  const event = world.kick('ball-1', player(7, ball.x + 1, ball.z, Math.PI / 2));
  assert.equal(event.kind, 'kick');
  assert.equal(event.by, 7);
  assert.ok(ball.vx < -BALL.kickSpeed * 0.9, 'летит в −X');
  assert.ok(Math.abs(ball.vz) < 1e-6);
  assert.equal(ball.vy, BALL.kickLift);
  assert.equal(ballPhase(ball), 'airborne');
  assert.ok(Math.hypot(ball.vx, ball.vy, ball.vz) <= BALL.maxSpeed);
});

test('гравитация, отскоки с потерей энергии и остановка без бесконечных прыжков', () => {
  const world = createBallWorld({ now: () => 0 });
  const ball = world.get('ball-1');
  world.kick('ball-1', player(1, ball.x, ball.z, Math.PI / 2));
  let maxY = 0;
  let bounces = 0;
  let prevVy = ball.vy;
  for (let i = 0; i < 20 * BALL.stepHz; i++) {
    world.step(DT);
    maxY = Math.max(maxY, ball.y);
    if (prevVy < 0 && ball.vy > 0) bounces += 1;
    prevVy = ball.vy;
    assert.ok(ball.y >= BALL.radius - 1e-9, 'не под землёй');
    assert.ok(Number.isFinite(ball.x + ball.y + ball.z + ball.vx + ball.vy + ball.vz));
  }
  assert.ok(maxY < 2.5, `высота ограничена: ${maxY}`);
  assert.ok(bounces >= 1 && bounces < 8, `отскоков: ${bounces}`);
  assert.equal(ball.resting, true, 'мяч остановился');
  assert.equal(ball.vx, 0);
});

test('трение: катящийся мяч замедляется монотонно', () => {
  const world = createBallWorld({ now: () => 0 });
  const ball = world.get('ball-2');
  ball.vx = -5;
  ball.resting = false;
  let last = Infinity;
  for (let i = 0; i < 40; i++) {
    world.step(DT);
    const speed = Math.hypot(ball.vx, ball.vz);
    assert.ok(speed <= last + 1e-9);
    last = speed;
  }
  assert.ok(last < 5);
});

test('препятствие: отскок с потерей энергии и без проникновения', () => {
  const wall = boxFromBounds({ minX: 440, maxX: 441, minZ: 360, maxZ: 400, height: 3 });
  const world = createBallWorld({ staticObstacles: { boxes: [wall], circles: [] }, now: () => 0 });
  const ball = world.get('ball-1');
  Object.assign(ball, { x: 444, z: 378, vx: -8, resting: false, y: BALL.radius });
  let reflected = false;
  for (let i = 0; i < 30; i++) {
    world.step(DT);
    assert.ok(ball.x >= 441 + BALL.radius - 1e-6, `не в стене: ${ball.x}`);
    if (ball.vx > 0) reflected = true;
  }
  assert.ok(reflected, 'мяч отскочил');
  assert.ok(ball.vx < 8 * BALL.restitutionWall + 0.5);
});

test('быстрый мяч не пролетает сквозь тонкую стенку', () => {
  const wall = boxFromBounds({ minX: 440, maxX: 440.1, minZ: 360, maxZ: 400, height: 3 });
  const world = createBallWorld({ staticObstacles: { boxes: [wall], circles: [] }, now: () => 0 });
  const ball = world.get('ball-1');
  Object.assign(ball, { x: 446, z: 378, vx: -BALL.maxSpeed, vy: 0, resting: false });
  run(world, 1);
  assert.ok(ball.x > 440, `за стеной: ${ball.x}`);
});

test('круглое препятствие (столб): мяч выше него пролетает', () => {
  const post = { x: 450, z: 376, r: 0.3, height: 1 };
  const world = createBallWorld({ staticObstacles: { boxes: [], circles: [post] }, now: () => 0 });
  const ball = world.get('ball-1');
  Object.assign(ball, { x: 453, z: 376, y: 2.5, vx: -4, vy: 0, resting: false });
  world.step(0.2);
  assert.ok(ball.vx < 0 && ball.x < 453, 'над столбом летит дальше');
});

test('два мяча сталкиваются и обмениваются импульсом', () => {
  const world = createBallWorld({ now: () => 0 });
  const a = world.get('ball-1');
  const b = world.get('ball-2');
  Object.assign(a, { x: 460, z: 378, vx: 4, vy: 0, resting: false });
  Object.assign(b, { x: 461, z: 378, vx: 0, vy: 0, resting: true });
  for (let i = 0; i < 10; i++) world.step(DT);
  assert.ok(b.vx > 1, 'второй мяч покатился');
  assert.ok(a.vx < b.vx);
});

test('мяч вне арены, остановившийся или улетевший, возвращается на старт; в игре — нет', () => {
  const world = createBallWorld({ now: () => 0 });
  const ball = world.get('ball-1');
  Object.assign(ball, { x: FIELD.x + FIELD.halfW + 5, z: FIELD.z, vx: 3, resting: false });
  run(world, 0.5);
  assert.notEqual(ball.x, ball.home.x, 'в арене мяч не возвращается');
  Object.assign(ball, { x: FIELD.x + FIELD.halfW + FIELD.arenaMargin + 3, z: FIELD.z, vx: 0.05, vy: 0, y: BALL.radius, resting: false });
  const events = run(world, 1);
  assert.ok(events.some((e) => e.kind === 'reset'));
  assert.deepEqual([ball.x, ball.z], [ball.home.x, ball.home.z]);
  Object.assign(ball, { x: 1, z: 1, resting: false, vx: 1 });
  assert.ok(world.step(DT).some((e) => e.kind === 'reset' && e.reason === 'out_of_world'));
  Object.assign(ball, { x: NaN, resting: false });
  assert.ok(world.step(DT).some((e) => e.reason === 'invalid'));
  assert.ok(Number.isFinite(ball.x));
});

test('ворота: стенка за линией останавливает мяч', () => {
  const world = createBallWorld({ now: () => 0 });
  const ball = world.get('ball-1');
  const goalX = FIELD.x - FIELD.halfW;
  Object.assign(ball, { x: goalX + 2, z: FIELD.z, vx: -9, vy: 0, resting: false });
  run(world, 1.5);
  assert.ok(ball.x > goalX - FIELD.goalDepth - 0.2, `мяч остался в рамке: ${ball.x}`);
});

test('касание движущимся игроком: один импульс на кулдаун', () => {
  let t = 0;
  const world = createBallWorld({ now: () => t });
  const ball = world.get('ball-1');
  const at = (x) => [{ id: 3, x, z: ball.z }];
  t = 0;
  world.step(DT, at(ball.x - 2));
  t = 200;
  world.step(DT, at(ball.x - 0.5));
  assert.ok(ball.vx > 0, 'мяч получил толчок');
  const v1 = ball.vx;
  t = 300;
  world.step(DT, at(ball.x - 0.45));
  assert.ok(ball.vx <= v1 + 1e-9, 'повторного импульса нет');
});

test('стоящий игрок мяч не толкает', () => {
  let t = 0;
  const world = createBallWorld({ now: () => t });
  const ball = world.get('ball-1');
  world.step(DT, [{ id: 3, x: ball.x - 0.4, z: ball.z }]);
  t = 300;
  world.step(DT, [{ id: 3, x: ball.x - 0.4, z: ball.z }]);
  assert.equal(ball.resting, true);
});

test('wire: покой и телепорт отмечаются флагами', () => {
  const world = createBallWorld({ now: () => 0 });
  const ball = world.get('ball-1');
  assert.deepEqual(world.wire(ball).slice(7), [1]);
  world.kick('ball-1', player(1, 0, 0));
  assert.equal(world.wire(ball)[7], 0);
  world.reset('ball-1');
  assert.equal(world.wire(ball)[7], 3);
});

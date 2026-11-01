// Серверная физика футбольных мячей. Чистый модуль без сети и базы: фиксированный шаг, гравитация, отскок от земли,
// качение с трением, столкновения с препятствиями (повёрнутые прямоугольники и круги), мяч о мяч, возврат на старт.
// Состояние мяча живёт только в памяти: после перезапуска сервера мячи стоят на стартовых точках.
import { BALL, BALL_HOMES, FIELD, goalGeometry, forwardOf } from '../../shared/interaction-contracts.js';

const R = BALL.radius;
const finite = (...values) => values.every((v) => Number.isFinite(v));

/** Состояние для клиента: resting — стоит, airborne — в воздухе, moving — катится. */
export function ballPhase(ball) {
  if (ball.resting) return 'resting';
  return ball.y > R + 0.03 || ball.vy > 0.3 ? 'airborne' : 'moving';
}

/**
 * Ближайшая к (x, z) точка повёрнутого прямоугольника и нормаль наружу.
 * Прямоугольник: центр (x, z), полуразмеры hx, hz; ry — поворот как у префабов (x' = x·cos + z·sin).
 */
function nearestOnBox(box, px, pz) {
  const cos = Math.cos(box.ry ?? 0);
  const sin = Math.sin(box.ry ?? 0);
  const dx = px - box.x;
  const dz = pz - box.z;
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;
  const cx = Math.max(-box.hx, Math.min(box.hx, lx));
  const cz = Math.max(-box.hz, Math.min(box.hz, lz));
  let nx = lx - cx;
  let nz = lz - cz;
  let dist = Math.hypot(nx, nz);
  if (dist < 1e-9) {
    // центр внутри: выталкиваем через ближайшую грань
    const gapX = box.hx - Math.abs(lx);
    const gapZ = box.hz - Math.abs(lz);
    if (gapX < gapZ) {
      nx = Math.sign(lx) || 1;
      nz = 0;
      dist = -gapX;
    } else {
      nx = 0;
      nz = Math.sign(lz) || 1;
      dist = -gapZ;
    }
  } else {
    nx /= dist;
    nz /= dist;
  }
  // обратно в мировые оси: x = lx·cos + lz·sin; z = −lx·sin + lz·cos
  return { dist, nx: nx * cos + nz * sin, nz: -nx * sin + nz * cos };
}

/** Прямоугольник из границ осей (без поворота). */
export const boxFromBounds = ({ minX, maxX, minZ, maxZ, height = 9 }) => ({
  x: (minX + maxX) / 2,
  z: (minZ + maxZ) / 2,
  hx: (maxX - minX) / 2,
  hz: (maxZ - minZ) / 2,
  ry: 0,
  height,
});

/**
 * @param {object} [options]
 * @param {() => {boxes: object[], circles: object[]}} [options.obstacles] препятствия, меняющиеся в игре
 *   (динамические объекты, предметы на земле); статичные передаются в staticObstacles.
 * @param {{boxes: object[], circles: object[]}} [options.staticObstacles]
 */
export function createBallWorld({
  homes = BALL_HOMES,
  field = FIELD,
  staticObstacles = { boxes: [], circles: [] },
  obstacles = () => ({ boxes: [], circles: [] }),
  now = Date.now,
} = {}) {
  const goals = goalGeometry(field);
  const fixedBoxes = [...staticObstacles.boxes, ...goals.walls.map(boxFromBounds)];
  const fixedCircles = [...staticObstacles.circles, ...goals.posts.map((p) => ({ ...p, height: field.goalHeight }))];
  const arena = {
    minX: field.x - field.halfW - field.arenaMargin,
    maxX: field.x + field.halfW + field.arenaMargin,
    minZ: field.z - field.halfD - field.arenaMargin,
    maxZ: field.z + field.halfD + field.arenaMargin,
  };
  const hard = {
    minX: field.x - field.halfW - field.hardMargin,
    maxX: field.x + field.halfW + field.hardMargin,
    minZ: field.z - field.halfD - field.hardMargin,
    maxZ: field.z + field.halfD + field.hardMargin,
  };

  let version = 0;
  /** @type {Map<string, object>} */
  const balls = new Map();
  for (const home of homes) {
    balls.set(home.id, { id: home.id, home, x: home.x, y: R, z: home.z, vx: 0, vy: 0, vz: 0, resting: true, version: 0, outsideSince: 0, lastKick: 0, touch: new Map(), lastBy: 0 });
  }
  /** Последние позиции игроков для оценки их скорости при касании. */
  const seen = new Map();
  const events = [];

  const bump = (ball) => {
    ball.version = ++version;
  };

  function resetBall(ball, reason = 'reset') {
    Object.assign(ball, { x: ball.home.x, y: R, z: ball.home.z, vx: 0, vy: 0, vz: 0, resting: true, outsideSince: 0 });
    ball.touch.clear();
    bump(ball);
    ball.teleportAt = ball.version;
    events.push({ id: ball.id, kind: 'reset', by: 0, x: ball.x, y: ball.y, z: ball.z, reason });
  }

  function collideBox(ball, box) {
    if (ball.y - R > box.height) return false; // мяч выше препятствия
    const { dist, nx, nz } = nearestOnBox(box, ball.x, ball.z);
    if (dist >= R) return false;
    return resolve(ball, nx, nz, R - dist);
  }

  function collideCircle(ball, c) {
    if (ball.y - R > (c.height ?? 9)) return false;
    const dx = ball.x - c.x;
    const dz = ball.z - c.z;
    const dist = Math.hypot(dx, dz);
    const need = R + c.r;
    if (dist >= need) return false;
    const nx = dist > 1e-9 ? dx / dist : 1;
    const nz = dist > 1e-9 ? dz / dist : 0;
    return resolve(ball, nx, nz, need - dist);
  }

  /** Выталкивает мяч по нормали и отражает скорость с потерей энергии. */
  function resolve(ball, nx, nz, depth) {
    ball.x += nx * depth;
    ball.z += nz * depth;
    const vn = ball.vx * nx + ball.vz * nz;
    if (vn < 0) {
      const tx = ball.vx - vn * nx;
      const tz = ball.vz - vn * nz;
      const e = -vn < 0.4 ? 0 : BALL.restitutionWall;
      ball.vx = tx * BALL.wallFriction - vn * e * nx;
      ball.vz = tz * BALL.wallFriction - vn * e * nz;
    }
    return true;
  }

  function integrate(ball, dt) {
    ball.vy -= BALL.gravity * dt;
    const air = Math.exp(-BALL.airDamping * dt);
    ball.vx *= air;
    ball.vz *= air;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.z += ball.vz * dt;

    if (ball.y <= R) {
      ball.y = R;
      if (ball.vy < -BALL.groundBounceMin) ball.vy = -ball.vy * BALL.restitutionGround;
      else ball.vy = 0;
    }
    if (ball.y <= R + 1e-4 && ball.vy === 0) {
      // качение: постоянное замедление плюс пропорциональное, пока скорость не упадёт до порога
      const speed = Math.hypot(ball.vx, ball.vz);
      if (speed > 0) {
        const next = Math.max(0, speed * Math.exp(-BALL.rollDamping * dt) - BALL.rollDecel * dt);
        const k = next / speed;
        ball.vx *= k;
        ball.vz *= k;
      }
    }
  }

  function limitSpeed(ball) {
    const speed = Math.hypot(ball.vx, ball.vy, ball.vz);
    if (speed > BALL.maxSpeed) {
      const k = BALL.maxSpeed / speed;
      ball.vx *= k;
      ball.vy *= k;
      ball.vz *= k;
    }
  }

  function stepBall(ball, dt, allBoxes, allCircles) {
    // Подшаги: за один шаг мяч не проходит больше ~0.8 радиуса, иначе тонкие стенки пропускаются.
    const speed = Math.hypot(ball.vx, ball.vy, ball.vz);
    const parts = Math.min(10, Math.max(1, Math.ceil((speed * dt) / (R * 0.8))));
    const h = dt / parts;
    for (let i = 0; i < parts; i++) {
      integrate(ball, h);
      for (const box of allBoxes) collideBox(ball, box);
      for (const c of allCircles) collideCircle(ball, c);
    }
    limitSpeed(ball);
    const horizontal = Math.hypot(ball.vx, ball.vz);
    if (ball.y <= R + 1e-4 && ball.vy === 0 && horizontal < BALL.restSpeed) {
      ball.vx = ball.vz = 0;
      ball.resting = true;
    }
  }

  function collideBalls(list) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy, dz);
        if (dist >= 2 * R || dist < 1e-9) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        const nz = dz / dist;
        const push = (2 * R - dist) / 2;
        a.x -= nx * push;
        a.y = Math.max(R, a.y - ny * push);
        a.z -= nz * push;
        b.x += nx * push;
        b.y = Math.max(R, b.y + ny * push);
        b.z += nz * push;
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny + (b.vz - a.vz) * nz;
        if (rel < 0) {
          const j2 = (-(1 + BALL.restitutionBall) * rel) / 2;
          a.vx -= j2 * nx;
          a.vy -= j2 * ny;
          a.vz -= j2 * nz;
          b.vx += j2 * nx;
          b.vy += j2 * ny;
          b.vz += j2 * nz;
        }
        for (const ball of [a, b]) {
          if (ball.resting && Math.hypot(ball.vx, ball.vz) > BALL.restSpeed) ball.resting = false;
        }
        bump(a);
        bump(b);
      }
    }
  }

  /** Слабый толчок от бегущего или идущего игрока; не чаще одного раза за contactCooldownMs на пару игрок–мяч. */
  function contactNudges(players, t) {
    for (const p of players) {
      const prev = seen.get(p.id);
      seen.set(p.id, { x: p.x, z: p.z, t });
      if (!prev || p.inside === false) continue;
      const dt = (t - prev.t) / 1000;
      if (dt <= 0.02 || dt > 1) continue;
      const vx = (p.x - prev.x) / dt;
      const vz = (p.z - prev.z) / dt;
      const pace = Math.hypot(vx, vz);
      if (pace < 0.8) continue;
      for (const ball of balls.values()) {
        if (ball.y > 0.8) continue;
        const dx = ball.x - p.x;
        const dz = ball.z - p.z;
        const dist = Math.hypot(dx, dz);
        if (dist > R + 0.5 || dist < 1e-6) continue;
        // игрок движется к мячу: проекция скорости на направление «игрок → мяч» положительна
        if ((vx * dx + vz * dz) / dist < pace * 0.35) continue;
        const last = ball.touch.get(p.id) ?? -Infinity;
        if (t - last < BALL.contactCooldownMs) continue;
        ball.touch.set(p.id, t);
        const speed = Math.min(BALL.contactSpeedMax, Math.max(BALL.contactSpeedMin, pace * 0.7));
        ball.vx = (dx / dist) * speed;
        ball.vz = (dz / dist) * speed;
        ball.resting = false;
        ball.lastBy = p.id;
        bump(ball);
      }
    }
    if (seen.size > 64) for (const [id, s] of seen) if (t - s.t > 5000) seen.delete(id);
  }

  function guardBounds(ball, t) {
    if (!finite(ball.x, ball.y, ball.z, ball.vx, ball.vy, ball.vz)) return resetBall(ball, 'invalid');
    if (ball.y < -2 || ball.x < hard.minX || ball.x > hard.maxX || ball.z < hard.minZ || ball.z > hard.maxZ) return resetBall(ball, 'out_of_world');
    const inside = ball.x >= arena.minX && ball.x <= arena.maxX && ball.z >= arena.minZ && ball.z <= arena.maxZ;
    if (inside) ball.outsideSince = 0;
    else if (!ball.outsideSince) ball.outsideSince = t;
    // За пределами арены мяч дозволено докатить до остановки; остановился или завис — возвращаем.
    if (!inside && (ball.resting || t - ball.outsideSince > 6000)) resetBall(ball, 'left_arena');
  }

  return {
    homes,
    get version() {
      return version;
    },
    get(id) {
      return balls.get(id) ?? null;
    },
    list: () => [...balls.values()],
    get activeCount() {
      let n = 0;
      for (const b of balls.values()) if (!b.resting) n += 1;
      return n;
    },
    /**
     * Один физический шаг dt секунд.
     * @param {{id: number, x: number, z: number}[]} [players] подключённые игроки (для лёгких касаний)
     */
    step(dt, players = []) {
      const t = now();
      if (players.length) contactNudges(players, t);
      const dyn = obstacles();
      const allBoxes = dyn.boxes.length ? [...fixedBoxes, ...dyn.boxes] : fixedBoxes;
      const allCircles = dyn.circles.length ? [...fixedCircles, ...dyn.circles] : fixedCircles;
      const moving = [];
      for (const ball of balls.values()) {
        if (ball.resting) continue;
        stepBall(ball, dt, allBoxes, allCircles);
        moving.push(ball);
      }
      if (moving.length) {
        const all = [...balls.values()];
        collideBalls(all);
        for (const ball of moving) {
          bump(ball);
          guardBounds(ball, t);
        }
      }
      return events.splice(0);
    },
    /**
     * Удар игрока. Проверяет только физику; допуск (дальность, частоту) проверяет вызывающий.
     * Направление берётся из серверного yaw игрока, сила фиксирована.
     */
    kick(id, player) {
      const ball = balls.get(id);
      if (!ball) return null;
      const dir = forwardOf(player.ry);
      ball.vx = ball.vx * BALL.kickKeep + dir.x * BALL.kickSpeed;
      ball.vz = ball.vz * BALL.kickKeep + dir.z * BALL.kickSpeed;
      ball.vy = BALL.kickLift;
      ball.resting = false;
      ball.lastBy = player.id;
      ball.lastKick = now();
      limitSpeed(ball);
      bump(ball);
      const event = { id, kind: 'kick', by: player.id, x: ball.x, y: ball.y, z: ball.z };
      events.push(event);
      return event;
    },
    reset(id) {
      const ball = balls.get(id);
      if (ball) resetBall(ball, 'manual');
    },
    resetAll() {
      for (const ball of balls.values()) resetBall(ball, 'manual');
    },
    /** Снимок в формате протокола: [id, x, y, z, vx, vy, vz, flags]. */
    wire(ball) {
      const r = (v) => Math.round(v * 1000) / 1000;
      return [ball.id, r(ball.x), r(ball.y), r(ball.z), r(ball.vx), r(ball.vy), r(ball.vz), (ball.resting ? 1 : 0) | (ball.teleportAt === ball.version ? 2 : 0)];
    },
    describe: (ball) => ({ id: ball.id, phase: ballPhase(ball), x: ball.x, y: ball.y, z: ball.z, speed: Math.hypot(ball.vx, ball.vy, ball.vz), lastBy: ball.lastBy }),
    arena,
    hard,
  };
}

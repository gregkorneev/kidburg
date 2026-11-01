// Контракт интерактивного мира: футбольные мячи (серверная физика) и переносимые уличные предметы.
// Источник правды для сервера, клиента и тестов. Координаты — мировые метры; ось Y — вверх, земля в городе плоская (y = 0).
// Игрок в городе при yaw = ry смотрит в (−sin ry, −cos ry) — так же считает клиент (player.js).

/** Действия, которые игрок может запросить сообщением `interact`. */
export const INTERACT_ACTIONS = Object.freeze(['take', 'place', 'drop', 'kick']);
export const isInteractAction = (v) => typeof v === 'string' && INTERACT_ACTIONS.includes(v);

/** Коды отказов interact_result.code. */
export const INTERACT_CODES = Object.freeze({
  OK: 'ok',
  UNKNOWN: 'unknown',
  TOO_FAR: 'too_far',
  BUSY: 'busy', // предмет уже у другого игрока
  HANDS_FULL: 'hands_full',
  NOT_HOLDING: 'not_holding',
  BLOCKED: 'blocked', // в выбранной точке ставить нельзя
  RATE_LIMIT: 'rate_limit',
  COOLDOWN: 'cooldown',
});

export const INTERACT_LIMITS = Object.freeze({
  PER_SEC: 8, // interact на игрока
  KICK_COOLDOWN_MS: 380,
  TAKE_REACH: 2.6, // м до предмета на клиенте при выборе цели
  KICK_REACH: 2.2, // м до центра мяча на клиенте
  /** Запас сервера: позиция игрока на сервере отстаёт на кадр-другой, а предмет мог чуть сместиться. */
  REACH_MARGIN: 1.2,
  PLACE_DISTANCE: 1.25, // м перед игроком, куда ставится предмет
  MAX_ID_CHARS: 32,
});

// ── Футбол ────────────────────────────────────────────────────────────────

/** Поле на северо-востоке от площади: свободная площадка без деревьев, зданий и дорожек. */
export const FIELD = Object.freeze({
  x: 458,
  z: 378,
  halfW: 15, // вдоль оси X: ворота на торцах
  halfD: 10,
  goalWidth: 5,
  goalDepth: 1.7,
  goalHeight: 2.2,
  postRadius: 0.07,
  /** Мяч, ушедший дальше этого отступа от поля и остановившийся, возвращается на старт. */
  arenaMargin: 16,
  /** Дальше этого мяч возвращается сразу (улетел за пределы допустимой территории). */
  hardMargin: 60,
});

export const BALL = Object.freeze({
  radius: 0.26,
  gravity: 9.81,
  restitutionGround: 0.58, // доля вертикальной скорости после отскока от земли
  restitutionWall: 0.52, // доля нормальной скорости после удара о препятствие
  restitutionBall: 0.85,
  wallFriction: 0.92, // доля касательной скорости после удара о препятствие
  rollDecel: 0.9, // м/с²: постоянное замедление качения
  rollDamping: 0.5, // 1/с: пропорциональное замедление
  airDamping: 0.06, // 1/с
  groundBounceMin: 0.9, // м/с: слабее — мяч не подпрыгивает, а катится
  restSpeed: 0.12, // м/с: медленнее и на земле — мяч останавливается
  maxSpeed: 20,
  kickSpeed: 9.5,
  kickLift: 3.1,
  kickKeep: 0.25, // доля прежней скорости мяча, сохраняемая при ударе
  contactSpeedMin: 1.4,
  contactSpeedMax: 4.5,
  contactCooldownMs: 450,
  stepHz: 30,
  snapshotHz: 10,
});

/** Старт мячей (они же точки возврата). */
export const BALL_HOMES = Object.freeze([
  Object.freeze({ id: 'ball-1', x: 454, z: 376 }),
  Object.freeze({ id: 'ball-2', x: 461, z: 381 }),
  Object.freeze({ id: 'ball-3', x: 458, z: 372.5 }),
]);
export const BALL_IDS = Object.freeze(BALL_HOMES.map((b) => b.id));
export const isBallId = (id) => BALL_IDS.includes(id);

/** Опоры ворот (круги) и задние/боковые стенки (прямоугольники) — единые для сервера и отрисовки. */
export function goalGeometry(field = FIELD) {
  const posts = [];
  const walls = [];
  for (const side of [-1, 1]) {
    const lineX = field.x + side * field.halfW;
    const half = field.goalWidth / 2;
    for (const dz of [-half, half]) posts.push({ x: lineX, z: field.z + dz, r: field.postRadius });
    const backX = lineX + side * field.goalDepth;
    walls.push({ minX: Math.min(backX, backX + side * 0.05), maxX: Math.max(backX, backX + side * 0.05), minZ: field.z - half, maxZ: field.z + half, height: field.goalHeight });
    for (const dz of [-half, half]) {
      walls.push({ minX: Math.min(lineX, backX), maxX: Math.max(lineX, backX), minZ: field.z + dz - 0.03, maxZ: field.z + dz + 0.03, height: field.goalHeight });
    }
  }
  return { posts, walls };
}

// ── Переносимые предметы ──────────────────────────────────────────────────

/**
 * radius — радиус основания (м), для проверки места постановки; carry — смещение в руках относительно
 * корня персонажа (локальные метры при масштабе 1: x вправо, y вверх, z вперёд).
 */
export const PROP_TYPES = Object.freeze({
  crate: Object.freeze({ label: 'ящик', radius: 0.5, height: 0.6, carry: Object.freeze({ x: 0, y: 1.0, z: 0.55 }) }),
  cone: Object.freeze({ label: 'конус', radius: 0.3, height: 0.55, carry: Object.freeze({ x: 0, y: 0.95, z: 0.45 }) }),
  pot: Object.freeze({ label: 'горшок', radius: 0.32, height: 0.55, carry: Object.freeze({ x: 0, y: 0.95, z: 0.45 }) }),
});
export const isPropType = (t) => typeof t === 'string' && Object.hasOwn(PROP_TYPES, t);

/** Начальная расстановка. Проверяется тестом по тем же правилам, что и постановка игроком. */
export const PROP_HOMES = Object.freeze([
  // у пожарной части и технической площадки
  Object.freeze({ id: 'crate-1', type: 'crate', x: 372, z: 427, ry: 0.4 }),
  Object.freeze({ id: 'crate-2', type: 'crate', x: 373.6, z: 428.4, ry: -0.2 }),
  Object.freeze({ id: 'cone-1', type: 'cone', x: 392, z: 394, ry: 0 }),
  Object.freeze({ id: 'cone-2', type: 'cone', x: 395, z: 393, ry: 0 }),
  // на свободной части площади
  Object.freeze({ id: 'crate-3', type: 'crate', x: 398, z: 430, ry: 0.7 }),
  Object.freeze({ id: 'cone-3', type: 'cone', x: 436, z: 398, ry: 0 }),
  // у поля
  Object.freeze({ id: 'crate-4', type: 'crate', x: 441, z: 388, ry: 0.2 }),
  Object.freeze({ id: 'cone-4', type: 'cone', x: 475, z: 366, ry: 0 }),
  // у цветочной лавки
  Object.freeze({ id: 'pot-1', type: 'pot', x: 372, z: 454, ry: 0 }),
  Object.freeze({ id: 'pot-2', type: 'pot', x: 374.5, z: 441, ry: 0 }),
  Object.freeze({ id: 'pot-3', type: 'pot', x: 393, z: 462, ry: 0 }),
]);
export const PROP_IDS = Object.freeze(PROP_HOMES.map((p) => p.id));

export const PROP_STATES = Object.freeze(['available', 'held', 'placed']);

export const forwardOf = (ry) => ({ x: -Math.sin(ry), z: -Math.cos(ry) });

import { PLAZA } from '../../tools/build-world/layout.js';
import { PLAZA_RADIUS, FOUNTAIN, occupiedCircles, distanceToBuildings } from './plaza-plan.js';

export const FLEE_DISTANCE = 3;
export const CALM_DISTANCE = 5;
export const ANIMAL_SPECS = Object.freeze([
  { type: 'cat', color: 0xd88b42, angle: 0.2, walk: 1.05, flee: 2.35 },
  { type: 'cat', color: 0x858b91, angle: 1.8, walk: 1.05, flee: 2.35 },
  { type: 'dog', color: 0x98613c, angle: 3.3, walk: 0.85, flee: 2.1 },
  { type: 'dog', color: 0xd9c39b, angle: 4.9, walk: 0.85, flee: 2.1 },
]);
const PAD = 0.45;
const obstacles = occupiedCircles().map(([x, z, radius, kind]) =>
  [x, z, kind === 'planter' ? Math.hypot(1.5, 0.45) : radius]);
export function animalPointClear(x, z) {
  const r = Math.hypot(x, z);
  return r >= FOUNTAIN.wall[1] + PAD && r <= PLAZA_RADIUS - PAD && distanceToBuildings(x, z) >= PAD &&
    obstacles.every(([ox, oz, radius]) => Math.hypot(x - ox, z - oz) >= radius + PAD);
}

export class AnimalNpc {
  constructor(spec, random = Math.random) {
    this.type = spec.type; this.walkSpeed = spec.walk; this.fleeSpeed = spec.flee;
    this.random = random; this.mode = 'wander'; this.direction = spec.angle;
    this.x = Math.cos(spec.angle) * 6; this.z = Math.sin(spec.angle) * 6;
    this.target = null; this.timer = 0; this.pause = 0; this.speed = 0;
  }
  update(dt, player) {
    dt = Math.max(0, Math.min(0.05, dt));
    const px = player ? player.x - PLAZA.x : Infinity;
    const pz = player ? player.z - PLAZA.z : Infinity;
    const distance = Math.hypot(this.x - px, this.z - pz);
    if (this.mode === 'wander' && distance < FLEE_DISTANCE) { this.mode = 'flee'; this.target = null; this.pause = 0; }
    else if (this.mode === 'flee' && distance > CALM_DISTANCE) { this.mode = 'wander'; this.target = null; this.timer = 0; }
    this.timer -= dt;
    if (this.mode === 'flee') {
      // Выбираем только шаги, увеличивающие расстояние; у стены возможна остановка.
      const away = distance > 0.0001 ? Math.atan2(this.z - pz, this.x - px) : this.direction;
      let best = null;
      for (const offset of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4]) {
        const angle = away + offset, step = this.fleeSpeed * dt;
        const x = this.x + Math.cos(angle) * step, z = this.z + Math.sin(angle) * step;
        if (animalPointClear(x, z) && Math.hypot(x - px, z - pz) > distance + 1e-8) { best = { x, z }; break; }
      }
      this.target = best;
    } else if (this.pause > 0) {
      this.pause -= dt; this.speed = 0; return;
    } else if (!this.target || this.timer <= 0 || Math.hypot(this.target.x - this.x, this.target.z - this.z) < 0.12) {
      if (this.target && this.timer > 0) { this.target = null; this.pause = 0.3 + this.random(); this.speed = 0; return; }
      this.target = null;
      for (let i = 0; i < 30; i++) {
        const a = this.random() * Math.PI * 2, r = 1 + this.random() * 4;
        const p = { x: this.x + Math.cos(a) * r, z: this.z + Math.sin(a) * r };
        if (animalPointClear(p.x, p.z)) { this.target = p; break; }
      }
      this.timer = 2 + this.random() * 3;
    }
    if (!this.target) { this.speed = 0; return; }
    const dx = this.target.x - this.x, dz = this.target.z - this.z, length = Math.hypot(dx, dz);
    const step = Math.min(length, (this.mode === 'flee' ? this.fleeSpeed : this.walkSpeed) * dt);
    if (!length || !step) { this.speed = 0; return; }
    const x = this.x + dx / length * step, z = this.z + dz / length * step;
    if (!animalPointClear(x, z)) { this.target = null; this.timer = 0; this.speed = 0; return; }
    this.x = x; this.z = z; this.speed = step / dt;
    const angle = Math.atan2(dx, dz);
    const delta = ((angle - this.direction + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.direction += delta * Math.min(1, dt * 7);
  }
}


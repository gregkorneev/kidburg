import { PLAZA } from '../../tools/build-world/layout.js';
import { BENCHES } from './plaza-plan.js';
import { HIP_Y } from './art/character-geometry.js';
import { CITY_CHARACTER_SCALE, animateCharacter, createCharacter, disposeCharacter, triggerGesture, yawToward } from './art/character.js';

export const WAVE_TRIGGER_DISTANCE = 4;
export const RESET_DISTANCE = 6;
const WAVE_DURATION = 2.4;
// Разные сектора внешнего кольца; значения остаются привязаны к плану площади.
export const SEATED_BENCHES = Object.freeze([BENCHES[0], BENCHES.find((bench) => bench.sector === 3)]);
const LOOKS = [
  { seed: 18, hairStyle: 'ponytail', hair: '#ad6a32', outfit: '#d97680', top: 'sweater', accessory: 'none' },
  { seed: 43, hairStyle: 'bob', hair: '#493330', outfit: '#548f9a', top: 'jacket', accessory: 'none' },
];

export class SeatedNpc {
  constructor(bench) {
    this.bench = bench;
    this.x = PLAZA.x + bench.x;
    this.z = PLAZA.z + bench.z;
    this.state = 'idle';
    this.nearby = false;
    this.distance = Infinity;
    this.waveTime = 0;
    this.waveCount = 0;
  }
  update(dt, player) {
    this.distance = player ? Math.hypot(player.x - this.x, player.z - this.z) : Infinity;
    if (!this.nearby && this.distance < WAVE_TRIGGER_DISTANCE) {
      this.nearby = true;
      this.state = 'wave';
      this.waveTime = 0;
      this.waveCount++;
      return true;
    }
    if (this.nearby && this.distance > RESET_DISTANCE) {
      this.nearby = false;
      this.state = 'idle';
      this.waveTime = 0;
    } else if (this.state === 'wave') {
      this.waveTime += Math.max(0, Math.min(dt, 0.25));
      if (this.waveTime >= WAVE_DURATION) this.state = 'idle';
    }
    return false;
  }
}

function setSeatedPose(person) {
  // Применяем после общей idle-анимации, которая обычно выпрямляет ноги.
  for (const leg of person.userData.legs) {
    leg.pivot.rotation.x = -Math.PI / 2;
    leg.knee.rotation.x = Math.PI / 2;
    leg.foot.rotation.x = 0;
  }
}

export function createPlazaSeatedNpcs({ scene, quality }) {
  const npcs = SEATED_BENCHES.map((bench, i) => {
    const npc = new SeatedNpc(bench);
    const person = createCharacter({ appearance: LOOKS[i], quality });
    person.scale.setScalar(CITY_CHARACTER_SCALE);
    // Сиденье prefab-kit: верх на 0.55 м; таз слегка выше доски.
    person.position.set(npc.x, 0.65 - HIP_Y * CITY_CHARACTER_SCALE, npc.z);
    person.rotation.y = bench.rotY;
    setSeatedPose(person);
    scene.add(person);
    return { npc, person };
  });
  return {
    npcs,
    update(dt, player, time) {
      for (const { npc, person } of npcs) {
        const wasNearby = npc.nearby;
        if (npc.update(dt, player)) triggerGesture(person, 'wave');
        if (wasNearby && !npc.nearby && person.userData.anim.gesture === 'wave') person.userData.anim.gesture = null;
        const lookYaw = npc.nearby && player ? yawToward(person, player.x, player.z) : 0;
        animateCharacter(person, dt, time, { speed: 0, lookYaw });
        setSeatedPose(person);
      }
    },
    dispose() {
      for (const { person } of npcs) { scene.remove(person); disposeCharacter(person); }
    },
  };
}

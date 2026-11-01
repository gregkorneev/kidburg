import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  ACCESSORIES, ARM_LENGTH, BUILDS, COSTUME_IDS, EXPRESSIONS, FACE_SHAPES, GESTURES, HAIR_STYLES, SHOE_STYLES, TOP_STYLES,
  animateCharacter, appearanceFromSeed, createCharacter, disposeCharacter, getExpression, reactToEvent, resetArms, setArmReach, setCarry,
  setCharacterQuality, setExpression, setPersonCostume, setPersonEquipment, triggerGesture,
} from './character.js';
import { ANKLE_Y, headGeometry, limbGeometry, torsoGeometry } from './character-geometry.js';
import { isSharedResource } from './materials.js';

const stats = (root) => {
  let meshes = 0;
  let triangles = 0;
  root.traverse((node) => {
    if (!node.isMesh || !node.visible) return;
    let hidden = false;
    for (let p = node.parent; p; p = p.parent) if (!p.visible) hidden = true;
    if (hidden) return;
    meshes++;
    triangles += (node.geometry.index ? node.geometry.index.count : node.geometry.attributes.position.count) / 3;
  });
  return { meshes, triangles };
};

const finiteTree = (root) => {
  let ok = true;
  root.traverse((node) => {
    for (const v of [...node.position.toArray(), ...node.rotation.toArray().slice(0, 3), ...node.scale.toArray()]) if (!Number.isFinite(v)) ok = false;
  });
  return ok;
};

test('внешность: детерминирована, различается и использует все основные варианты', () => {
  assert.deepEqual(appearanceFromSeed(77), appearanceFromSeed(77));
  assert.notDeepEqual(appearanceFromSeed(77), appearanceFromSeed(78));
  const looks = Array.from({ length: 400 }, (_, i) => appearanceFromSeed(i));
  const seen = (key) => new Set(looks.map((look) => look[key]));
  assert.ok(seen('hairStyle').size >= 10, `причёсок ${seen('hairStyle').size}`);
  assert.ok(HAIR_STYLES.length >= 12);
  assert.equal(seen('build').size, BUILDS.length);
  assert.equal(seen('faceShape').size, FACE_SHAPES.length);
  assert.equal(seen('top').size, TOP_STYLES.length);
  assert.ok(seen('accessory').size >= ACCESSORIES.length - 1);
  assert.ok(seen('shoes').size >= 2);
  const accessorized = looks.filter((look) => look.accessory !== 'none').length / looks.length;
  assert.ok(accessorized > 0.2 && accessorized < 0.6, `аксессуары не у всех: ${accessorized}`);
  for (const look of looks) {
    assert.ok(HAIR_STYLES.includes(look.hairStyle) && look.hairStyle !== 'ponytail');
    assert.ok(SHOE_STYLES.includes(look.shoes));
  }
  assert.equal(appearanceFromSeed(9, 0x336699).outfit, '#336699');
  assert.equal(appearanceFromSeed(9, 0x336699).top, appearanceFromSeed(9).top, 'цвет сервера не меняет остальную внешность');
});

test('внешность не зависит от Math.random и порядка вызовов', () => {
  const original = Math.random;
  Math.random = () => { throw new Error('Math.random в appearanceFromSeed запрещён'); };
  try {
    const a = appearanceFromSeed(31);
    appearanceFromSeed(5);
    assert.deepEqual(appearanceFromSeed(31), a);
  } finally {
    Math.random = original;
  }
});

test('геометрия тела: без NaN, нормали наружу, разные комплекции и формы лица различимы', () => {
  const outward = (geometry) => {
    const p = geometry.attributes.position;
    const n = geometry.attributes.normal;
    let bad = 0;
    for (let i = 0; i < p.count; i++) if (p.getX(i) * n.getX(i) + p.getZ(i) * n.getZ(i) < -0.01) bad++;
    return bad;
  };
  for (const kind of ['upperArm', 'forearm', 'sleeveShort', 'thigh', 'shin']) assert.equal(outward(limbGeometry(kind, 1)), 0, kind);
  for (const build of BUILDS) assert.equal(outward(torsoGeometry(build, 1)), 0, build);
  const widths = BUILDS.map((build) => { const g = torsoGeometry(build, 1); g.computeBoundingBox(); return g.boundingBox.max.x; });
  assert.ok(new Set(widths.map((w) => w.toFixed(3))).size === BUILDS.length, 'комплекции различаются');
  const heads = FACE_SHAPES.map((shape) => headGeometry(shape, 1));
  for (const head of heads) assert.ok(head.attributes.position.array.every(Number.isFinite));
  assert.notDeepEqual(Array.from(heads[0].attributes.position.array.slice(0, 60)), Array.from(heads[1].attributes.position.array.slice(0, 60)));
});

test('создание и освобождение: общие геометрии и материалы не освобождаются, свои — освобождаются', () => {
  const people = Array.from({ length: 12 }, (_, i) => createCharacter({ appearance: appearanceFromSeed(i * 13), holding: i % 4 === 0 ? 'clipboard' : null }));
  let disposedShared = 0;
  const watched = new Set();
  for (const person of people) {
    setPersonEquipment(person, true);
    person.traverse((node) => {
      if (node.geometry && isSharedResource(node.geometry) && !watched.has(node.geometry)) {
        watched.add(node.geometry);
        node.geometry.addEventListener('dispose', () => { disposedShared++; });
      }
    });
  }
  assert.ok(watched.size > 20);
  people.forEach(disposeCharacter);
  disposeCharacter(people[0]); // повторное освобождение безопасно
  assert.equal(disposedShared, 0, 'общая геометрия не освобождена');
  const again = createCharacter({ appearance: appearanceFromSeed(1) });
  assert.ok(stats(again).meshes > 10, 'после освобождения новые персонажи строятся');
});

test('экипировка и костюмы: любые переключения без ошибок, пожарная форма важнее костюма, каска прячет макушку', () => {
  const person = createCharacter({ appearance: appearanceFromSeed(4) });
  const casualTorso = person.userData.torso.material;
  assert.equal(person.userData.fireBuilt, undefined, 'пожарный комплект строится лениво');
  for (const id of COSTUME_IDS) {
    assert.equal(setPersonCostume(person, id), true);
    assert.ok(finiteTree(person));
    setPersonEquipment(person, true);
    assert.equal(person.userData.uniform.visible, true);
    assert.equal(person.userData.helmet.visible, true);
    assert.equal(person.userData.hair.visible, false, 'макушка прячется под каску');
    setPersonEquipment(person, false);
    assert.equal(person.userData.helmet.visible, false);
    assert.equal(person.userData.uniform.visible, false);
  }
  assert.equal(setPersonCostume(person, 'нет-такого'), false);
  setPersonCostume(person, null);
  assert.equal(person.userData.torso.material, casualTorso, 'повседневная одежда возвращается');
  assert.ok(person.userData.arms.every(({ hand, bareHand }) => !hand?.visible && bareHand.visible));
  setPersonCostume(person, 'baker');
  setPersonEquipment(person, true);
  assert.ok(Object.values(person.userData.costumes).every((c) => !c.spineGroup.visible), 'костюм скрыт под пожарной формой');
  setPersonEquipment(person, false);
  assert.ok(person.userData.costumes.baker.spineGroup.visible, 'костюм вернулся после снятия формы');
  assert.equal(person.userData.hair.visible, false, 'колпак пекаря прячет макушку');
});

test('эмоции: все семь достижимы, переход плавный, затем возврат к нейтральному', () => {
  const person = createCharacter({ appearance: appearanceFromSeed(8) });
  assert.deepEqual([...EXPRESSIONS], ['neutral', 'happy', 'surprised', 'thinking', 'sad', 'focused', 'confused']);
  assert.equal(setExpression(person, 'нет'), false);
  const face = person.userData.face;
  const snapshots = {};
  for (const name of EXPRESSIONS) {
    assert.equal(setExpression(person, name), true);
    assert.equal(getExpression(person), name);
    const from = face.cur.mouthCurve;
    let previous = from;
    let maxStep = 0;
    for (let i = 0; i < 90; i++) {
      animateCharacter(person, 1 / 60, i / 60, {});
      maxStep = Math.max(maxStep, Math.abs(face.cur.mouthCurve - previous));
      previous = face.cur.mouthCurve;
    }
    const total = Math.abs(previous - from);
    assert.ok(maxStep <= Math.max(0.05, total * 0.5), `${name}: резкий скачок ${maxStep} при изменении ${total}`);
    snapshots[name] = { ...face.cur };
  }
  assert.ok(snapshots.happy.mouthCurve > snapshots.neutral.mouthCurve);
  assert.ok(snapshots.sad.mouthCurve < 0 && snapshots.sad.browTilt > 0.3);
  assert.ok(snapshots.surprised.mouthOpen > 0.6 && snapshots.surprised.browY > snapshots.neutral.browY);
  assert.ok(snapshots.focused.browTilt < 0, 'сосредоточенность — брови вниз к носу');
  assert.ok(snapshots.thinking.headTilt !== 0 && snapshots.confused.browAsym > 0);
  setExpression(person, 'happy', { duration: 0.5 });
  for (let i = 0; i < 60; i++) animateCharacter(person, 1 / 60, i / 60, {});
  assert.equal(getExpression(person), 'neutral', 'временная эмоция возвращается');
});

test('жесты, речь и поворот: все переходы конечны, жест заканчивается, рот двигается при речи', () => {
  const person = createCharacter({ appearance: appearanceFromSeed(2), holding: 'clipboard' });
  for (const kind of GESTURES) {
    assert.equal(triggerGesture(person, kind), true);
    assert.equal(person.userData.anim.gesture, kind);
    for (let i = 0; i < 60 * 3; i++) animateCharacter(person, 1 / 60, i / 60, { speed: i % 90 < 45 ? 0 : 1, talking: i % 50 < 25, lookYaw: Math.sin(i / 20) * 2 });
    assert.equal(person.userData.anim.gesture, null, `${kind} закончился`);
    assert.ok(finiteTree(person), kind);
  }
  assert.equal(triggerGesture(person, 'нет-такого'), false);
  const opens = new Set();
  for (let i = 0; i < 120; i++) { animateCharacter(person, 1 / 60, i / 60, { talking: true }); opens.add(person.userData.face.open.scale.y.toFixed(3)); }
  assert.ok(opens.size > 20, 'при разговоре рот открывается по-разному');
  const yaw = Math.abs(person.userData.head.rotation.y);
  for (let i = 0; i < 120; i++) animateCharacter(person, 1 / 60, 3 + i / 60, { lookYaw: 0.8 });
  assert.ok(person.userData.head.rotation.y > yaw && person.userData.head.rotation.y <= 0.95, 'голова следует за взглядом в пределах');
  person.rotation.y = 0;
  animateCharacter(person, 1 / 60, 0, { speed: 1 });
  for (let i = 0; i < 20; i++) { person.rotation.y += 0.1; animateCharacter(person, 1 / 60, i / 60, { speed: 1 }); }
  assert.ok(Math.abs(person.userData.lean.rotation.z) > 0.001, 'поворот на ходу даёт крен корпуса');
});

test('ходьба и бег: бег отличается от ходьбы, стопы не уходят под землю, переход плавный', () => {
  const person = createCharacter({ appearance: appearanceFromSeed(6) });
  const sample = (speed, frames) => {
    let maxLeg = 0;
    let maxKnee = 0;
    let lean = 0;
    let minAnkle = Infinity;
    for (let i = 0; i < frames; i++) {
      animateCharacter(person, 1 / 60, i / 60, { speed });
      person.updateMatrixWorld(true);
      maxLeg = Math.max(maxLeg, ...person.userData.legs.map((l) => Math.abs(l.pivot.rotation.x)));
      maxKnee = Math.max(maxKnee, ...person.userData.legs.map((l) => l.knee.rotation.x));
      lean = Math.max(lean, person.userData.lean.rotation.x);
      for (const leg of person.userData.legs) minAnkle = Math.min(minAnkle, leg.foot.getWorldPosition(new THREE.Vector3()).y);
    }
    return { maxLeg, maxKnee, lean, minAnkle };
  };
  const walk = sample(1, 120);
  const run = sample(2, 120);
  assert.ok(run.maxLeg > walk.maxLeg && run.maxKnee > walk.maxKnee && run.lean > walk.lean, 'бег активнее и круче наклонён');
  assert.ok(walk.maxKnee > 0.3, 'колени сгибаются на ходу');
  assert.ok(walk.minAnkle > ANKLE_Y - 0.03 && run.minAnkle > ANKLE_Y - 0.03, `стопа ниже земли: ${walk.minAnkle}, ${run.minAnkle}`);
  const stepsOf = (speeds) => {
    let previous = person.userData.legs[0].pivot.rotation.x;
    let maxStep = 0;
    speeds.forEach((speed, i) => {
      animateCharacter(person, 1 / 60, 10 + i / 60, { speed });
      maxStep = Math.max(maxStep, Math.abs(person.userData.legs[0].pivot.rotation.x - previous));
      previous = person.userData.legs[0].pivot.rotation.x;
    });
    return maxStep;
  };
  const steady = stepsOf(Array(120).fill(2)); // естественная скорость маха ногой на бегу
  for (let i = 0; i < 90; i++) animateCharacter(person, 1 / 60, 20 + i / 60, { speed: 0 });
  const start = stepsOf(Array(90).fill(2));
  assert.ok(start <= steady * 1.15, `рывок ног при старте: ${start} против ${steady}`);
});

test('руки: рукав (armsLocked, setArmReach) не ломается общими анимациями, поза переноса возвращается', () => {
  const person = createCharacter({ appearance: appearanceFromSeed(3) });
  setPersonEquipment(person, true);
  person.userData.armsLocked = true;
  const target = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0.3, -0.2, 0.9).normalize());
  person.userData.arms.forEach((arm) => { arm.shoulder.quaternion.copy(target); setArmReach(arm, 1.25); });
  for (let i = 0; i < 120; i++) animateCharacter(person, 1 / 60, i / 60, { speed: 2, talking: true });
  triggerGesture(person, 'wave');
  for (let i = 0; i < 30; i++) animateCharacter(person, 1 / 60, i / 60, {});
  assert.equal(person.userData.anim.gesture, 'wave');
  for (const arm of person.userData.arms) {
    assert.ok(arm.shoulder.quaternion.angleTo(target) < 1e-6, 'направление хвата не тронуто');
    assert.equal(arm.elbow.rotation.x, 0, 'прямая рука при хвате');
    assert.equal(arm.sleeve.position.y, -(1.25 / 2) * arm.cover * 0.5, 'длина рукава сохраняется');
    assert.ok(arm.hand.visible && arm.stripe.visible, 'перчатки и полосы на месте');
  }
  for (let i = 0; i < 240; i++) animateCharacter(person, 1 / 60, 1 + i / 60, {});
  assert.equal(person.userData.anim.gesture, null);
  resetArms(person);
  assert.equal(person.userData.armsLocked, false);
  assert.ok(person.userData.arms.every((arm) => arm.reach === ARM_LENGTH));
  setCarry(person, true);
  for (let i = 0; i < 60; i++) animateCharacter(person, 1 / 60, i / 60, {});
  assert.ok(person.userData.arms.every((arm) => arm.shoulder.rotation.x < -0.5), 'при переносе руки вперёд');
  setCarry(person, false);
  for (let i = 0; i < 90; i++) animateCharacter(person, 1 / 60, i / 60, {});
  assert.ok(person.userData.arms.every((arm) => Math.abs(arm.shoulder.rotation.x) < 0.3), 'после переноса руки опускаются');
});

test('уровни качества: ниже качество — меньше деталей, всё остальное работает', () => {
  const build = (quality) => createCharacter({ appearance: appearanceFromSeed(21), quality });
  const low = build('low');
  const medium = build('medium');
  const high = build('high');
  assert.ok(stats(low).triangles < stats(medium).triangles && stats(medium).triangles < stats(high).triangles);
  assert.ok(stats(low).meshes <= stats(medium).meshes);
  for (const person of [low, medium, high]) {
    setPersonEquipment(person, true);
    setPersonCostume(person, 'florist');
    setExpression(person, 'surprised');
    triggerGesture(person, 'wave');
    for (let i = 0; i < 60; i++) animateCharacter(person, 1 / 60, i / 60, { speed: 1, talking: true });
    assert.ok(finiteTree(person));
  }
  setCharacterQuality('low');
  assert.equal(createCharacter().userData.detail, 0);
  setCharacterQuality('medium');
  assert.equal(createCharacter().userData.detail, 1);
});

test('производительность: бюджет мешей и треугольников на персонажа, быстрое создание', () => {
  const started = performance.now();
  const list = Array.from({ length: 60 }, (_, i) => createCharacter({ appearance: appearanceFromSeed(i * 7) }));
  const buildMs = (performance.now() - started) / list.length;
  const worst = list.map(stats).reduce((a, b) => (b.triangles > a.triangles ? b : a));
  assert.ok(worst.meshes <= 56, `мешей ${worst.meshes}`);
  assert.ok(worst.triangles <= 9000, `треугольников ${worst.triangles}`);
  assert.ok(buildMs < 25, `создание ${buildMs.toFixed(2)} мс`);
  const frameStart = performance.now();
  for (let f = 0; f < 60; f++) for (const person of list) animateCharacter(person, 1 / 60, f / 60, { speed: 1, talking: f % 2 === 0 });
  const frameMs = (performance.now() - frameStart) / 60;
  assert.ok(frameMs < 8, `анимация 60 персонажей ${frameMs.toFixed(2)} мс/кадр`);
});

test('NPC: реакции на события и характер', () => {
  const npc = createCharacter({ appearance: appearanceFromSeed(11), personality: { expression: 'happy', intensity: 0.4 } });
  assert.equal(getExpression(npc), 'happy');
  assert.equal(reactToEvent(npc, 'task_error'), true);
  assert.equal(getExpression(npc), 'thinking');
  assert.equal(reactToEvent(npc, 'task_success'), true);
  assert.equal(npc.userData.anim.gesture, 'approve');
  assert.equal(reactToEvent(npc, 'нет-такого'), false);
  const custom = createCharacter({ personality: { reactions: { task_success: { expression: 'surprised', duration: 1, gesture: null } } } });
  reactToEvent(custom, 'task_success');
  assert.equal(getExpression(custom), 'surprised');
});

test('удалённые игроки: внешность по id, уровень качества, поворот из снимков, освобождение без утечек', async () => {
  const { createRemotePlayers } = await import('../remote.js');
  const scene = new THREE.Scene();
  const createLabel = () => { const label = new THREE.Object3D(); label.element = { remove() {} }; return label; };
  const remote = createRemotePlayers({ scene, createLabel, quality: 'low' });
  remote.join(7, 'Аня', { color: 0x3366cc });
  remote.join(8, 'Боря', {});
  const avatar = () => scene.children[0].children[0];
  assert.equal(avatar().userData.detail, 0, 'уровень качества доходит до игрока');
  assert.equal(avatar().userData.look.outfit, '#3366cc');
  const again = createRemotePlayers({ scene: new THREE.Scene(), createLabel });
  again.join(7, 'Аня', { color: 0x3366cc });
  assert.deepEqual(appearanceFromSeed(7, 0x3366cc), avatar().userData.look, 'один id — один человек');
  for (let i = 0; i < 40; i++) {
    const now = 1000 + i * 50;
    remote.snapshot([[7, i * 0.3, 0, 0, i * 0.12, 1], [8, 4, 0, 4, 0, 0]], now);
    remote.update(now + 200);
  }
  assert.ok(Math.abs(avatar().userData.lean.rotation.z) + Math.abs(avatar().userData.lean.rotation.x) > 0, 'ходящий игрок наклонён');
  assert.ok(finiteTree(scene));
  remote.leave(7);
  remote.dispose();
  assert.equal(remote.size, 0);
});

test('нечисловые входы кадра (первый кадр без timestamp) не отравляют состояние персонажа', () => {
  const person = createCharacter({ appearance: appearanceFromSeed(12) });
  animateCharacter(person, 0, NaN, { speed: 1 });
  animateCharacter(person, NaN, NaN, { speed: NaN, lookYaw: NaN, talking: true });
  animateCharacter(person, undefined, undefined, {});
  for (let i = 0; i < 120; i++) animateCharacter(person, 1 / 60, i / 60, { speed: 1, talking: i % 2 === 0, lookYaw: 0.3 });
  assert.ok(finiteTree(person), 'позы конечны');
  assert.ok(Object.values(person.userData.anim).every((v) => typeof v !== 'number' || Number.isFinite(v)), 'состояние анимации конечно');
  assert.ok(Number.isFinite(person.userData.body.position.y));
});

test('профиль удалённого игрока совпадает с локальным и переживает смену пожарной экипировки', async () => {
  const { createRemotePlayers } = await import('../remote.js');
  const { createPlayerAppearance } = await import('../player-appearance.js');
  const appearance = { avatar: { skin: 3, clothes: 1, hair: 2, hairColor: 0, shoes: 0 } };
  const scene = new THREE.Scene();
  const createLabel = () => { const label = new THREE.Object3D(); label.element = { remove() {} }; return label; };
  const remote = createRemotePlayers({ scene, createLabel });
  remote.join(42, 'Игрок', appearance);
  const person = scene.children[0].children[0];
  const look = createPlayerAppearance({ id: 42, appearance });
  assert.deepEqual(person.userData.look, look);
  const pants = person.userData.pelvis.material;
  const shoes = person.userData.gearMaterials.sneaker;
  setPersonEquipment(person, true);
  assert.notEqual(person.userData.pelvis.material, pants);
  setPersonEquipment(person, false);
  assert.equal(person.userData.pelvis.material, pants);
  assert.equal(person.userData.gearMaterials.sneaker, shoes);
  assert.deepEqual(person.userData.look, look);
  remote.dispose();
});

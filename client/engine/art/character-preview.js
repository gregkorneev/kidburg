// Художественный предпросмотр персонажей (только разработка): настоящая система art/character.js,
// без редактора и без игровых состояний. Адрес: /character-preview.html?set=casual&view=three&anim=walk&expr=happy&clean=1
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as C from './character.js';
import { applyStylizedLook } from './lighting.js';
import { PALETTE } from './palette.js';
import { stdMat } from './materials.js';

const params = new URLSearchParams(location.search);
const host = document.querySelector('#view');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
host.appendChild(renderer.domElement);
const look = applyStylizedLook({ renderer, scene, camera, shadowExtent: 0, fog: [60, 140] });
const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 48).rotateX(-Math.PI / 2), stdMat(PALETTE.grassLight, { roughness: 1 }));
scene.add(ground);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const SPACING = 1.5;
let people = [];
let current = { set: params.get('set') || 'casual', view: params.get('view') || 'three', anim: params.get('anim') || 'idle', expr: params.get('expr') || 'neutral', focus: Number(params.get('focus') ?? 0) };
const holder = new THREE.Group();
scene.add(holder);

const HAIR = C.HAIR_STYLES ?? ['short', 'bob', 'curly', 'spiky', 'ponytail'];
const SETS = {
  casual: () => Array.from({ length: 8 }, (_, i) => ({ seed: 1 + i })),
  seeds: () => Array.from({ length: 16 }, (_, i) => ({ seed: 100 + i })),
  fire: () => [...Array.from({ length: 4 }, (_, i) => ({ seed: 3 + i * 5, equipped: true })), { marusya: true }, { seed: 9, equipped: false }],
  marusya: () => [{ marusya: true }],
  hair: () => HAIR.map((hairStyle, i) => ({ seed: 21 + i, appearance: { hairStyle, accessory: 'none', hair: ['#4a3228', '#d9a441', '#b9532f', '#2b2523'][i % 4] } })),
  tops: () => (C.TOP_STYLES ?? ['tee']).map((top, i) => ({ seed: 31 + i * 2, appearance: { top } })),
  emotions: () => (C.EXPRESSIONS ?? ['neutral']).map((expr) => ({ seed: 5, expr })),
  builds: () => (C.BUILDS ?? ['standard']).map((build, i) => ({ seed: 41 + i, appearance: { build } })),
  shoes: () => (C.SHOE_STYLES ?? ['sneaker']).map((shoes, i) => ({ seed: 51 + i, appearance: { shoes } })),
  accessories: () => (C.ACCESSORIES ?? ['none']).map((accessory, i) => ({ seed: 61 + i, appearance: { accessory } })),
  pro: () => ['fire', 'baker', 'florist', 'musician', 'radio'].map((costume, i) => ({ seed: 71 + i, costume })),
};

function build(spec) {
  if (spec.marusya) {
    const mod = window.__marusya;
    return mod ? mod() : C.createCharacter({ name: 'Маруся Громова', gear: 'mentor', equipped: true, helmet: true, holding: 'clipboard', appearance: { skin: '#f4c8a2', hair: '#5b3a2b', hairStyle: 'ponytail', outfit: '#9c3a31', pants: '#2f3e4a' } });
  }
  const person = C.createCharacter({ appearance: { ...C.appearanceFromSeed(spec.seed), ...(spec.appearance ?? {}) }, quality: params.get('quality') || undefined });
  if (spec.equipped) C.setPersonEquipment(person, true);
  if (spec.costume && spec.costume !== 'fire' && C.setPersonCostume) C.setPersonCostume(person, spec.costume);
  else if (spec.costume === 'fire') C.setPersonEquipment(person, true);
  return person;
}

function load(setName, range = null) {
  for (const p of people) { holder.remove(p); C.disposeCharacter(p); }
  const all = (SETS[setName] ?? SETS.casual)();
  const specs = range ? all.slice(range[0], range[1]) : all;
  people = specs.map((spec, i) => {
    const person = build(spec);
    person.position.set((i - (specs.length - 1) / 2) * SPACING, 0, 0);
    person.userData.previewExpr = spec.expr ?? current.expr;
    holder.add(person);
    return person;
  });
  current.set = setName;
  frame();
}

function frame() {
  const n = people.length;
  const width = Math.max(2.2, n * SPACING);
  const faces = current.view === 'faces';
  const face = current.view === 'face';
  const target = face ? people[Math.min(current.focus, n - 1)]?.position.clone() ?? new THREE.Vector3() : new THREE.Vector3(0, 1.0, 0);
  if (face || faces) target.y = 2.05;
  const dist = faces ? Math.max(2.2, (width * 0.55) / (Math.tan((camera.fov * Math.PI) / 360) * Math.max(1, camera.aspect))) : face ? 2.1 : Math.max(5.5, width * 0.95 / Math.tan((camera.fov * Math.PI) / 360) / Math.max(1, camera.aspect) * 0.62);
  const dirs = { front: [0, 0.1, 1], back: [0, 0.1, -1], side: [1, 0.1, 0], three: [0.62, 0.22, 0.8], face: [0.28, 0.0, 1], faces: [0.0, 0.0, 1] };
  const d = new THREE.Vector3(...(dirs[current.view] ?? dirs.three)).normalize();
  if (!face && !faces) target.y = 1.35;
  camera.position.copy(target).addScaledVector(d, dist);
  controls.target.copy(target);
  controls.update();
}

function resize() {
  camera.aspect = host.clientWidth / Math.max(1, host.clientHeight);
  camera.updateProjectionMatrix();
  renderer.setSize(host.clientWidth, host.clientHeight);
  frame();
}
addEventListener('resize', resize);

let previousFrameTime = null;
let frozen = params.has('freeze') ? Number(params.get('freeze')) : null;
let t = 0;
function stepOnce(dt) {
  t += dt;
  for (const [i, person] of people.entries()) {
    const speed = current.anim === 'run' ? 2 : current.anim === 'walk' ? 1 : 0;
    if (C.setExpression) C.setExpression(person, person.userData.previewExpr === 'neutral' ? current.expr : person.userData.previewExpr);
    C.animateCharacter(person, dt, t + i * 0.37, { speed, talking: current.anim === 'talk', lookYaw: 0 });
  }
}
function tick(timestamp) {
  requestAnimationFrame(tick);
  const dt = previousFrameTime === null ? 0 : Math.min((timestamp - previousFrameTime) / 1000, 0.05);
  previousFrameTime = timestamp;
  if (frozen === null) stepOnce(dt);
  controls.update();
  look.update({ x: 0, z: 0 }, t);
  renderer.render(scene, camera);
  const info = renderer.info.render;
  if (!params.has('clean')) document.querySelector('#stats').textContent = `calls ${info.calls}  tris ${info.triangles}\nchars ${people.length}  geometries ${renderer.info.memory.geometries}`;
}

function setAnim(anim) { current.anim = anim; }
function ui() {
  const bar = document.querySelector('#bar');
  const make = (label, items, key, handler) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.append(label + ': ');
    for (const item of items) {
      const b = document.createElement('button');
      b.textContent = item;
      b.onclick = () => { handler(item); [...row.querySelectorAll('button')].forEach((x) => x.classList.toggle('on', x === b)); };
      if (current[key] === item) b.className = 'on';
      row.append(b);
    }
    bar.append(row);
  };
  make('набор', Object.keys(SETS), 'set', load);
  make('вид', ['front', 'back', 'side', 'three', 'face', 'faces'], 'view', (v) => { current.view = v; frame(); });
  make('анимация', ['idle', 'walk', 'run', 'talk'], 'anim', setAnim);
  make('эмоция', C.EXPRESSIONS ?? ['neutral'], 'expr', (e) => { current.expr = e; people.forEach((p) => { p.userData.previewExpr = e; }); });
  make('жест', C.GESTURES ?? ['wave', 'nod'], 'gesture', (g) => people.forEach((p) => C.triggerGesture(p, g)));
}
if (params.has('clean')) document.body.classList.add('clean');

/** Для автоматических проверок: детерминированный кадр без реального времени. */
window.__preview = {
  C, THREE, scene, camera, renderer,
  get people() { return people; },
  load, frame,
  setView(v) { current.view = v; frame(); },
  setAnim,
  setExpr(e) { current.expr = e; people.forEach((p) => { p.userData.previewExpr = e; }); },
  freeze() { frozen = 0; },
  stepFrames(n, dt = 1 / 60) { for (let i = 0; i < n; i++) stepOnce(dt); },
  render() { controls.update(); look.update({ x: 0, z: 0 }, t); renderer.render(scene, camera); },
  /** Кадр в PNG через локальный приёмник разработки (localhost:5198); размер по умолчанию 1280x720. */
  async save(rel, width = 1280, height = 720) {
    const old = [host.clientWidth, host.clientHeight];
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    frame();
    renderer.render(scene, camera);
    const data = renderer.domElement.toDataURL('image/png');
    renderer.setSize(old[0], old[1], false);
    camera.aspect = old[0] / old[1];
    camera.updateProjectionMatrix();
    const res = await fetch(`http://localhost:5198/?path=${encodeURIComponent(rel)}`, { method: 'POST', body: data });
    return res.text();
  },
  stats() { const i = renderer.info.render; return { calls: i.calls, triangles: i.triangles, geometries: renderer.info.memory.geometries }; },
};

load(current.set);
ui();
resize();
requestAnimationFrame(tick);

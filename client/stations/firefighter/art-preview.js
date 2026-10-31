import * as THREE from 'three';
import { createPerson, setPersonEquipment } from './scene.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Самостоятельная художественная сцена: никакие игровые состояния не меняются.
const host = document.querySelector('#view');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#c7e2dc');
scene.fog = new THREE.Fog('#c7e2dc', 27, 55);
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
host.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 2;
controls.maxDistance = 22;
controls.maxPolarAngle = Math.PI * 0.48;

const material = (color, roughness = 0.72, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
const colors = {
  skin: material('#f2bd96'), cheek: material('#e99085'), brown: material('#51362d'), hair: material('#65412f'),
  eye: material('#fffaf3', 0.28), iris: material('#704632', 0.32), pupil: material('#1e2424', 0.22), white: material('#fff9ea'),
  red: material('#d84935'), redDark: material('#a7342a'), stripe: material('#f7d85e'), trim: material('#f6efd2'),
  green: material('#4c8770'), greenDark: material('#326453'), pants: material('#425d70'), boot: material('#263a3b', 0.45),
  wood: material('#b78056'), cream: material('#f1e5cb'), window: material('#638d93', 0.3), dark: material('#344f50'),
  orange: material('#efa44e'), grass: material('#a7ca8e'), road: material('#dacba8'), leaf: material('#6fa36d'),
  leaf2: material('#92bd7c'), metal: material('#8fa9a6', 0.4, { metalness: 0.25 }),
};

function mesh(parent, geometry, mat, x = 0, y = 0, z = 0) {
  const object = new THREE.Mesh(geometry, mat);
  object.position.set(x, y, z);
  object.castShadow = true;
  object.receiveShadow = true;
  parent.add(object);
  return object;
}
const ballGeometry = new THREE.SphereGeometry(1, 20, 14);
function ellipsoid(parent, x, y, z, sx, sy, sz, mat) {
  const object = mesh(parent, ballGeometry, mat, x, y, z);
  object.scale.set(sx, sy, sz);
  return object;
}
function block(parent, x, y, z, sx, sy, sz, mat) {
  return mesh(parent, new THREE.BoxGeometry(sx, sy, sz), mat, x, y, z);
}
function profile(parent, points, mat, x = 0, y = 0, z = 0) {
  return mesh(parent, new THREE.LatheGeometry(points.map(([r, h]) => new THREE.Vector2(r, h)), 24), mat, x, y, z);
}
function limb(parent, a, b, radius, mat) {
  const direction = new THREE.Vector3().subVectors(b, a);
  const object = mesh(parent, new THREE.CapsuleGeometry(radius, Math.max(0.01, direction.length() - radius * 2), 5, 12), mat);
  object.position.copy(a).add(b).multiplyScalar(0.5);
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return object;
}
function ring(parent, x, y, z, radius, tube, mat, rotation = 0) {
  const object = mesh(parent, new THREE.TorusGeometry(radius, tube, 8, 36), mat, x, y, z);
  object.rotation.x = rotation;
  return object;
}

scene.add(new THREE.HemisphereLight('#fff9e8', '#72947b', 2.2));
const sun = new THREE.DirectionalLight('#fff1d6', 3);
sun.position.set(-6, 14, 8); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14 });
sun.shadow.bias = -0.0003; scene.add(sun);
const ground = mesh(scene, new THREE.PlaneGeometry(70, 70), colors.grass, 0, -0.05, 0);
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
const plaza = mesh(scene, new THREE.CircleGeometry(5.2, 64), colors.road, 0, -0.025, 1);
plaza.rotation.x = -Math.PI / 2;

// Одна анатомическая основа и два набора одежды.
const character = new THREE.Group(); character.position.set(0, 0, 2.15); scene.add(character);
const animated = new THREE.Group(); character.add(animated);
animated.visible = false;
const modelStatus = document.querySelector('#model-status');
new GLTFLoader().load(new URL('./model-source/firefighter.glb', import.meta.url).href, (gltf) => {
  character.add(gltf.scene);
  modelStatus.textContent = 'Объёмная модель Blender. Скелет подготовлен для ручной настройки.';
}, undefined, () => {
  modelStatus.textContent = 'Не удалось загрузить GLB. Откройте просмотрщик через локальный Vite-сервер.';
});
document.querySelector('#casual').disabled = true;
document.querySelector('#casual').title = 'Повседневный комплект для новой модели ещё не создан';
document.querySelector('[data-view="npc"]').disabled = true;
document.querySelector('[data-view="npc"]').title = 'Этот просмотр посвящён одной модели';
document.querySelectorAll('[data-motion]').forEach((button) => {
  button.disabled = true; button.title = 'Анимация новой модели ещё не настроена';
});
const casual = new THREE.Group(); const uniform = new THREE.Group();
animated.add(casual, uniform);
ellipsoid(animated, 0, 1.79, 0, 0.19, 0.2, 0.18, colors.skin);
const torsoProfile = [[0, 0], [0.32, 0], [0.41, 0.08], [0.43, 0.35], [0.42, 0.62], [0.36, 0.84], [0.23, 0.96], [0, 0.96]];
profile(casual, torsoProfile, colors.green, 0, 0.79, 0);
profile(uniform, torsoProfile, colors.red, 0, 0.79, 0);
for (const y of [0.98, 1.12]) {
  profile(uniform, [[0.405, 0], [0.43, 0], [0.43, 0.045], [0.405, 0.045]], colors.stripe, 0, y, 0);
}
profile(casual, [[0.22, 0], [0.31, 0], [0.31, 0.13], [0.2, 0.13]], colors.greenDark, 0, 1.65, 0);
profile(uniform, [[0.22, 0], [0.31, 0], [0.31, 0.13], [0.2, 0.13]], colors.redDark, 0, 1.65, 0);
block(casual, 0, 1.25, 0.443, 0.035, 0.68, 0.035, colors.trim);
block(uniform, 0, 1.40, 0.425, 0.025, 0.46, 0.025, colors.redDark);
for (const x of [-0.23, 0.23]) {
  ellipsoid(casual, x, 1.08, 0.4, 0.15, 0.12, 0.045, colors.greenDark);
  ellipsoid(uniform, x, 1.05, 0.41, 0.15, 0.12, 0.045, colors.redDark);
  block(uniform, x, 1.13, 0.45, 0.27, 0.045, 0.04, colors.red);
}
const legs = [];
for (const x of [-0.22, 0.22]) {
  const normalLeg = new THREE.Group(); const fireLeg = new THREE.Group();
  normalLeg.position.set(x, 0.75, 0); fireLeg.position.copy(normalLeg.position);
  casual.add(normalLeg); uniform.add(fireLeg); legs.push([normalLeg, fireLeg]);
  limb(normalLeg, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.52, 0), 0.18, colors.pants);
  limb(fireLeg, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.52, 0), 0.18, colors.redDark);
  ellipsoid(normalLeg, 0, -0.62, 0.11, 0.21, 0.13, 0.3, colors.white);
  ellipsoid(normalLeg, 0, -0.685, 0.11, 0.22, 0.055, 0.31, colors.dark);
  mesh(fireLeg, new RoundedBoxGeometry(0.38, 0.32, 0.53, 4, 0.1), colors.boot, 0, -0.60, 0.09);
  profile(fireLeg, [[0.17, 0], [0.19, 0], [0.19, 0.055], [0.17, 0.055]], colors.stripe, 0, -0.32, 0);
}
const arms = [];
for (const side of [-1, 1]) {
  const arm = new THREE.Group(); arm.position.set(side * 0.4, 1.52, 0); animated.add(arm); arms.push(arm);
  const casualSleeve = new THREE.Group(); const fireSleeve = new THREE.Group(); arm.add(casualSleeve, fireSleeve);
  const start = new THREE.Vector3(0, 0, 0); const end = new THREE.Vector3(side * 0.22, -0.57, 0.05);
  limb(casualSleeve, start, end, 0.155, colors.green);
  limb(fireSleeve, start, end, 0.155, colors.red);
  ellipsoid(casualSleeve, side * 0.22, -0.57, 0.05, 0.16, 0.10, 0.16, colors.greenDark);
  ellipsoid(fireSleeve, side * 0.2, -0.51, 0.04, 0.17, 0.09, 0.17, colors.stripe);
  ellipsoid(fireSleeve, side * 0.17, -0.39, 0.03, 0.165, 0.055, 0.165, colors.stripe);
  const hand = ellipsoid(arm, side * 0.23, -0.69, 0.06, 0.135, 0.16, 0.11, colors.skin);
  const thumb = ellipsoid(arm, side * 0.12, -0.68, 0.14, 0.065, 0.095, 0.065, colors.skin);
  arm.userData = { casualSleeve, fireSleeve, hand, thumb };
}
// A single curved facial surface avoids stacked eyeball meshes.
function addFace(parent, instructor = false) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const c = canvas.getContext('2d');
  function oval(x, y, rx, ry, color) { c.fillStyle = color; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill(); }
  for (const side of [-1, 1]) {
    const x = 256 + side * 112;
    const blush = c.createRadialGradient(x + side * 45, 300, 1, x + side * 45, 300, 50);
    blush.addColorStop(0, 'rgba(222,108,96,.3)'); blush.addColorStop(1, 'rgba(222,108,96,0)');
    oval(x + side * 45, 300, 50, 35, blush);
    oval(x, 215, 57, 67, '#b77966'); oval(x, 218, 53, 62, '#fffaf2');
    oval(x, 226, 32, 42, instructor ? '#54745d' : '#805039'); oval(x, 229, 19, 31, '#302520');
    oval(x - 10, 210, 9, 12, '#fff'); oval(x + 11, 239, 4, 5, '#f8e8d4');
    c.strokeStyle = '#754a3c'; c.lineWidth = 6; c.lineCap = 'round'; c.beginPath();
    c.moveTo(x - 53, 196); c.quadraticCurveTo(x, 143, x + 53, 196); c.stroke();
    c.strokeStyle = instructor ? '#443129' : '#58392c'; c.lineWidth = 10; c.beginPath();
    c.moveTo(x - 43, 138); c.quadraticCurveTo(x, 119 + side * 4, x + 43, 138); c.stroke();
  }
  const nose = c.createRadialGradient(245, 277, 1, 256, 285, 34);
  nose.addColorStop(0, 'rgba(255,220,192,.95)'); nose.addColorStop(1, 'rgba(183,110,91,0)');
  oval(256, 285, 35, 30, nose);
  c.strokeStyle = '#ae6a5c'; c.lineWidth = 5; c.lineCap = 'round'; c.beginPath();
  c.moveTo(238, 310); c.quadraticCurveTo(256, 318, 274, 310); c.stroke();
  c.strokeStyle = '#8c5048'; c.lineWidth = 6; c.beginPath();
  c.moveTo(218, 351); c.quadraticCurveTo(256, 385, 294, 351); c.stroke();
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.PlaneGeometry(1, 1, 32, 32); const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i) * 0.87, y = positions.getY(i) * 0.78;
    const z = 0.47 * Math.sqrt(Math.max(0.02, 1 - x*x/(0.54*0.54) - y*y/(0.55*0.55))) + 0.008;
    positions.setXYZ(i, x, y + 0.34, z);
  }
  geometry.computeVertexNormals();
  mesh(parent, geometry, new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
}
// One continuous cap with a varied hairline, rather than identical oval locks.
function addHair(parent, mat, instructor = false) {
  const width = 48, height = 16, positions = [], indices = [];
  for (let y = 0; y <= height; y++) for (let x = 0; x <= width; x++) {
    const phi = x / width * Math.PI * 2, front = Math.max(0, Math.sin(phi));
    const fringe = front * (0.12 * Math.sin(phi * 3 + 0.6) + 0.06 * Math.sin(phi * 7));
    const theta = y / height * (1.98 - front * 0.55 + fringe + (instructor ? 0.15 * (1-front) : 0));
    const sweep = 1 + 0.025 * Math.sin(phi * 5 + theta * 3);
    positions.push(-Math.cos(phi)*Math.sin(theta)*0.55*sweep, 0.37+Math.cos(theta)*0.58, Math.sin(phi)*Math.sin(theta)*0.48*sweep-0.025);
    if (x < width && y < height) { const a=y*(width+1)+x, b=a+width+1; indices.push(a,b,a+1,b,b+1,a+1); }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); mesh(parent, geometry, mat);
}
// Head features share one head in both outfits.
const head = new THREE.Group(); head.position.y = 2.03; animated.add(head);
const headGeometry = new THREE.SphereGeometry(1, 28, 20);
const headPositions = headGeometry.attributes.position;
for (let i = 0; i < headPositions.count; i++) {
  const y = headPositions.getY(i);
  headPositions.setX(i, headPositions.getX(i) * (0.96 + 0.04 * Math.max(0, y)));
}
headGeometry.computeVertexNormals();
const headMesh = mesh(head, headGeometry, colors.skin, 0, 0.34, 0); headMesh.scale.set(0.54, 0.55, 0.47);
const eyelids = [];
for (const side of [-1, 1]) {
  ellipsoid(head, side * 0.51, 0.31, 0.0, 0.10, 0.15, 0.085, colors.skin);
  const eyelid = ellipsoid(head, side * 0.19, 0.37, 0.44, 0.10, 0.001, 0.015, colors.skin); eyelids.push(eyelid);
}
addFace(head); addHair(head, colors.hair);
const talkMouth = ellipsoid(head, 0, 0.185, 0.462, 0.065, 0.01, 0.008, colors.brown); talkMouth.visible = false;
const helmet = new THREE.Group(); helmet.position.set(0, 0.81, 0); uniform.add(helmet); head.add(helmet);
ellipsoid(helmet, 0, 0.04, 0, 0.55, 0.23, 0.48, colors.red);
ellipsoid(helmet, 0, -0.03, 0.04, 0.64, 0.065, 0.55, colors.redDark);
ellipsoid(helmet, 0, 0.04, 0.47, 0.12, 0.14, 0.035, colors.stripe);

const oldPerson = createPerson({ player: true });
oldPerson.position.copy(character.position); oldPerson.visible = false; scene.add(oldPerson);
let comparing = false;
let motion = 'idle';
document.querySelector('#compare').addEventListener('click', (event) => {
  comparing = !comparing; oldPerson.visible = comparing; character.visible = !comparing;
  event.currentTarget.classList.toggle('active', comparing);
  event.currentTarget.textContent = comparing ? 'Новый образ' : 'Старый образ';
});
document.querySelectorAll('[data-motion]').forEach((button) => button.addEventListener('click', () => {
  motion = button.dataset.motion;
  document.querySelectorAll('[data-motion]').forEach((item) => item.classList.toggle('active', item === button));
}));
function setOutfit(isFire) {
  setPersonEquipment(oldPerson, isFire);
  uniform.visible = isFire; casual.visible = !isFire; helmet.visible = isFire;
  arms.forEach(({ userData }) => {
    userData.casualSleeve.visible = !isFire; userData.fireSleeve.visible = isFire;
    userData.hand.material = userData.thumb.material = isFire ? colors.boot : colors.skin;
  });
  document.querySelector('#fire').classList.toggle('active', isFire);
  document.querySelector('#casual').classList.toggle('active', !isFire);
}
document.querySelector('#fire').addEventListener('click', () => setOutfit(true));
document.querySelector('#casual').addEventListener('click', () => setOutfit(false));
setOutfit(true);

// Самостоятельный образ Маруси в той же палитре и пропорциях.
const marusya = new THREE.Group(); marusya.position.set(-2.4, 0, 1.4); scene.add(marusya);
marusya.visible = false;
const npcBody = new THREE.Group(); marusya.add(npcBody);
ellipsoid(npcBody, 0, 1.79, 0, 0.19, 0.2, 0.18, colors.skin);
profile(npcBody, torsoProfile, colors.greenDark, 0, 0.79, 0);
profile(npcBody, [[0.2, 0], [0.3, 0], [0.3, 0.12], [0.2, 0.12]], colors.trim, 0, 1.65, 0);
block(npcBody, 0, 1.28, 0.42, 0.025, 0.55, 0.025, colors.trim);
for (const x of [-0.23, 0.23]) ellipsoid(npcBody, x, 1.07, 0.39, 0.12, 0.095, 0.035, colors.green);
for (const side of [-1, 1]) {
  limb(npcBody, new THREE.Vector3(side * 0.4, 1.52, 0), new THREE.Vector3(side * 0.6, 0.94, 0), 0.15, colors.greenDark);
  ellipsoid(npcBody, side * 0.61, 0.84, 0.04, 0.13, 0.15, 0.1, colors.skin);
  limb(npcBody, new THREE.Vector3(side * 0.22, 0.75, 0), new THREE.Vector3(side * 0.22, 0.23, 0), 0.18, colors.pants);
  ellipsoid(npcBody, side * 0.22, 0.13, 0.1, 0.21, 0.13, 0.29, colors.boot);
}
const npcHead = new THREE.Group(); npcHead.position.y = 2.03; npcBody.add(npcHead);
const npcHeadMesh = mesh(npcHead, headGeometry, colors.skin, 0, 0.34, 0); npcHeadMesh.scale.set(0.54, 0.55, 0.47);
addFace(npcHead, true); addHair(npcHead, colors.brown, true);
ellipsoid(npcHead, 0.38, 0.72, -0.27, 0.25, 0.25, 0.24, colors.brown);
const npcLids = [];
for (const side of [-1, 1]) {
  ellipsoid(npcHead, side * 0.5, 0.32, 0, 0.09, 0.14, 0.08, colors.skin);
  npcLids.push(ellipsoid(npcHead, side * 0.19, 0.37, 0.44, 0.10, 0.001, 0.015, colors.skin));
}

// Station vignette: a rounded facade, truck, trees and training wall.
const station = new THREE.Group(); station.position.set(-4.8, 0, -4); scene.add(station);
block(station, 0, 2.2, 0, 5.2, 4.4, 2.8, colors.cream);
block(station, 0, 4.48, 0, 5.55, 0.28, 3.1, colors.red);
block(station, 0, 1.6, 1.44, 2.65, 3.1, 0.12, colors.redDark);
block(station, 0, 1.6, 1.53, 2.35, 2.8, 0.08, colors.window);
for (let y = 0.55; y < 2.9; y += 0.53) block(station, 0, y, 1.59, 2.25, 0.055, 0.035, colors.trim);
for (const x of [-2, 2]) { block(station, x, 2.1, 1.45, 0.75, 1.2, 0.1, colors.white); block(station, x, 2.1, 1.53, 0.58, 1.02, 0.08, colors.window); }
const truck = new THREE.Group(); truck.position.set(-4.7, 0, 0.4); truck.rotation.y = -0.15; scene.add(truck);
mesh(truck, new RoundedBoxGeometry(3.25, 1.05, 1.4, 4, 0.20), colors.red, 0, 0.85, 0);
mesh(truck, new RoundedBoxGeometry(1.35, 1.05, 1.32, 4, 0.24), colors.red, -0.85, 1.55, 0);
block(truck, -0.87, 1.52, 0.69, 0.83, 0.62, 0.04, colors.window);
block(truck, 0.65, 0.96, 0.74, 1.2, 0.16, 0.04, colors.stripe);
for (const x of [-1.05, 1.05]) for (const z of [-0.72, 0.72]) { const wheel = mesh(truck, new THREE.CylinderGeometry(0.39, 0.39, 0.24, 20), colors.boot, x, 0.39, z); wheel.rotation.x = Math.PI / 2; }
for (const x of [-1.05, 1.05]) for (const z of [-0.85, 0.85]) { const hub = mesh(truck, new THREE.CylinderGeometry(0.19, 0.19, 0.025, 16), colors.metal, x, 0.39, z); hub.rotation.x = Math.PI / 2; }
for (const z of [-0.47, 0.47]) ellipsoid(truck, -1.65, 0.94, z, 0.06, 0.15, 0.16, colors.trim);
block(truck, -1.64, 0.67, 0, 0.08, 0.18, 0.7, colors.dark);
block(truck, 0.35, 1.51, 0, 1.65, 0.07, 0.55, colors.metal);
ellipsoid(truck, -0.75, 2.1, 0, 0.26, 0.12, 0.2, colors.window);
const wall = new THREE.Group(); wall.position.set(4.6, 0, -3.5); scene.add(wall);
block(wall, 0, 2.6, 0, 4.2, 5.2, 0.5, colors.cream); block(wall, 0, 5.25, 0, 4.5, 0.25, 0.8, colors.red);
const fireGroups = [];
const flameOuter = new THREE.MeshBasicMaterial({ color: '#f36f30', transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
const flameInner = new THREE.MeshBasicMaterial({ color: '#ffd365', transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });
const flameShape = new THREE.Shape(); flameShape.moveTo(0, 0); flameShape.bezierCurveTo(-0.42, 0.12, -0.28, 0.62, -0.08, 0.85); flameShape.bezierCurveTo(-0.12, 0.52, 0.16, 0.57, 0.2, 1.05); flameShape.bezierCurveTo(0.55, 0.5, 0.43, 0.08, 0, 0);
const flameGeometry = new THREE.ShapeGeometry(flameShape, 20);
for (let i = 0; i < 4; i++) {
  const x = i % 2 ? 1.03 : -1.03; const y = i < 2 ? 1.55 : 3.8;
  block(wall, x, y, 0.28, 1.45, 1.65, 0.12, colors.wood);
  block(wall, x, y, 0.36, 1.22, 1.42, 0.08, colors.dark);
  const fire = new THREE.Group(); fire.position.set(x, y - 0.65, 0.45); wall.add(fire); fireGroups.push(fire);
  for (let j = 0; j < 3; j++) { const f = mesh(fire, flameGeometry, j === 1 ? flameInner : flameOuter, (j - 1) * 0.34, 0, j * 0.015); f.scale.setScalar(j === 1 ? 0.9 : 1.1); }
}
const glow = new THREE.PointLight('#ff8e3c', 2, 6); glow.position.set(4.6, 2.9, -2.7); scene.add(glow);
const treeGroups = [];
for (const [x, z] of [[-8, -4], [8, -5], [-8, 5], [8, 5]]) {
  const tree = new THREE.Group(); tree.position.set(x, 0, z); scene.add(tree); treeGroups.push(tree);
  profile(tree, [[0.23, 0], [0.3, 0], [0.17, 2], [0.15, 2]], colors.wood);
  ellipsoid(tree, 0, 2.3, 0, 1.05, 0.85, 0.9, colors.leaf);
  ellipsoid(tree, -0.56, 2.0, 0.05, 0.73, 0.62, 0.65, colors.leaf2);
  ellipsoid(tree, 0.56, 2.05, 0, 0.68, 0.6, 0.66, colors.leaf2);
}
// Bake only rigid children; moving flames, trees and characters keep their pivots.
function mergeStaticChildren(group) {
  const buckets = new Map();
  for (const child of [...group.children]) {
    if (!child.isMesh || child.material.transparent) continue;
    child.updateMatrix();
    const geometry = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
    geometry.applyMatrix4(child.matrix);
    const list = buckets.get(child.material) || []; list.push({ child, geometry }); buckets.set(child.material, list);
  }
  for (const [mat, entries] of buckets) {
    if (entries.length < 2) { entries[0].geometry.dispose(); continue; }
    const merged = mergeGeometries(entries.map(entry => entry.geometry));
    if (merged) { entries.forEach(entry => group.remove(entry.child)); mesh(group, merged, mat); }
    entries.forEach(entry => entry.geometry.dispose());
  }
}
for (const group of [station, truck, wall, ...treeGroups]) mergeStaticChildren(group);
// Hose stand and translucent demonstration stream, independent of gameplay.
const stand = new THREE.Group(); stand.position.set(2.55, 0, 0); scene.add(stand);
block(stand, 0, 0.55, 0, 0.75, 1.1, 0.65, colors.greenDark);
ring(stand, 0, 1.18, 0.36, 0.43, 0.12, colors.orange);
const waterMaterial = new THREE.MeshBasicMaterial({ color: '#9aeaf1', transparent: true, opacity: 0.72, depthWrite: false });
const waterCurve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(2.7, 1.18, 0.2), new THREE.Vector3(3.4, 2.9, -0.8), new THREE.Vector3(4.3, 2.2, -2.8));
mesh(scene, new THREE.TubeGeometry(waterCurve, 28, 0.07, 8), waterMaterial);
function particles(count, mat) {
  const batch = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), mat, count);
  batch.frustumCulled = false; scene.add(batch); return batch;
}
const droplets = particles(14, waterMaterial);
const smokeMaterial = new THREE.MeshBasicMaterial({ color: '#aeb9ae', transparent: true, opacity: 0.28, depthWrite: false });
const smoke = particles(8, smokeMaterial);
const sparkMaterial = new THREE.MeshBasicMaterial({ color: '#ffcf60' });
const sparks = particles(8, sparkMaterial);
const particleTransform = new THREE.Object3D();
function particle(batch, i, x, y, z, scale) {
  particleTransform.position.set(x,y,z); particleTransform.scale.setScalar(scale); particleTransform.updateMatrix();
  batch.setMatrixAt(i, particleTransform.matrix);
}
const dropPosition = new THREE.Vector3();

const views = {
  front: [[0, 2.7, 9.3], [0, 1.55, 2.15]], side: [[7.2, 2.7, 2.15], [0, 1.55, 2.15]],
  back: [[0.01, 2.7, -5], [0, 1.55, 2.15]], face: [[0, 2.6, 5.7], [0, 2.38, 2.15]],
  angle: [[2.51, 2.6, 4.66], [0, 2.38, 2.15]],
  npc: [[-2.4, 2.7, 8.55], [-2.4, 1.55, 1.4]], scene: [[8.4, 6.4, 14], [0, 1.8, -0.3]],
};
document.querySelector('#toggle-panel').addEventListener('click', (event) => {
  const hidden = document.body.classList.toggle('clean'); event.currentTarget.setAttribute('aria-pressed', String(hidden));
  event.currentTarget.textContent = hidden ? 'Показать панель' : 'Скрыть панель';
});
let activeView = 'scene';
function updateFieldOfView() {
  const factor = activeView === 'scene' ? Math.max(1, 1.3 / camera.aspect) : 1;
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(19)) * factor));
  camera.updateProjectionMatrix();
}
function setView(name) { const [position, target] = views[name]; activeView = name; document.body.classList.toggle('closeup', name === 'face' || name === 'angle'); camera.position.set(...position); controls.target.set(...target); updateFieldOfView(); controls.update(); }
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
setView('scene');
function resize() { camera.aspect = host.clientWidth / Math.max(1, host.clientHeight); updateFieldOfView(); renderer.setSize(host.clientWidth, host.clientHeight); }
window.addEventListener('resize', resize); resize();
const started = performance.now();
let frames = 0; let lastStats = 0; let previousTime = 0; let gaitBlend = 0; let gaitPhase = 0;
function animate() {
  requestAnimationFrame(animate); const t = (performance.now() - started) / 1000;
  const dt = Math.min(t - previousTime, 0.05); previousTime = t;
  const targetGait = motion === 'walk' ? 1 : motion === 'run' ? 1.5 : 0;
  gaitBlend += (targetGait - gaitBlend) * (1 - Math.exp(-5 * dt)); const gait = gaitBlend;
  gaitPhase += (2.8 + gait * 2.4) * dt;
  legs.forEach((pair, i) => pair.forEach((leg) => { leg.rotation.x = gait * 0.35 * Math.sin(gaitPhase + (i + 1) * Math.PI); }));
  animated.position.y = gait * Math.abs(Math.sin(gaitPhase)) * 0.035;
  npcBody.scale.y = 1 + Math.sin(t * 1.8 + 1) * 0.008; npcHead.rotation.y = Math.sin(t * 0.7 + 2) * 0.07;
  const npcBlink = Math.max(0, 1 - Math.abs((t % 5.2) - 0.12) / 0.12);
  npcLids.forEach((lid) => { lid.scale.y = 0.001 + npcBlink * 0.15; });
  animated.scale.y = 1 + Math.sin(t * 2) * 0.008; head.rotation.y = Math.sin(t * 0.7) * 0.04;
  const blink = Math.max(0, 1 - Math.abs((t % 4.5) - 0.12) / 0.12);
  eyelids.forEach((lid) => { lid.scale.y = 0.001 + blink * 0.15; });
  arms.forEach((arm, i) => { arm.rotation.x = gait * 0.32 * Math.sin(gaitPhase + i * Math.PI); const target = motion === 'wave' && i === 1 ? -2.5 + Math.sin(t * 5) * 0.2 : (i ? -1 : 1) * (0.04 + Math.sin(t * 1.4) * 0.025); arm.rotation.z += (target - arm.rotation.z) * (1 - Math.exp(-5 * dt)); });
  talkMouth.visible = motion === 'talk';
  if (talkMouth.visible) talkMouth.scale.y = 0.01 + Math.abs(Math.sin(t * 7)) * 0.025;
  fireGroups.forEach((group, i) => { group.scale.y = 0.9 + Math.sin(t * 5 + i) * 0.13; group.rotation.z = Math.sin(t * 2.6 + i) * 0.05; });
  glow.intensity = 1.6 + Math.sin(t * 8) * 0.4;
  treeGroups.forEach((tree, i) => { tree.rotation.z = Math.sin(t * 0.65 + i) * 0.015; });
  for (let i=0; i<droplets.count; i++) { const phase = (t * 0.45 + i / droplets.count) % 1; waterCurve.getPoint(phase, dropPosition); particle(droplets, i, dropPosition.x, dropPosition.y, dropPosition.z, 0.055 + Math.sin(phase * Math.PI) * 0.035); }
  for (let i=0; i<smoke.count; i++) { const phase = (t * 0.28 + i / smoke.count) % 1; particle(smoke, i, 4.6 + Math.sin(i * 2 + t) * 0.18, 4.2 + phase * 1.8, -2.9, 0.12 + phase * 0.24); }
  for (let i=0; i<sparks.count; i++) { const phase = (t * 0.7 + i / sparks.count) % 1; particle(sparks, i, 4.4 + Math.sin(i * 9 + t) * 0.32, 3.3 + phase * 1.5, -2.95, 0.04); }
  droplets.instanceMatrix.needsUpdate = smoke.instanceMatrix.needsUpdate = sparks.instanceMatrix.needsUpdate = true;
  controls.update(); renderer.render(scene, camera);
  frames++; if (t - lastStats >= 1) { document.querySelector('#stats').textContent = `${Math.round(frames / (t - lastStats))} FPS · ${renderer.info.render.calls} вызовов · ${renderer.info.render.triangles} треугольников`; frames = 0; lastStats = t; }
}
animate();

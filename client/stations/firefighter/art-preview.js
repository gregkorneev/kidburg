import * as THREE from 'three';
import { createPerson, setPersonEquipment } from './scene.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
const ballGeometry = new THREE.SphereGeometry(1, 32, 24);
function ellipsoid(parent, x, y, z, sx, sy, sz, mat) {
  const object = mesh(parent, ballGeometry, mat, x, y, z);
  object.scale.set(sx, sy, sz);
  return object;
}
function block(parent, x, y, z, sx, sy, sz, mat) {
  return mesh(parent, new THREE.BoxGeometry(sx, sy, sz), mat, x, y, z);
}
function profile(parent, points, mat, x = 0, y = 0, z = 0) {
  return mesh(parent, new THREE.LatheGeometry(points.map(([r, h]) => new THREE.Vector2(r, h)), 32), mat, x, y, z);
}
function limb(parent, a, b, radius, mat) {
  const direction = new THREE.Vector3().subVectors(b, a);
  const object = mesh(parent, new THREE.CapsuleGeometry(radius, Math.max(0.01, direction.length() - radius * 2), 8, 16), mat);
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
const casual = new THREE.Group(); const uniform = new THREE.Group();
animated.add(casual, uniform);
ellipsoid(animated, 0, 1.79, 0, 0.19, 0.2, 0.18, colors.skin);
const torsoProfile = [[0, 0], [0.33, 0], [0.43, 0.12], [0.46, 0.54], [0.39, 0.86], [0.23, 0.96], [0, 0.96]];
profile(casual, torsoProfile, colors.green, 0, 0.79, 0);
profile(uniform, torsoProfile, colors.red, 0, 0.79, 0);
for (const y of [0.98, 1.12]) {
  profile(uniform, [[0.41, 0], [0.46, 0], [0.46, 0.07], [0.41, 0.07]], colors.stripe, 0, y, 0);
}
profile(casual, [[0.22, 0], [0.31, 0], [0.31, 0.13], [0.2, 0.13]], colors.greenDark, 0, 1.65, 0);
profile(uniform, [[0.22, 0], [0.31, 0], [0.31, 0.13], [0.2, 0.13]], colors.redDark, 0, 1.65, 0);
block(casual, 0, 1.25, 0.443, 0.035, 0.68, 0.035, colors.trim);
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
  ellipsoid(fireLeg, 0, -0.57, 0.08, 0.205, 0.2, 0.28, colors.boot);
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
  const hand = ellipsoid(arm, side * 0.23, -0.69, 0.06, 0.135, 0.16, 0.11, colors.skin);
  const thumb = ellipsoid(arm, side * 0.12, -0.68, 0.14, 0.065, 0.095, 0.065, colors.skin);
  arm.userData = { casualSleeve, fireSleeve, hand, thumb };
}
// Head features share one head in both outfits.
const head = new THREE.Group(); head.position.y = 2.03; animated.add(head);
ellipsoid(head, 0, 0.34, 0, 0.54, 0.55, 0.47, colors.skin);
const eyelids = [];
for (const side of [-1, 1]) {
  ellipsoid(head, side * 0.51, 0.31, 0.0, 0.10, 0.15, 0.085, colors.skin);
  ellipsoid(head, side * 0.23, 0.36, 0.415, 0.13, 0.15, 0.075, colors.eye);
  ellipsoid(head, side * 0.23, 0.355, 0.48, 0.077, 0.09, 0.035, colors.iris);
  ellipsoid(head, side * 0.23, 0.355, 0.512, 0.041, 0.055, 0.018, colors.pupil);
  ellipsoid(head, side * 0.21, 0.385, 0.528, 0.018, 0.022, 0.009, colors.white);
  const eyelid = ellipsoid(head, side * 0.23, 0.37, 0.535, 0.14, 0.001, 0.02, colors.skin); eyelids.push(eyelid);
  const brow = ellipsoid(head, side * 0.23, 0.56, 0.416, 0.12, 0.026, 0.025, colors.brown); brow.rotation.z = side * 0.1;
  ellipsoid(head, side * 0.37, 0.19, 0.365, 0.075, 0.035, 0.018, colors.cheek);
}
ellipsoid(head, 0, 0.23, 0.46, 0.08, 0.065, 0.075, colors.skin);
const smile = ring(head, 0, 0.135, 0.448, 0.10, 0.012, colors.brown); smile.scale.set(1, 0.45, 1); smile.geometry.dispose(); smile.geometry = new THREE.TorusGeometry(0.10, 0.012, 8, 24, Math.PI); smile.rotation.z = Math.PI;
// Layered hair is arranged as one silhouette around the same head.
ellipsoid(head, 0, 0.69, -0.06, 0.52, 0.24, 0.45, colors.hair);
ellipsoid(head, 0, 0.42, -0.31, 0.49, 0.42, 0.17, colors.hair);
for (let i = 0; i < 5; i++) {
  const lock = ellipsoid(head, -0.37 + i * 0.18, 0.62 + Math.sin(i) * 0.025, 0.35, 0.16, 0.13, 0.12, colors.hair);
  lock.rotation.z = -0.28;
}
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
const npcBody = new THREE.Group(); marusya.add(npcBody);
profile(npcBody, torsoProfile, colors.greenDark, 0, 0.79, 0);
profile(npcBody, [[0.2, 0], [0.3, 0], [0.3, 0.12], [0.2, 0.12]], colors.trim, 0, 1.65, 0);
for (const side of [-1, 1]) {
  limb(npcBody, new THREE.Vector3(side * 0.4, 1.52, 0), new THREE.Vector3(side * 0.6, 0.94, 0), 0.15, colors.greenDark);
  ellipsoid(npcBody, side * 0.61, 0.84, 0.04, 0.13, 0.15, 0.1, colors.skin);
  limb(npcBody, new THREE.Vector3(side * 0.22, 0.75, 0), new THREE.Vector3(side * 0.22, 0.23, 0), 0.18, colors.pants);
  ellipsoid(npcBody, side * 0.22, 0.13, 0.1, 0.21, 0.13, 0.29, colors.boot);
}
const npcHead = new THREE.Group(); npcHead.position.y = 2.03; npcBody.add(npcHead);
ellipsoid(npcHead, 0, 0.34, -0.18, 0.54, 0.58, 0.4, colors.brown);
ellipsoid(npcHead, 0, 0.34, 0, 0.52, 0.53, 0.44, colors.skin);
ellipsoid(npcHead, 0, 0.71, 0, 0.52, 0.22, 0.43, colors.brown);
ellipsoid(npcHead, 0.38, 0.72, -0.27, 0.25, 0.25, 0.24, colors.brown);
const npcLids = [];
for (const side of [-1, 1]) {
  ellipsoid(npcHead, side * 0.5, 0.32, 0, 0.09, 0.14, 0.08, colors.skin);
  ellipsoid(npcHead, side * 0.22, 0.36, 0.4, 0.13, 0.14, 0.07, colors.eye);
  ellipsoid(npcHead, side * 0.22, 0.36, 0.465, 0.07, 0.085, 0.035, colors.iris);
  ellipsoid(npcHead, side * 0.22, 0.36, 0.495, 0.038, 0.05, 0.018, colors.pupil);
  ellipsoid(npcHead, side * 0.2, 0.39, 0.513, 0.017, 0.02, 0.009, colors.white);
  npcLids.push(ellipsoid(npcHead, side * 0.22, 0.36, 0.52, 0.14, 0.001, 0.02, colors.skin));
  ellipsoid(npcHead, side * 0.22, 0.55, 0.4, 0.11, 0.025, 0.02, colors.brown);
}
ellipsoid(npcHead, 0, 0.23, 0.44, 0.075, 0.06, 0.07, colors.skin);
const npcSmile = mesh(npcHead, new THREE.TorusGeometry(0.09, 0.012, 8, 24, Math.PI), colors.brown, 0, 0.13, 0.43);
npcSmile.rotation.z = Math.PI; npcSmile.scale.y = 0.45;

// Station vignette: a rounded facade, truck, trees and training wall.
const station = new THREE.Group(); station.position.set(-4.8, 0, -4); scene.add(station);
block(station, 0, 2.2, 0, 5.2, 4.4, 2.8, colors.cream);
block(station, 0, 4.48, 0, 5.55, 0.28, 3.1, colors.red);
block(station, 0, 1.6, 1.44, 2.65, 3.1, 0.12, colors.redDark);
block(station, 0, 1.6, 1.53, 2.35, 2.8, 0.08, colors.window);
for (let y = 0.55; y < 2.9; y += 0.53) block(station, 0, y, 1.59, 2.25, 0.055, 0.035, colors.trim);
for (const x of [-2, 2]) { block(station, x, 2.1, 1.45, 0.75, 1.2, 0.1, colors.white); block(station, x, 2.1, 1.53, 0.58, 1.02, 0.08, colors.window); }
const truck = new THREE.Group(); truck.position.set(-4.7, 0, 0.4); truck.rotation.y = -0.15; scene.add(truck);
ellipsoid(truck, 0, 0.8, 0, 1.7, 0.7, 0.76, colors.red);
ellipsoid(truck, -0.75, 1.46, 0, 0.8, 0.67, 0.69, colors.red);
block(truck, -0.87, 1.52, 0.69, 0.83, 0.62, 0.04, colors.window);
block(truck, 0.65, 0.96, 0.74, 1.2, 0.16, 0.04, colors.stripe);
for (const x of [-1.05, 1.05]) for (const z of [-0.72, 0.72]) { const wheel = mesh(truck, new THREE.CylinderGeometry(0.39, 0.39, 0.24, 20), colors.boot, x, 0.39, z); wheel.rotation.x = Math.PI / 2; }
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
// Hose stand and translucent demonstration stream, independent of gameplay.
const stand = new THREE.Group(); stand.position.set(2.55, 0, 0); scene.add(stand);
block(stand, 0, 0.55, 0, 0.75, 1.1, 0.65, colors.greenDark);
ring(stand, 0, 1.18, 0.36, 0.43, 0.12, colors.orange);
const waterMaterial = new THREE.MeshBasicMaterial({ color: '#9aeaf1', transparent: true, opacity: 0.72, depthWrite: false });
const waterCurve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(2.7, 1.18, 0.2), new THREE.Vector3(3.4, 2.9, -0.8), new THREE.Vector3(4.3, 2.2, -2.8));
mesh(scene, new THREE.TubeGeometry(waterCurve, 28, 0.07, 8), waterMaterial);
const droplets = [];
for (let i = 0; i < 14; i++) droplets.push(ellipsoid(scene, 0, 0, 0, 0.08, 0.11, 0.08, waterMaterial));
const smokeMaterial = new THREE.MeshBasicMaterial({ color: '#aeb9ae', transparent: true, opacity: 0.28, depthWrite: false });
const smoke = [];
for (let i = 0; i < 8; i++) smoke.push(ellipsoid(scene, 0, 0, 0, 0.16, 0.2, 0.16, smokeMaterial));
const sparkMaterial = new THREE.MeshBasicMaterial({ color: '#ffcf60' });
const sparks = [];
for (let i = 0; i < 8; i++) sparks.push(ellipsoid(scene, 0, 0, 0, 0.035, 0.05, 0.035, sparkMaterial));

const views = {
  front: [[0, 2.7, 9.3], [0, 1.55, 2.15]], side: [[7.2, 2.7, 2.15], [0, 1.55, 2.15]],
  back: [[0.01, 2.7, -5], [0, 1.55, 2.15]], face: [[0, 2.6, 5.7], [0, 2.38, 2.15]],
  scene: [[8.4, 6.4, 14], [0, 1.8, -0.3]],
};
function setView(name) { const [position, target] = views[name]; document.body.classList.toggle('closeup', name === 'face'); camera.position.set(...position); controls.target.set(...target); controls.update(); }
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
setView('scene');
function resize() { camera.aspect = host.clientWidth / Math.max(1, host.clientHeight); camera.updateProjectionMatrix(); renderer.setSize(host.clientWidth, host.clientHeight); }
window.addEventListener('resize', resize); resize();
let frames = 0; let lastStats = 0;
function animate(timestamp) {
  requestAnimationFrame(animate); const t = timestamp / 1000;
  const gait = motion === 'walk' ? 1 : motion === 'run' ? 1.7 : 0;
  legs.forEach((pair, i) => pair.forEach((leg) => { leg.rotation.x = gait * 0.4 * Math.sin(t * (motion === 'run' ? 8 : 5) + (i + 1) * Math.PI); }));
  animated.position.y = gait ? Math.abs(Math.sin(t * (motion === 'run' ? 8 : 5))) * 0.06 : 0;
  npcBody.scale.y = 1 + Math.sin(t * 1.8 + 1) * 0.008; npcHead.rotation.y = Math.sin(t * 0.7 + 2) * 0.07;
  const npcBlink = Math.max(0, 1 - Math.abs((t % 5.2) - 0.12) / 0.12);
  npcLids.forEach((lid) => { lid.scale.y = 0.001 + npcBlink * 0.15; });
  animated.scale.y = 1 + Math.sin(t * 2) * 0.008; head.rotation.y = Math.sin(t * 0.7) * 0.04;
  const blink = Math.max(0, 1 - Math.abs((t % 4.5) - 0.12) / 0.12);
  eyelids.forEach((lid) => { lid.scale.y = 0.001 + blink * 0.15; });
  arms.forEach((arm, i) => { arm.rotation.x = gait * 0.45 * Math.sin(t * (motion === 'run' ? 8 : 5) + i * Math.PI); arm.rotation.z = motion === 'wave' && i === 1 ? -2.5 + Math.sin(t * 5) * 0.2 : (i ? -1 : 1) * (0.04 + Math.sin(t * 1.4) * 0.025); });
  smile.scale.y = motion === 'talk' ? 0.45 + Math.abs(Math.sin(t * 7)) * 0.6 : 0.45;
  fireGroups.forEach((group, i) => { group.scale.y = 0.9 + Math.sin(t * 5 + i) * 0.13; group.rotation.z = Math.sin(t * 2.6 + i) * 0.05; });
  glow.intensity = 1.6 + Math.sin(t * 8) * 0.4;
  treeGroups.forEach((tree, i) => { tree.rotation.z = Math.sin(t * 0.65 + i) * 0.015; });
  droplets.forEach((drop, i) => { const phase = (t * 0.45 + i / droplets.length) % 1; waterCurve.getPoint(phase, drop.position); drop.scale.setScalar(0.055 + Math.sin(phase * Math.PI) * 0.035); });
  smoke.forEach((p, i) => { const phase = (t * 0.28 + i / smoke.length) % 1; p.position.set(4.6 + Math.sin(i * 2 + t) * 0.18, 4.2 + phase * 1.8, -2.9); p.scale.setScalar(0.12 + phase * 0.24); });
  sparks.forEach((p, i) => { const phase = (t * 0.7 + i / sparks.length) % 1; p.position.set(4.4 + Math.sin(i * 9 + t) * 0.32, 3.3 + phase * 1.5, -2.95); });
  controls.update(); renderer.render(scene, camera);
  frames++; if (t - lastStats >= 1) { document.querySelector('#stats').textContent = `${Math.round(frames / (t - lastStats))} FPS · ${renderer.info.render.calls} вызовов · ${renderer.info.render.triangles} треугольников`; frames = 0; lastStats = t; }
}
animate();

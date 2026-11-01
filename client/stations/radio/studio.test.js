import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { createRadioStudio } from './scene.js';

const studioDirectory = path.dirname(fileURLToPath(import.meta.url));

function cylinderEndpoints(mesh) {
  const axis = new THREE.Vector3(0, 1, 0)
    .applyQuaternion(mesh.quaternion)
    .multiplyScalar(mesh.geometry.parameters.height / 2);
  return [mesh.position.clone().sub(axis), mesh.position.clone().add(axis)];
}

function makeHarness() {
  const children = [];
  const windowListeners = new Map();
  const container = {
    clientWidth: 960,
    clientHeight: 640,
    appendChild(element) { children.push(element); },
  };
  const canvas = {
    setAttribute() {},
    remove() { this.removed = true; },
  };
  const renderer = {
    domElement: canvas,
    shadowMap: {},
    setPixelRatio(value) { this.pixelRatio = value; },
    setSize(width, height) { this.size = [width, height]; },
    render(scene, camera) { this.renderCount = (this.renderCount ?? 0) + 1; this.lastRender = { scene, camera }; },
    dispose() { this.disposed = true; },
    forceContextLoss() { this.contextLost = true; },
  };
  const windowObject = {
    devicePixelRatio: 2,
    innerWidth: 800,
    innerHeight: 600,
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    removeEventListener(type) { windowListeners.delete(type); },
  };
  const studio = createRadioStudio({
    container,
    window: windowObject,
    rendererFactory: () => renderer,
  });
  return { children, container, renderer, studio, windowListeners };
}

test('Radio Studio создаётся как неподвижное рабочее место с отдельным monitor mount', () => {
  const { children, renderer, studio } = makeHarness();
  assert.equal(children.length, 1, 'renderer canvas добавлен в preview-контейнер');
  assert.ok(studio.scene.getObjectByName('host-desk'));
  assert.ok(studio.scene.getObjectByName('broadcast-microphone'));
  assert.ok(studio.scene.getObjectByName('compact-mixer'));
  assert.ok(studio.scene.getObjectByName('on-air-indicator'));
  assert.ok(studio.scene.getObjectByName('monitor-fill'));
  assert.ok(studio.scene.getObjectByName('on-air-glow'));
  const speakers = [];
  const faders = [];
  const knobs = [];
  let acousticPanelFrames = 0;
  studio.scene.traverse((object) => {
    if (object.name === 'studio-speaker') speakers.push(object);
    if (object.name === 'mixer-fader') faders.push(object);
    if (object.name === 'mixer-knob') knobs.push(object);
    if (object.name === 'acoustic-panel-frame') acousticPanelFrames++;
  });
  assert.equal(speakers.length, 2);
  assert.equal(speakers[0].position.x, -speakers[1].position.x, 'колонки стоят симметрично');
  assert.equal(speakers[0].geometry, speakers[1].geometry, 'геометрия одинаковых колонок переиспользуется');
  assert.equal(faders.length, 5);
  assert.equal(knobs.length, 3);
  assert.equal(acousticPanelFrames, 4);
  assert.equal(studio.monitorMount.group.name, 'radio-monitor-mount');
  assert.equal(studio.getMonitorMount(), studio.monitorMount);
  assert.equal(studio.monitorMount.screen.name, 'radio-monitor-screen-placeholder');
  assert.equal(studio.monitorMount.screen.geometry.parameters.width, 4.42);
  assert.equal(studio.monitorMount.screen.geometry.parameters.height, 2.68);
  assert.equal(typeof studio.monitorMount.mount, 'function', 'позволяет встроить существующий DOM-монитор');
  assert.equal(typeof studio.monitorMount.unmount, 'function');
  assert.equal(studio.monitorMount.screen.parent, studio.monitorMount.group);
  assert.ok(studio.camera.position.z > 0, 'камера находится за столом на месте ведущего');
  assert.equal(studio.camera.position.z, 5.35);
  assert.equal(studio.camera.fov, 40);
  assert.deepEqual(studio.camera.position.toArray(), [0, 2.75, 5.35]);
  assert.ok(renderer.lastRender, 'сцена отображена без свободного управления камерой');
  const renderBeforeResize = renderer.lastRender;
  studio.resize();
  assert.notEqual(renderer.lastRender, renderBeforeResize, 'resize доступен адаптеру и обновляет renderer');
  studio.dispose();
});

test('monitor mount размещает существующий DOM root и вызывает его cleanup при unmount/dispose', () => {
  class FakeElement {
    constructor() { this.children = []; this.style = {}; this.attributes = {}; }
    setAttribute(name, value) { this.attributes[name] = value; }
    appendChild(element) { this.children.push(element); element.parentElement = this; return element; }
    replaceChildren(...elements) {
      for (const child of this.children) child.parentElement = null;
      this.children = [];
      for (const element of elements) this.appendChild(element);
    }
    remove() {
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      this.parentElement = null;
      this.removed = true;
    }
    getContext() {
      return new Proxy({}, { get: () => () => {}, set: (target, key, value) => { target[key] = value; return true; } });
    }
  }

  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => new FakeElement() };
  try {
    const { children, container, studio } = makeHarness();
    const monitorMount = studio.getMonitorMount();
    const overlay = children.find((child) => child.className === 'studio-monitor-overlay');
    const radioRoot = new FakeElement();
    let cleanupCount = 0;
    assert.equal(monitorMount.mount(radioRoot, () => { cleanupCount++; }), monitorMount.element);
    assert.equal(monitorMount.element.children[0], radioRoot);
    assert.equal(monitorMount.screen.parent, monitorMount.group, 'production UI отображается overlay поверх CanvasTexture');
    assert.equal(overlay.children[0], monitorMount.element);
    assert.equal(overlay.style.display, 'block');
    monitorMount.unmount();
    assert.equal(cleanupCount, 1);
    assert.equal(radioRoot.parentElement, null);
    assert.equal(overlay.style.display, 'none');

    monitorMount.mount(radioRoot, () => { cleanupCount++; });
    studio.dispose();
    assert.equal(cleanupCount, 2, 'dispose запускает cleanup UI до удаления overlay');
    assert.equal(overlay.removed, true);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test('boom arm, mixer supports, plaque, booth equipment, ON AIR clearance and monitor mount stay connected', () => {
  const { studio } = makeHarness();
  const mic = studio.scene.getObjectByName('broadcast-microphone');
  const base = mic.getObjectByName('microphone-table-base');
  const basePivot = mic.getObjectByName('microphone-base-pivot');
  const elbow = mic.getObjectByName('microphone-boom-joint');
  const lowerArm = mic.getObjectByName('microphone-boom-lower');
  const upperArm = mic.getObjectByName('microphone-boom-upper');
  const holder = mic.getObjectByName('microphone-holder');
  const tableSurface = studio.scene.getObjectByName('host-desk-surface');

  const lowerEnds = cylinderEndpoints(lowerArm);
  const upperEnds = cylinderEndpoints(upperArm);
  assert.ok(lowerEnds.some((point) => point.distanceTo(basePivot.position) < 1e-5), 'нижняя секция соединена с pivot основания');
  assert.ok(lowerEnds.some((point) => point.distanceTo(elbow.position) < 1e-5), 'нижняя секция соединена с локтем');
  assert.ok(upperEnds.some((point) => point.distanceTo(elbow.position) < 1e-5), 'верхняя секция соединена с локтем');
  assert.ok(upperEnds.some((point) => point.distanceTo(holder.position) < 0.03), 'держатель соединён с верхней секцией');
  mic.updateWorldMatrix(true, true);
  const baseBounds = new THREE.Box3().setFromObject(base);
  const tableBounds = new THREE.Box3().setFromObject(tableSurface);
  assert.ok(Math.abs(baseBounds.min.y - tableBounds.max.y) < 1e-5, 'основание стойки касается столешницы');

  const mixer = studio.scene.getObjectByName('compact-mixer');
  const mixerBase = mixer.getObjectByName('mixer-base');
  studio.scene.updateMatrixWorld(true);
  const mixerBaseBounds = new THREE.Box3().setFromObject(mixerBase);
  const mixerFeet = mixer.parent.children.filter((object) => object.name === 'mixer-support-foot');
  assert.equal(mixerFeet.length, 2, 'наклонённый микшер установлен на две опоры');
  for (const foot of mixerFeet) {
    const footBounds = new THREE.Box3().setFromObject(foot);
    assert.ok(Math.abs(footBounds.min.y - tableBounds.max.y) < 1e-4, 'опора касается столешницы');
  }
  assert.ok(mixerBaseBounds.max.y > Math.max(...mixerFeet.map((foot) => new THREE.Box3().setFromObject(foot).max.y)));

  assert.ok(mic.getObjectByName('microphone-body'));
  assert.ok(mic.getObjectByName('microphone-grille'));
  assert.ok(holder.geometry.parameters.radiusTop > mic.getObjectByName('microphone-body').geometry.parameters.radiusTop);
  for (const name of ['radio-wall-plaque-frame', 'radio-wall-plaque-face', 'radio-wall-plaque-icon']) {
    assert.ok(studio.scene.getObjectByName(name), `${name} exists`);
  }
  assert.equal(studio.scene.getObjectByName('radio-wall-plaque-icon').material.transparent, true);
  assert.ok(studio.scene.getObjectByName('radio-monitor-back-panel'));
  const monitorArm = studio.scene.getObjectByName('radio-monitor-wall-arm');
  const wallAnchor = studio.scene.getObjectByName('radio-monitor-wall-anchor');
  const backAnchor = studio.scene.getObjectByName('radio-monitor-back-anchor');
  assert.ok(cylinderEndpoints(monitorArm).some((point) => point.distanceTo(wallAnchor.position) < 1e-5));
  assert.ok(cylinderEndpoints(monitorArm).some((point) => point.distanceTo(backAnchor.position) < 1e-5));

  const rack = studio.scene.getObjectByName('control-room-rack');
  const window = studio.scene.getObjectByName('control-room-window');
  const transom = studio.scene.getObjectByName('control-room-window-transom');
  const onAirHousing = studio.scene.getObjectByName('on-air-indicator').children[0];
  studio.scene.updateMatrixWorld(true);
  const rackBounds = new THREE.Box3().setFromObject(rack);
  const windowBounds = new THREE.Box3().setFromObject(window);
  const transomBounds = new THREE.Box3().setFromObject(transom);
  assert.ok(rackBounds.max.z < windowBounds.min.z, 'аппаратная расположена за стеклом');
  assert.equal(new THREE.Box3().setFromObject(onAirHousing).intersectsBox(transomBounds), false, 'корпус ON AIR не пересекает оконный трансом');
  assert.equal(studio.monitorMount.screen.geometry.parameters.width, 4.42, 'размер экрана сохранён');
  assert.equal(studio.monitorMount.group.position.z, -2.36, 'положение экрана сохранено');
  studio.dispose();
});

test('setOnAir меняет индикатор, а dispose освобождает сцену, renderer и слушатели', () => {
  const { renderer, studio, windowListeners } = makeHarness();
  const face = studio.scene.getObjectByName('on-air-face');
  const offMaterial = face.material;
  assert.equal(studio.getOnAir(), false);
  const onAirGlow = studio.scene.getObjectByName('on-air-glow');
  assert.equal(onAirGlow.visible, false);
  const initialRenderCount = renderer.renderCount;
  assert.equal(studio.setOnAir(true), true);
  assert.equal(studio.getOnAir(), true);
  assert.equal(onAirGlow.visible, true);
  assert.equal(renderer.renderCount, initialRenderCount + 1, 'ON AIR вызывает redraw без отдельного render loop');
  assert.notEqual(face.material, offMaterial);
  assert.equal(studio.setOnAir(false), false);
  assert.equal(onAirGlow.visible, false);
  assert.equal(renderer.renderCount, initialRenderCount + 2);
  assert.equal(face.material, offMaterial);

  let textureDisposed = false;
  studio.monitorMount.screen.material.map.dispose = () => { textureDisposed = true; };
  studio.dispose();
  assert.equal(textureDisposed, true, 'текстура placeholder освобождена');
  assert.equal(renderer.disposed, true);
  assert.equal(renderer.contextLost, true);
  assert.equal(renderer.domElement.removed, true);
  assert.equal(windowListeners.size, 0);
  assert.equal(studio.scene.children.length, 0);
  studio.dispose();
});

test('Radio Studio client-файлы не содержат внешних URL', async () => {
  const files = await readdir(studioDirectory);
  assert.equal(files.includes('preview.js'), true, 'production orchestrator Radio MVP сохранён');
  assert.equal(files.includes('entry.js'), true, 'production Radio entry сохранён');
  assert.equal(files.includes('network.js'), true, 'production Radio network adapter сохранён');
  const previewHtml = await readFile(path.join(studioDirectory, 'studio-preview.html'), 'utf8');
  assert.match(previewHtml, /studio-preview\.js/);
  const productionHtml = await readFile(path.resolve(studioDirectory, '../../radio-preview.html'), 'utf8');
  assert.match(productionHtml, /stations\/radio\/entry\.js/);
  const runtimeFiles = files.filter((name) => /\.(?:html|m?js|css)$/.test(name) && !/\.test\.m?js$/.test(name));
  const externalUrl = /(?:https?:|wss?:)?\/\/[a-z\d.-]+(?::\d+)?(?:\/[^\s"'`<>)]*)?/i;
  for (const name of runtimeFiles) {
    const source = await readFile(path.join(studioDirectory, name), 'utf8');
    assert.equal(externalUrl.test(source), false, `${name} содержит внешний URL`);
  }
});

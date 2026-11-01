// Секционные гаражные ворота. Каждая секция — отдельный Mesh, который едет по направляющей: вертикально вдоль
// проёма, затем по дуге в короб над проёмом и горизонтально внутрь здания. Короб и стену рисует неподвижная
// геометрия здания; секции входят в неё и скрываются, поэтому визуальных пересечений снаружи нет.
//
// Система координат ворот: начало — центр проёма на уровне пола, +Y вверх, +Z наружу (к фасаду).
// Состояния: closed → opening → open → closing → closed. Повторные команды не ломают движение:
// open() во время closing разворачивает створки с текущего положения.
import * as THREE from 'three';
import { createPrefabKit } from '../art/prefab-kit.js';
import { sharedGeometry } from '../art/materials.js';
import { createAnimatedObject, createProgress, createStateMachine, easeInOutSine } from '../animated.js';

export const GATE_TRANSITIONS = Object.freeze({
  closed: ['opening'],
  opening: ['open', 'closing'],
  open: ['closing'],
  closing: ['closed', 'opening'],
});

export const GATE_LABELS = Object.freeze({ open: 'Открыть ворота', close: 'Закрыть ворота' });

/** Ворота можно проходить, когда створки ушли с проёма; пока они в движении, проход закрыт. */
export const PASSABLE_PROGRESS = 0.92;

const DEFAULT_PALETTE = Object.freeze({ a: 0x7fb6bf, b: 0x6aa3ae, glass: 0xffe6a6, trim: 0xe9e2cc, handle: 0xf0c85f });

let sharedMaterial = null;
const panelMaterial = () => {
  if (!sharedMaterial) {
    sharedMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.55, metalness: 0.05 });
    sharedMaterial.userData.shared = true;
  }
  return sharedMaterial;
};

/** Геометрия секции (общая для всех ворот с теми же размерами и цветом). */
function sectionGeometry({ width, panelHeight, depth, color, glass, palette, handle }) {
  return sharedGeometry(`gate-section:${width}:${panelHeight}:${depth}:${color}:${glass ? 1 : 0}:${handle ? 1 : 0}`, () => {
    const kit = createPrefabKit({ seed: 5, tint: 0.012 });
    kit.box(width, panelHeight - 0.04, depth, 0, 0, 0, color, { r: Math.min(0.03, depth * 0.3) });
    kit.box(width - 0.06, 0.035, depth + 0.02, 0, panelHeight / 2 - 0.06, 0, palette.trim, { tinted: false });
    if (glass) {
      const n = 4;
      const slot = (width - 0.6) / n;
      for (let j = 0; j < n; j++) kit.box(slot - 0.1, panelHeight * 0.44, 0.03, -(width - 0.6) / 2 + slot * (j + 0.5), 0, depth / 2 + 0.005, palette.glass, { tinted: false });
    }
    if (handle) kit.box(0.5, 0.06, 0.06, 0, 0, depth / 2 + 0.03, palette.handle, { tinted: false });
    return kit.build({ groundAO: null, underside: 1 });
  });
}

/**
 * @param {object} o
 * @param {string} o.id
 * @param {number} o.width ширина проёма (м)
 * @param {number} o.height высота проёма (м)
 * @param {number} [o.sections] число секций (не меньше 4)
 * @param {number} [o.thickness] толщина секции (м)
 * @param {number} [o.radius] радиус дуги направляющей (должен вмещаться в короб над проёмом)
 * @param {number} [o.windowSection] индекс секции с окошками (с нуля снизу), -1 — без окон
 * @param {number} [o.duration] полное время открытия (с)
 * @param {Partial<typeof DEFAULT_PALETTE>} [o.palette]
 * @param {(index: number, spec: object) => THREE.Mesh} [o.makeSection] своя сборка секции
 */
export function createSectionalGate({
  id, width, height, sections = 6, thickness = 0.1, radius = 0.2, windowSection = -2, duration = 2.6, palette = {}, makeSection = null, initialOpen = false,
}) {
  if (sections < 4) throw new RangeError('В воротах не меньше четырёх секций');
  const colors = { ...DEFAULT_PALETTE, ...palette };
  const root = new THREE.Group();
  root.name = `gate:${id}`;
  const panel = height / sections;
  const arc = (Math.PI * radius) / 2;
  const travel = height + arc + panel * 0.5 + 0.05; // ход, после которого вся стопка лежит горизонтально в коробе
  const window = windowSection === -2 ? sections - 2 : windowSection;

  const meshes = [];
  for (let i = 0; i < sections; i++) {
    const spec = { width: width - 0.08, panelHeight: panel, depth: thickness, color: i % 2 ? colors.b : colors.a, glass: i === window, palette: colors, handle: i === 1 };
    let mesh;
    if (makeSection) mesh = makeSection(i, spec);
    else {
      mesh = new THREE.Mesh(sectionGeometry(spec), panelMaterial());
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    mesh.name = `gate:${id}:section:${i}`;
    root.add(mesh);
    meshes.push(mesh);
  }

  const progress = createProgress({ duration, initial: initialOpen ? 1 : 0 });
  const machine = createStateMachine({
    initial: initialOpen ? 'open' : 'closed',
    transitions: GATE_TRANSITIONS,
  });

  /** Точка направляющей на расстоянии s от пола вдоль пути. */
  function track(s) {
    if (s <= height) return { y: s, z: 0, angle: 0 };
    if (s <= height + arc) {
      const phi = (s - height) / radius;
      return { y: height + radius * Math.sin(phi), z: -radius + radius * Math.cos(phi), angle: phi };
    }
    return { y: height + radius, z: -radius - (s - height - arc), angle: Math.PI / 2 };
  }

  function layout() {
    const L = easeInOutSine(progress.value) * travel;
    for (let i = 0; i < sections; i++) {
      const p = track(panel * (i + 0.5) + L);
      meshes[i].position.set(0, p.y, p.z);
      meshes[i].rotation.set(-p.angle, 0, 0);
    }
  }
  layout();

  function sync() {
    const v = progress.value;
    if (v === progress.target) machine.force(v >= 1 ? 'open' : 'closed');
    else machine.force(progress.target > v ? 'opening' : 'closing');
  }

  const object = createAnimatedObject({
    id,
    root,
    parts: { sections: meshes },
    machine,
    update(dt) {
      if (!progress.update(dt)) return;
      layout();
      sync();
    },
    api: {
      get progress() { return progress.value; },
      get isOpen() { return progress.target === 1 && progress.value === 1; },
      /** Хотят ли ворота открытыми (цель движения), даже если ещё не доехали. */
      get wantsOpen() { return progress.target === 1; },
      /** Створки не в проёме: коллизия проёма должна быть снята только тогда. */
      get passable() { return progress.value >= PASSABLE_PROGRESS; },
      get blocking() { return !(progress.value >= PASSABLE_PROGRESS); },
      get label() { return progress.target === 1 ? GATE_LABELS.close : GATE_LABELS.open; },
      open(advance = 0) { progress.go(1, advance); layout(); sync(); return progress.moving || progress.value === 1; },
      close(advance = 0) { progress.go(0, advance); layout(); sync(); return progress.moving || progress.value === 0; },
      toggle() { return progress.target === 1 ? object.close() : object.open(); },
      /** Состояние с сервера: куда едут ворота и сколько миллисекунд назад началось движение. */
      applyRemote({ open, ageMs = 0, progress: remoteProgress, elapsedMs = 0 }) {
        if (Number.isFinite(remoteProgress)) {
          progress.jump(remoteProgress);
          progress.go(open ? 1 : 0, Math.max(0, elapsedMs) / 1000);
          layout();
          sync();
          return;
        }
        const age = Math.max(0, ageMs) / 1000;
        if (progress.target === (open ? 1 : 0) && !progress.moving) return;
        progress.go(open ? 1 : 0, age);
        layout();
        sync();
      },
      travel,
      sectionCount: sections,
    },
  });
  object.setState = (next) => (next === 'opening' ? object.open() : next === 'closing' ? object.close() : false);
  return object;
}

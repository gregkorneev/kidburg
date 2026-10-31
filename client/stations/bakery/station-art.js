import * as THREE from 'three';
import { createPrefabKit } from '../../engine/art/prefab-kit.js';
import { PALETTE } from '../../engine/art/palette.js';
import { stdMat } from '../../engine/art/materials.js';
import { QUALITY_PRESETS } from '../../engine/art/quality.js';
import { ROOM } from './layout.js';

const color = (value) => Number.parseInt(value.replace('#', ''), 16);
const C = {
  cream: color(PALETTE.plaster), pale: color(PALETTE.trim), peach: 0xe8b491,
  floor: color(PALETTE.concrete), tile: color(PALETTE.paver), wood: color(PALETTE.wood),
  darkWood: color(PALETTE.woodDark), brick: color(PALETTE.brick), roof: color(PALETTE.roof),
  glass: color(PALETTE.glass), bread: 0xb87939, pastry: 0xdca45e,
  green: color(PALETTE.green), gold: color(PALETTE.yellow), chalk: color(PALETTE.charcoal),
};

/** Статичная внутренняя оболочка и крупное оборудование, сведённые в одну vertex-color геометрию. */
export function buildBakeryInteriorGeometry({ detail = true, includeBase = true } = {}) {
  const k = createPrefabKit({ seed: detail ? 54 : 53, tint: 0.025 });
  const width = ROOM.maxX - ROOM.minX;
  const depth = ROOM.maxZ - ROOM.minZ;
  const midX = (ROOM.minX + ROOM.maxX) / 2;
  const midZ = (ROOM.minZ + ROOM.maxZ) / 2;

  if (includeBase) {
  // Тёплый пол, три стены и открытый вход по центру передней стены.
  k.slab(width, 0.24, depth, midX, 0, midZ, C.floor, { r: 0.06 });
  k.slab(width, ROOM.wallHeight, 0.32, midX, 0.24, ROOM.minZ + 0.16, C.cream, { r: 0.08 });
  k.slab(0.32, ROOM.wallHeight, depth, ROOM.minX + 0.16, 0.24, midZ, C.cream, { r: 0.08 });
  k.slab(0.32, ROOM.wallHeight, depth, ROOM.maxX - 0.16, 0.24, midZ, C.cream, { r: 0.08 });
  k.slab(5.7, 4.8, 0.32, -5.65, 0.24, ROOM.maxZ - 0.16, C.cream, { r: 0.06 });
  k.slab(5.7, 4.8, 0.32, 5.65, 0.24, ROOM.maxZ - 0.16, C.cream, { r: 0.06 });
  // Окантовка и открытые стойки обозначают вход, не перекрывая проход.
  for (const x of [-1.55, 1.55]) {
    k.slab(0.22, 4.8, 0.38, x, 0.24, 6.18, C.peach, { r: 0.05 });
    k.box(0.3, 0.2, 0.55, x, 5.15, 6.12, C.pale, { r: 0.05 });
  }
  // Тёплые балки помогают читать объём сверху, но потолок оставлен открытым для камеры.
  for (const z of [-4.5, -1.5, 1.5, 4.5]) k.box(16.4, 0.16, 0.22, 0, 5.72, z, C.wood, { r: 0.05 });
  k.box(0.12, 5.6, 0.16, 0, 3.0, -6.12, C.peach);
  k.box(16.5, 0.18, 0.2, 0, 5.45, -6.12, C.pale, { r: 0.04 });

  // Ингредиентная стойка. Рабочая зона игрока находится перед ней, у прохода.
  k.slab(2.3, 0.18, 1.25, -6.2, 0.92, 0.53, C.wood, { r: 0.06 });
  for (const x of [-7.1, -5.3]) k.slab(0.14, 0.92, 0.14, x, 0, 0.53, C.darkWood, { r: 0.03 });
  k.box(0.52, 0.36, 0.38, -6.75, 1.22, 0.46, C.pale, { r: 0.08 }); // мука
  k.box(0.42, 0.26, 0.36, -5.85, 1.17, 0.5, C.brick, { r: 0.07 }); // дрожжи
  k.cyl(0.28, 0.32, 0.36, 10, -5.55, 1.19, 0.52, C.gold);
  k.box(0.5, 0.08, 0.35, -6.15, 1.42, 0.48, C.chalk, { r: 0.03 }); // условная табличка заказа
  // Низкая стойка наставника обозначает место беседы и оставляет игроку свободный подход.
  k.slab(1.75, 0.12, 0.55, -6.2, 0.92, 2.48, C.wood, { r: 0.05 });
  for (const x of [-6.9, -5.5]) k.slab(0.12, 0.92, 0.12, x, 0, 2.48, C.darkWood, { r: 0.03 });

  // Стол замеса и формовки.
  k.slab(3.3, 0.18, 1.25, 0, 0.95, -4.62, C.wood, { r: 0.07 });
  for (const x of [-1.42, 1.42]) for (const z of [-5.05, -4.19]) k.slab(0.14, 0.95, 0.14, x, 0, z, C.darkWood, { r: 0.03 });
  k.cyl(0.42, 0.42, 0.12, 12, -0.75, 1.12, -4.58, C.pale);
  k.cyl(0.31, 0.31, 0.1, 12, 0.8, 1.12, -4.58, C.gold);
  k.box(0.85, 0.09, 0.12, 0, 1.09, -4.18, C.darkWood, { r: 0.04 }); // скалка

  // Закрытая печь: цельный корпус, тёмное окно и ручки; никаких игровых опасных состояний.
  k.slab(2.4, 2.15, 1.45, 5, 0.24, -1.15, C.brick, { r: 0.1 });
  k.box(1.45, 1.15, 0.12, 5, 1.65, -0.39, C.chalk, { r: 0.08 });
  k.box(0.1, 0.4, 0.16, 5.68, 1.62, -0.27, C.gold, { r: 0.04 });
  k.box(0.16, 0.16, 0.18, 5.0, 2.54, -0.3, C.green, { r: 0.06, tinted: false });
  k.box(2.65, 0.16, 1.65, 5, 2.48, -1.15, C.pale, { r: 0.06 });

  // Полка охлаждения и стойка выдачи — отдельные, с широким проходом между ними.
  for (const x of [4.15, 6.05]) k.slab(0.12, 2.5, 0.12, x, 0, 4.8, C.darkWood, { r: 0.03 });
  for (const y of [0.85, 1.65, 2.45]) k.box(2.05, 0.12, 0.95, 5.1, y, 4.8, C.wood, { r: 0.05 });
  k.slab(2.8, 1.05, 1.0, -2.2, 0.25, 5.7, C.wood, { r: 0.08 });
  k.box(2.55, 0.15, 0.82, -2.2, 1.37, 5.7, C.pale, { r: 0.06 });
  for (const x of [-3.35, -1.05]) k.slab(0.13, 1.0, 0.13, x, 0.25, 5.7, C.darkWood, { r: 0.03 });

  // Каменная плитка обозначает проход от входа к рабочим зонам.
  k.flatShape([[-1.1, 5.6], [1.1, 5.6], [1.1, -1.75], [2.2, -1.75], [2.2, -2.6], [-1.1, -2.6]], 0.245, 0.018, C.tile);
  }

  if (detail) {
    // Небольшие силуэты посуды; геометрия продукта создаётся отдельно и меняется по этапам.
    for (let i = 0; i < 3; i++) k.box(0.36, 0.1, 0.28, -6.8 + i * 0.55, 1.52, 0.46, i === 1 ? C.brick : C.gold, { r: 0.04 });
    k.box(0.55, 0.07, 0.14, -2.2, 1.5, 5.22, C.bread, { r: 0.03 }); // упаковка на стойке
  }

  return k.build({ groundAO: { height: 2, strength: 0.28 }, bands: [{ y0: 5.25, y1: 5.55, strength: 0.12 }] });
}

/** Создаёт общий интерьер, цель-маркер и ресурсы с полным локальным lifecycle. */
export function createBakeryInterior({ quality = 'medium' } = {}) {
  const group = new THREE.Group();
  group.name = 'bakery-interior';
  const material = stdMat(0xffffff, { vertexColors: true, roughness: 0.88 });
  const baseGeometry = buildBakeryInteriorGeometry({ detail: false, includeBase: true });
  const detailGeometry = buildBakeryInteriorGeometry({ detail: true, includeBase: false });
  const base = new THREE.Mesh(baseGeometry, material);
  const detail = new THREE.Mesh(detailGeometry, material);
  base.castShadow = detail.castShadow = true;
  base.receiveShadow = detail.receiveShadow = true;
  base.name = 'bakery-static';
  detail.name = 'bakery-detail';
  group.add(base, detail);

  const productMaterial = material;
  const makeProduct = (stage, seed, productColor, scale, position) => {
    const kit = createPrefabKit({ seed, tint: 0.02 });
    kit.sphere(0.34, 0, 0, 0, productColor, { s: scale, w: 9, h: 6 });
    const geometry = kit.build({ groundAO: null, underside: 1 });
    const mesh = new THREE.Mesh(geometry, productMaterial);
    mesh.position.set(...position);
    mesh.visible = false;
    mesh.name = `bakery-product-${stage}`;
    group.add(mesh);
    return mesh;
  };
  const dough = makeProduct('dough', 61, C.pale, [1.25, 0.75, 0.9], [0, 1.55, -4.58]);
  const loaf = makeProduct('loaf', 62, C.bread, [1.45, 0.8, 0.86], [5.05, 1.55, 4.78]);

  const markerGroup = new THREE.Group();
  const ringGeometry = new THREE.RingGeometry(0.72, 0.86, 28);
  ringGeometry.rotateX(-Math.PI / 2);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: PALETTE.yellow, transparent: true, opacity: 0.76, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.position.y = 0.035;
  const diamondGeometry = new THREE.OctahedronGeometry(0.2, 0);
  const diamondMaterial = new THREE.MeshBasicMaterial({ color: PALETTE.orange });
  const diamond = new THREE.Mesh(diamondGeometry, diamondMaterial);
  diamond.position.y = 2.0;
  markerGroup.add(ring, diamond);
  markerGroup.visible = false;
  group.add(markerGroup);

  let currentQuality = QUALITY_PRESETS[quality] ? quality : 'medium';
  let currentStage = 'waiting_order';
  const setQuality = (level) => {
    currentQuality = QUALITY_PRESETS[level] ? level : 'medium';
    detail.visible = currentQuality !== 'low';
    dough.visible = currentQuality !== 'low' && currentStage === 'product_shaped';
    loaf.visible = currentStage === 'product_baked' || currentStage === 'product_ready';
    markerGroup.visible = Boolean(markerGroup.userData.target);
    return currentQuality;
  };
  setQuality(currentQuality);
  const setStage = (stage) => {
    currentStage = stage;
    dough.visible = currentQuality !== 'low' && stage === 'product_shaped';
    loaf.visible = stage === 'product_baked' || stage === 'product_ready';
    if (stage === 'product_ready') loaf.position.set(-2.2, 1.55, 5.7);
    else loaf.position.set(5.05, 1.55, 4.78);
  };
  setStage(currentStage);

  return {
    group,
    setQuality,
    setStage,
    setTarget(position) {
      markerGroup.userData.target = position;
      markerGroup.visible = Boolean(position);
      if (position) markerGroup.position.set(position.x, 0, position.z);
    },
    update(_dt, elapsed) {
      if (markerGroup.visible) {
        const pulse = 1 + Math.sin(elapsed * 3.1) * 0.055;
        ring.scale.setScalar(pulse);
        ringMaterial.opacity = 0.58 + Math.sin(elapsed * 3.1) * 0.17;
        diamond.position.y = 1.9 + Math.sin(elapsed * 2.3) * 0.11;
        diamond.rotation.y = elapsed * 1.4;
      }
    },
    dispose() {
      group.removeFromParent();
      baseGeometry.dispose();
      detailGeometry.dispose();
      dough.geometry.dispose();
      loaf.geometry.dispose();
      ringGeometry.dispose();
      ringMaterial.dispose();
      diamondGeometry.dispose();
      diamondMaterial.dispose();
    },
  };
}

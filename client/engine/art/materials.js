// Общие материалы, геометрии и процедурные текстуры. Всё создаётся лениво и один раз:
// модули можно импортировать в Node (тесты) без DOM, а персонажи и растения не плодят ресурсы.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const materials = new Map();
const geometries = new Map();
const textures = new Map();

/** Материал в стиле Kidburg: мягкий PBR без металла, кешируется по параметрам. */
export function stdMat(color, options = {}) {
  const key = `${color}|${JSON.stringify(options)}`;
  let material = materials.get(key);
  if (!material) {
    const { roughness = 0.78, metalness = 0, ...rest } = options;
    material = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...rest });
    material.userData.shared = true;
    materials.set(key, material);
  }
  return material;
}

/** Геометрия, общая для всех экземпляров; помечена, чтобы disposeModel её не освобождал. */
export function sharedGeometry(key, factory) {
  let geometry = geometries.get(key);
  if (!geometry) {
    geometry = factory();
    geometry.userData.shared = true;
    geometries.set(key, geometry);
  }
  return geometry;
}

export const isSharedResource = (resource) => Boolean(resource?.userData?.shared);

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Процедурная текстура. В окружении без DOM возвращает null — материал остаётся однотонным. */
export function canvasTexture(key, size, draw, { repeat = null, srgb = true } = {}) {
  if (textures.has(key)) return textures.get(key);
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d'), size, rng(key.length * 7919 + size));
  const texture = new THREE.CanvasTexture(canvas);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat[0], repeat[1]);
  }
  texture.anisotropy = 4;
  texture.userData.shared = true;
  textures.set(key, texture);
  return texture;
}

const speckle = (ctx, size, random, colors, count, radius) => {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(random() * colors.length)];
    ctx.globalAlpha = 0.25 + random() * 0.45;
    ctx.beginPath();
    ctx.arc(random() * size, random() * size, radius * (0.4 + random()), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
};

/** Набор текстур покрытий. repeat задаёт плотность на единицу площади материала. */
export const surfaceTextures = {
  grass: (repeat = [1, 1]) => canvasTexture('grass', 256, (ctx, size, random) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, random, ['#e8f3d8', '#d3e6c0', '#f4fae9'], 220, 7);
    speckle(ctx, size, random, ['#c4dcae'], 90, 3);
  }, { repeat }),
  pavers: (repeat = [1, 1]) => canvasTexture('pavers', 256, (ctx, size, random) => {
    const tones = ['#fff4d8', '#f6e6c0', '#ecdbb2', '#fbeccb'];
    const n = 4;
    const s = size / n;
    ctx.strokeStyle = '#cdb98d';
    ctx.lineWidth = 3;
    for (let y = 0; y < n; y++) {
      const offset = (y % 2) * s / 2;
      for (let x = -1; x < n; x++) {
        ctx.fillStyle = tones[Math.floor(random() * tones.length)];
        ctx.fillRect(x * s + offset, y * s, s, s);
        ctx.strokeRect(x * s + offset, y * s, s, s);
      }
    }
  }, { repeat }),
  concrete: (repeat = [1, 1]) => canvasTexture('concrete', 256, (ctx, size, random) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, random, ['#e9e6dc', '#f7f4ea', '#d9d5c8'], 320, 3.5);
    ctx.strokeStyle = '#cfcabc';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, size - 3, size - 3);
  }, { repeat }),
  bricks: (repeat = [1, 1]) => canvasTexture('bricks', 256, (ctx, size, random) => {
    ctx.fillStyle = '#ecdcc2';
    ctx.fillRect(0, 0, size, size);
    const rows = 8;
    const cols = 4;
    const h = size / rows;
    const w = size / cols;
    const tones = ['#e98b70', '#d9775e', '#e39a7e', '#ef9d83'];
    for (let r = 0; r < rows; r++) {
      for (let c = -1; c < cols; c++) {
        ctx.fillStyle = tones[Math.floor(random() * tones.length)];
        ctx.fillRect(c * w + (r % 2) * (w / 2) + 3, r * h + 3, w - 6, h - 6);
      }
    }
  }, { repeat }),
  roofTiles: (repeat = [1, 1]) => canvasTexture('roofTiles', 256, (ctx, size, random) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    const rows = 8;
    const h = size / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 8; c++) {
        const shade = 0.88 + random() * 0.12;
        ctx.fillStyle = `rgb(${Math.round(255 * shade)},${Math.round(236 * shade)},${Math.round(226 * shade)})`;
        const w = size / 8;
        ctx.beginPath();
        ctx.roundRect(c * w + (r % 2) * w / 2 - w / 2 + 2, r * h + 1, w - 3, h + 3, 6);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(120,60,50,0.32)';
      ctx.fillRect(0, r * h + h - 3, size, 3);
    }
  }, { repeat }),
  plaster: (repeat = [1, 1]) => canvasTexture('plaster', 128, (ctx, size, random) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, random, ['#f1ead8', '#fffdf4', '#e8dfc8'], 160, 2.5);
  }, { repeat }),
};

/** Мягкое радиальное пятно (альфа-маска) для контактных теней и цветовых разводов земли. */
export function softBlobTexture() {
  return canvasTexture('softBlob', 128, (ctx, size) => {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.55, 'rgba(255,255,255,0.55)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }, { srgb: false });
}

/** Круглая контактная тень под персонажем/предметом. Без DOM возвращает пустую группу. */
export function createContactShadow(radiusX, radiusZ = radiusX, opacity = 0.34) {
  const map = softBlobTexture();
  if (!map) return new THREE.Group();
  const material = materials.get(`shadow|${opacity}`) ?? (() => {
    const m = new THREE.MeshBasicMaterial({ color: '#1f2b25', map, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    m.userData.shared = true;
    materials.set(`shadow|${opacity}`, m);
    return m;
  })();
  const geometry = sharedGeometry('shadowPlane', () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.set(radiusX * 2, 1, radiusZ * 2);
  mesh.position.y = 0.03;
  mesh.renderOrder = 1;
  return mesh;
}

/** Предрасчитанное затемнение у основания: чем ближе вершина к земле, тем темнее (vertex AO). */
export function bakeGroundAO(geometry, { height = 1.6, strength = 0.38, baseY = 0 } = {}) {
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i) - baseY;
    const k = 1 - strength * Math.exp(-Math.max(0, y) / (height * 0.45));
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = k;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

export function disposeSharedArt() {
  for (const m of materials.values()) m.dispose();
  for (const g of geometries.values()) g.dispose();
  for (const t of textures.values()) t.dispose();
  materials.clear();
  geometries.clear();
  textures.clear();
}

// ── Архитектурные помощники ────────────────────────────────────────────────

/** Скруглённый параллелепипед с общей геометрией: фаски вместо острых рёбер. */
export function roundedBox(w, h, d, radius = 0.06, segments = Math.min(w, h, d) > 0.5 ? 2 : 1) {
  return sharedGeometry(`rbox:${w}:${h}:${d}:${radius}:${segments}`, () => new RoundedBoxGeometry(w, h, d, segments, radius));
}

/** Параллелепипед с UV в метрах: текстура ложится с одинаковой плотностью на любую грань. */
export function worldUVBox(w, h, d, tile = 2, { aoHeight = 0, aoStrength = 0.4, heightSegments = 1 } = {}) {
  return sharedGeometry(`wbox:${w}:${h}:${d}:${tile}:${aoHeight}:${aoStrength}:${heightSegments}`, () => {
    const geometry = new THREE.BoxGeometry(w, h, d, 1, heightSegments, 1);
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const uv = geometry.attributes.uv;
    for (let i = 0; i < position.count; i++) {
      const nx = Math.abs(normal.getX(i));
      const ny = Math.abs(normal.getY(i));
      if (nx > 0.5) uv.setXY(i, position.getZ(i) / tile, position.getY(i) / tile);
      else if (ny > 0.5) uv.setXY(i, position.getX(i) / tile, position.getZ(i) / tile);
      else uv.setXY(i, position.getX(i) / tile, position.getY(i) / tile);
    }
    if (aoHeight > 0) bakeGroundAO(geometry, { height: aoHeight, strength: aoStrength, baseY: -h / 2 });
    return geometry;
  });
}

/** Материал с текстурой покрытия (плотность задаёт worldUVBox). */
export function texturedMat(color, textureKey, options = {}) {
  const texture = surfaceTextures[textureKey]?.([1, 1]);
  const key = `${color}|tex:${textureKey}|${JSON.stringify(options)}`;
  let material = materials.get(key);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color, roughness: 0.85, map: texture ?? null, ...options });
    material.userData.shared = true;
    materials.set(key, material);
  }
  return material;
}

/**
 * Склейка статических деталей в один Mesh на материал: сотни мелких деталей здания — единицы вызовов отрисовки.
 * Для материала с vertexColors геометрии без цвета получают белый цвет.
 */
export function createBatch() {
  const lists = new Map();
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const base = new THREE.Matrix4();
  return {
    /** Выполняет fn так, будто все add() вложены в группу с позицией pos и поворотом rotY (окна на боковых стенах). */
    at(pos, rotY, fn) {
      const previous = base.clone();
      base.multiply(new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(1, 1, 1)));
      fn();
      base.copy(previous);
    },
    add(geometry, material, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
      const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      g.applyMatrix4(matrix.compose(new THREE.Vector3(...pos), quaternion.setFromEuler(euler.set(...rot)), new THREE.Vector3(...scale)));
      g.applyMatrix4(base);
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
      if (material.vertexColors && !g.attributes.color) {
        g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
      } else if (!material.vertexColors && g.attributes.color) g.deleteAttribute('color');
      if (!lists.has(material)) lists.set(material, []);
      lists.get(material).push(g);
    },
    build({ cast = true, receive = true } = {}) {
      const group = new THREE.Group();
      for (const [material, list] of lists) {
        const mesh = new THREE.Mesh(mergeGeometries(list, false), material);
        mesh.castShadow = cast;
        mesh.receiveShadow = receive;
        group.add(mesh);
        for (const g of list) g.dispose();
      }
      lists.clear();
      return group;
    },
  };
}

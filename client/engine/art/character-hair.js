// Причёски: тонкая оболочка по форме черепа + выразительные пряди-капли. Верх (под каску/шапку) и боковые/задние
// пряди — разные Mesh, поэтому защитная экипировка прячет только макушку, а волосы у висков и на затылке остаются.
import * as THREE from 'three';
import { sharedGeometry, stdMat } from './materials.js';
import { HEAD_RADII, bake, blobPart, mergeParts, unit } from './character-geometry.js';

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const CUT = 1.02; // полярный угол: выше — «макушка» (прячется под каску), ниже — виски и затылок

/** Точка на поверхности черепа: θ — от макушки (0) вниз, φ — вокруг, 0 = вперёд. */
function skull(theta, phi, k = 1.08) {
  return [HEAD_RADII.x * k * Math.sin(theta) * Math.sin(phi), HEAD_RADII.y * k * Math.cos(theta), HEAD_RADII.z * k * Math.sin(theta) * Math.cos(phi)];
}

function edgeTheta({ front, side, back }, phi) {
  const c = Math.cos(phi);
  return c >= 0 ? lerp(side, front, smooth(0.05, 0.95, c)) : lerp(side, back, smooth(0.0, 0.9, -c));
}

/** Сетка оболочки: rows × cols, шов замкнут без дублей, нормали считаются сглаженно. */
function shell(profile, part, detail) {
  const cols = [12, 20, 34][detail];
  const rows = [3, 4, 7][detail];
  const positions = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++) {
      const phi = (c / cols) * Math.PI * 2;
      const edge = edgeTheta(profile, phi);
      const cut = Math.min(edge, CUT);
      const [from, to] = part === 'top' ? [0, cut] : [cut, edge];
      const theta = lerp(from, to, r / rows);
      const bulge = 1 + (profile.volume ?? 0) * Math.sin(Math.min(Math.PI, theta * 1.6)) * 1;
      positions.push(...skull(theta, phi, (profile.thick ?? 1.08) * bulge));
    }
  }
  const index = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * cols + c;
      const b = r * cols + ((c + 1) % cols);
      index.push(a, a + cols, b, b, a + cols, b + cols);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

const SHELLS = {
  short: { front: 0.9, side: 1.42, back: 1.95, thick: 1.08, volume: 0.05 },
  sidePart: { front: 0.86, side: 1.4, back: 1.9, thick: 1.08, volume: 0.04 },
  bob: { front: 0.85, side: 1.9, back: 2.15, thick: 1.09 },
  long: { front: 0.84, side: 1.75, back: 2.2, thick: 1.09 },
  curly: { front: 0.82, side: 1.5, back: 2.0, thick: 1.12, volume: 0.1 },
  wavy: { front: 0.85, side: 1.7, back: 2.1, thick: 1.1, volume: 0.05 },
  spiky: { front: 0.92, side: 1.35, back: 1.8, thick: 1.06 },
  messy: { front: 0.86, side: 1.5, back: 2.0, thick: 1.1, volume: 0.08 },
  bun: { front: 0.9, side: 1.45, back: 1.95, thick: 1.07 },
  updo: { front: 0.78, side: 1.3, back: 1.75, thick: 1.06 },
  ponytail: { front: 0.88, side: 1.55, back: 1.95, thick: 1.08 },
  lowTail: { front: 0.88, side: 1.5, back: 1.95, thick: 1.08 },
  sweep: { front: 0.78, side: 1.35, back: 1.85, thick: 1.07, volume: 0.05 },
};

/**
 * Пряди и объёмы стиля в виде списков запечённых геометрий: top, back, tie и хвост (tail).
 * Всё независимо от цвета, поэтому склеивается один раз на (стиль, детализацию) и делится между людьми.
 */
function recipe(style, d) {
  const top = [];
  const back = [];
  const tie = [];
  const tail = [];
  const rich = d >= 1;
  const seg = [[6, 4], [8, 6], [14, 9]][d];
  const lock = (list, p, w, l, rot = [0, 0, 0], depth = 0.8) => list.push(bake(unit.drop(), p, [w, l, w * depth], rot));
  const puff = (list, p, s, rot = [0, 0, 0]) => list.push(blobPart(p, s, rot, seg));
  const spike = (list, p, w, l, rot) => list.push(bake(unit.cone(), p, [w, l, w], rot));
  // Чёлка: пряди вдоль линии лба, падающие вниз и чуть вперёд.
  const fringe = (n, spread, theta, len, width, lean = 0, shift = 0) => {
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const phi = lerp(-spread, spread, t) + shift;
      const [x, y, z] = skull(theta, phi, 1.06);
      lock(top, [x, y - len * 0.38, z + 0.01], width, len, [0.34, 0, -Math.sin(phi) * 0.5 + lean]);
    }
  };
  const sideStrand = (side, y, z, w, l, tilt = 0.08) => lock(back, [side * 0.46, y, z], w, l, [0, 0, side * tilt], 0.85);
  switch (style) {
    case 'sidePart':
      fringe(rich ? 3 : 2, 0.55, 0.8, 0.2, 0.15, 0.05, -0.25);
      lock(top, [0.12, 0.3, 0.33], 0.28, 0.22, [0.5, 0.2, -0.95]);
      puff(top, [-0.2, 0.34, 0.1], [0.26, 0.15, 0.3], [0, 0, 0.5]);
      break;
    case 'bob':
      fringe(rich ? 5 : 3, 0.72, 0.8, 0.17, 0.13, 0, 0);
      sideStrand(-1, -0.1, 0.0, 0.2, 0.52);
      sideStrand(1, -0.1, 0.0, 0.2, 0.52);
      lock(back, [0, -0.1, -0.33], 0.5, 0.5, [0, 0, 0], 0.4);
      break;
    case 'long':
      fringe(rich ? 5 : 3, 0.7, 0.8, 0.18, 0.13);
      sideStrand(-1, -0.28, 0.02, 0.2, 0.8);
      sideStrand(1, -0.28, 0.02, 0.2, 0.8);
      lock(back, [0, -0.38, -0.3], 0.52, 0.95, [0.08, 0, 0], 0.4);
      break;
    case 'curly': {
      const n = rich ? 16 : 9;
      for (let i = 0; i < n; i++) {
        const phi = (i / n) * Math.PI * 2 + (i % 2) * 0.2;
        const theta = 0.55 + (i % 3) * 0.28 + (rich ? 0.0 : 0.1);
        const [x, y, z] = skull(theta, phi, 1.12);
        const r = 0.13 + (i % 3) * 0.018;
        const target = Math.abs(Math.cos(phi)) > 0.55 && Math.cos(phi) > 0 && theta > 0.75 ? top : theta > 1.1 ? back : top;
        puff(target, [x, y, z], [r, r, r]);
      }
      puff(top, [0, 0.47, -0.02], [0.22, 0.14, 0.22]);
      puff(back, [-0.4, -0.04, -0.08], [0.12, 0.17, 0.14]);
      puff(back, [0.4, -0.04, -0.08], [0.12, 0.17, 0.14]);
      break;
    }
    case 'wavy': {
      fringe(rich ? 4 : 3, 0.65, 0.8, 0.18, 0.14, 0.1);
      for (const side of [-1, 1]) {
        for (let i = 0; i < (rich ? 3 : 2); i++) {
          puff(back, [side * (0.46 + (i % 2) * 0.05), -0.05 - i * 0.2, -0.05 - i * 0.03], [0.13, 0.15, 0.17], [0, 0, side * 0.25]);
        }
      }
      for (let i = 0; i < (rich ? 4 : 2); i++) puff(back, [(i - 1.5) * 0.17, -0.2 - (i % 2) * 0.08, -0.34], [0.2, 0.3, 0.14]);
      lock(back, [0, -0.1, -0.3], 0.5, 0.55, [0, 0, 0], 0.4);
      break;
    }
    case 'spiky': {
      const n = rich ? 7 : 5;
      for (let i = 0; i < n; i++) {
        const phi = (i / n) * Math.PI * 2;
        const [x, y, z] = skull(0.55, phi, 1.0);
        spike(top, [x, y + 0.12, z], 0.14, 0.34, [Math.cos(phi) * 0.55, 0, -Math.sin(phi) * 0.55]);
      }
      spike(top, [0, 0.55, 0.05], 0.15, 0.34, [0.1, 0, 0]);
      fringe(3, 0.5, 0.82, 0.15, 0.13, 0.25);
      break;
    }
    case 'messy':
      fringe(rich ? 5 : 3, 0.75, 0.78, 0.2, 0.15, 0.3);
      lock(top, [0.25, 0.4, 0.1], 0.2, 0.34, [0.3, 0.5, -1.0]);
      lock(top, [-0.28, 0.38, -0.05], 0.2, 0.3, [-0.2, 0, 1.1]);
      lock(top, [0.05, 0.5, -0.12], 0.18, 0.3, [-0.8, 0.3, 0.4]);
      if (rich) lock(top, [-0.1, 0.46, 0.2], 0.16, 0.26, [0.7, 0, 0.7]);
      lock(back, [0.25, -0.05, -0.34], 0.2, 0.34, [0.1, 0, 0.5]);
      lock(back, [-0.2, -0.04, -0.34], 0.2, 0.3, [0.1, 0, -0.5]);
      break;
    case 'bun':
      fringe(rich ? 4 : 3, 0.6, 0.82, 0.15, 0.13, 0.05);
      puff(back, [0, 0.46, -0.28], [0.21, 0.2, 0.21]);
      puff(back, [0, 0.46, -0.28], [0.12, 0.12, 0.12]);
      tie.push(bake(unit.torus(), [0, 0.37, -0.25], [0.2, 0.2, 0.2], [Math.PI / 2 - 0.35, 0, 0]));
      break;
    case 'updo':
      fringe(rich ? 3 : 2, 0.5, 0.74, 0.12, 0.12, 0.0);
      puff(top, [0, 0.62, -0.05], [0.3, 0.28, 0.3]);
      puff(top, [0.02, 0.88, -0.07], [0.22, 0.2, 0.22]);
      if (rich) puff(top, [0.0, 1.06, -0.08], [0.12, 0.12, 0.12]);
      tie.push(bake(unit.torus(), [0, 0.5, -0.06], [0.27, 0.27, 0.27], [Math.PI / 2, 0, 0]));
      sideStrand(-1, 0.0, 0.02, 0.1, 0.36, 0.2);
      sideStrand(1, 0.0, 0.02, 0.1, 0.36, 0.2);
      break;
    case 'ponytail':
      fringe(rich ? 4 : 3, 0.65, 0.8, 0.17, 0.13, 0.1);
      sideStrand(-1, -0.06, 0.0, 0.14, 0.4);
      sideStrand(1, -0.06, 0.0, 0.14, 0.4);
      puff(back, [0, 0.0, -0.31], [0.4, 0.34, 0.15]);
      lock(tail, [0, -0.26, -0.08], 0.17, 0.58, [0.1, 0, 0], 0.85);
      tie.push(bake(unit.torus(), [0, 0.0, 0.0], [0.1, 0.1, 0.1], [Math.PI / 2, 0, 0]));
      break;
    case 'lowTail':
      fringe(rich ? 4 : 3, 0.6, 0.8, 0.16, 0.13, -0.05);
      sideStrand(-1, -0.02, 0.0, 0.12, 0.34);
      sideStrand(1, -0.02, 0.0, 0.12, 0.34);
      puff(back, [0, -0.08, -0.31], [0.3, 0.26, 0.13]);
      lock(tail, [0, -0.3, -0.06], 0.15, 0.62, [0.1, 0, -0.1], 0.85);
      tie.push(bake(unit.torus(), [0, 0.0, 0.0], [0.09, 0.09, 0.09], [Math.PI / 2, 0, 0]));
      break;
    case 'sweep':
      lock(top, [-0.12, 0.32, 0.34], 0.36, 0.3, [0.45, 0.2, 0.9]);
      lock(top, [0.12, 0.33, 0.35], 0.22, 0.34, [0.5, 0, 1.15]);
      lock(top, [0.3, 0.3, 0.3], 0.18, 0.26, [0.4, 0, 1.0]);
      puff(top, [0.18, 0.38, 0.12], [0.3, 0.16, 0.3], [0.1, 0, 0.35]);
      sideStrand(-1, -0.05, 0.0, 0.14, 0.34);
      lock(back, [0, -0.05, -0.32], 0.46, 0.4, [0, 0, 0], 0.4);
      break;
    default: // short
      fringe(rich ? 5 : 3, 0.65, 0.84, 0.15, 0.13, 0.05);
      lock(top, [0.1, 0.4, 0.2], 0.22, 0.24, [0.7, 0.1, -0.55]);
      lock(back, [0, -0.0, -0.31], 0.44, 0.34, [0, 0, 0], 0.4);
  }
  return { top, back, tie, tail };
}

function cached(key, make) {
  return sharedGeometry(key, make);
}

function geometries(style, detail) {
  const key = `c:hair:${style}:${detail}`;
  const profile = SHELLS[style] ?? SHELLS.short;
  const r = recipe(style, detail);
  const topShell = () => shell(profile, 'top', detail);
  const lowShell = () => shell(profile, 'low', detail);
  const merge = (shellMaker, list) => {
    const parts = [...(shellMaker ? [shellMaker()] : []), ...list].map((g) => { const p = g.index ? g.toNonIndexed() : g.clone(); for (const name of Object.keys(p.attributes)) if (name !== 'position' && name !== 'normal') p.deleteAttribute(name); return p; });
    return parts.length ? mergeParts(parts) : null;
  };
  return {
    top: cached(`${key}:top`, () => merge(topShell, r.top)),
    back: cached(`${key}:back`, () => merge(lowShell, r.back)),
    tie: r.tie.length ? cached(`${key}:tie`, () => merge(null, r.tie)) : null,
    tail: r.tail.length ? cached(`${key}:tail`, () => merge(null, r.tail)) : null,
  };
}

/** Строит причёску: {top, back, tie, tail, groups}. top прячется под каской/шапкой; back и хвост видны всегда. */
export function buildHair(head, style, hairMaterial, { detail = 1, tieColor = '#f4c94d' } = {}) {
  const g = geometries(style, detail);
  const top = new THREE.Group();
  const back = new THREE.Group();
  head.add(top, back);
  const add = (parent, geometry, material, cast = true) => {
    if (!geometry) return null;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = cast;
    parent.add(mesh);
    return mesh;
  };
  add(top, g.top, hairMaterial);
  add(back, g.back, hairMaterial);
  let tail = null;
  if (g.tail) {
    tail = new THREE.Group();
    const anchor = style === 'ponytail' ? [0, 0.2, -0.42] : [0.1, -0.2, -0.4];
    tail.position.set(...anchor);
    back.add(tail);
    add(tail, g.tail, hairMaterial);
    if (g.tie) {
      const tieMaterial = stdMat(tieColor, { roughness: 0.5 });
      add(tail, g.tie, tieMaterial, false);
    }
  } else if (g.tie) {
    add(style === 'bun' || style === 'updo' ? (style === 'bun' ? back : top) : back, g.tie, stdMat(tieColor, { roughness: 0.5 }), false);
  }
  return { hair: top, hairBack: back, tail, style };
}

export { SHELLS as HAIR_SHELLS };

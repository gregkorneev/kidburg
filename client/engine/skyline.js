// Дальний силуэт города: только декорация, вне чанков и сетевого мира.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SPAWN } from '../../shared/constants.js';

function createSkylineGeometry() {
  const parts = [];
  let seed = 1847;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  const addBox = (w, h, d, x, y, z, color, ry = 0) => {
    const geometry = new THREE.BoxGeometry(w, h, d);
    geometry.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry),
      new THREE.Vector3(1, 1, 1),
    ));
    const c = new THREE.Color(color);
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(geometry);
  };

  const neighborhoods = [
    { count: 42, minRadius: 76, maxRadius: 118, minHeight: 13, maxHeight: 29, colors: [0x8c9c9b, 0x9ca69e, 0x80949a, 0xa3a99e] },
    { count: 58, minRadius: 132, maxRadius: 226, minHeight: 25, maxHeight: 76, colors: [0x758d9b, 0x8398a0, 0x9ba5a3, 0x71838f] },
  ];

  for (const district of neighborhoods) {
    for (let i = 0; i < district.count; i++) {
      const angle = (i / district.count) * Math.PI * 2 + (random() - 0.5) * 0.08;
      const radius = district.minRadius + random() * (district.maxRadius - district.minRadius);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const width = 8 + random() * 11;
      const depth = 8 + random() * 11;
      const height = district.minHeight + random() * (district.maxHeight - district.minHeight);
      const color = district.colors[Math.floor(random() * district.colors.length)];
      const facingCenter = Math.atan2(-Math.cos(angle), -Math.sin(angle));

      addBox(width, height, depth, x, height / 2, z, color, facingCenter);
      // Setbacks and rooftop blocks break up the repeated tower silhouettes.
      if (height > 30 && random() > 0.32) {
        const crownHeight = 3 + random() * 7;
        addBox(width * (0.55 + random() * 0.2), crownHeight, depth * (0.55 + random() * 0.2),
          x, height + crownHeight / 2, z, color - 0x080708, facingCenter);
      }

      // A few muted facade bands suggest windows at this distance.
      if (radius < 150) {
        const bandColor = random() > 0.5 ? 0xb8b7a5 : 0x758f98;
        const levels = Math.max(2, Math.floor(height / 5));
        for (let level = 1; level < levels; level += 2) {
          const y = level * height / levels;
          addBox(width * 0.68, 0.22, 0.08, x, y, z, bandColor, facingCenter);
        }
      }
    }
  }

  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error('Не удалось собрать дальний силуэт города');
  geometry.computeVertexNormals();
  return geometry;
}

export function createCitySkyline() {
  const geometry = createSkylineGeometry();
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(SPAWN.x, 0, SPAWN.z);
  const group = new THREE.Group();
  group.add(mesh);

  return {
    group,
    dispose() {
      group.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}

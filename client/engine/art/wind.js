// Лёгкое покачивание растений на ветру: вершинный сдвиг растёт с высотой, фаза зависит от положения экземпляра.
// Часы общие для всех материалов: город обновляет их одним вызовом updateWind() за кадр.
import * as THREE from 'three';

const windClock = { value: 0 };
const materials = new Map();

export function updateWind(elapsed) {
  windClock.value = elapsed;
}

/** MeshStandardMaterial с вершинными цветами и покачиванием; strength — амплитуда на метр высоты. */
export function swayMaterial(strength = 0.05, { roughness = 0.88 } = {}) {
  const key = `${strength}|${roughness}`;
  let material = materials.get(key);
  if (material) return material;
  material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windClock;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
        float windPhase = instanceMatrix[3].x * 0.6 + instanceMatrix[3].z * 0.45;
        #else
        float windPhase = 0.0;
        #endif
        float windSway = sin(uWindTime * 1.5 + windPhase) * position.y * ${strength.toFixed(3)};
        transformed.x += windSway;
        transformed.z += windSway * 0.7;`);
  };
  material.customProgramCacheKey = () => `city-sway-${strength}`;
  material.userData.shared = true;
  materials.set(key, material);
  return material;
}

export function disposeWind() {
  for (const m of materials.values()) m.dispose();
  materials.clear();
}

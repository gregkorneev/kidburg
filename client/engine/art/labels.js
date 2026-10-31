// Единое оформление надписей в мире: таблички предметов и имена над головами.
// Спрайт рисуется на canvas без внешних шрифтов; без DOM (тесты в Node) возвращается пустой спрайт.
import * as THREE from 'three';

const LABEL_STYLES = {
  // Табличка предмета: крупнее, с цветным акцентом слева.
  sign: { width: 512, height: 112, font: 700, size: 42, scale: [2.5, 0.55], radius: 30 },
  // Имя игрока/наставника: компактная «пилюля».
  name: { width: 384, height: 84, font: 700, size: 36, scale: [1.9, 0.42], radius: 40 },
};

export function createLabelSprite(text, { kind = 'sign', color = '#2f5545', accent = '#ed9a45', subtitle = '' } = {}) {
  const style = LABEL_STYLES[kind] ?? LABEL_STYLES.sign;
  const material = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: true, fog: false });
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = style.width;
    canvas.height = style.height;
    const ctx = canvas.getContext('2d');
    ctx.shadowColor = 'rgba(30,50,40,0.28)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = '#fffbed';
    ctx.beginPath();
    ctx.roundRect(10, 8, style.width - 20, style.height - 22, style.radius);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.roundRect(10, 8, 14, style.height - 22, [style.radius, 0, 0, style.radius]);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.font = `${style.font} ${style.size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cy = (style.height - 14) / 2 + 2;
    ctx.fillText(text, style.width / 2 + 8, subtitle ? cy - 8 : cy, style.width - 70);
    if (subtitle) {
      ctx.fillStyle = '#7a8a7f';
      ctx.font = `600 ${Math.round(style.size * 0.55)}px system-ui, sans-serif`;
      ctx.fillText(subtitle, style.width / 2 + 8, cy + style.size * 0.62, style.width - 70);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    material.map = texture;
  }
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(style.scale[0], style.scale[1], 1);
  sprite.userData.isLabel = true;
  return sprite;
}

/** Освобождает текстуру и материал спрайта-надписи. */
export function disposeLabel(sprite) {
  sprite.material.map?.dispose();
  sprite.material.dispose();
}

/**
 * Табличка на объекте: рамка из дерева и фон с текстом, нарисованным на canvas (без внешних шрифтов).
 * Единое оформление всех надписей в мире. Возвращает Mesh с плоской лицевой стороной вдоль +Z.
 */
export function createSignPlate(text, width, height, { color = '#a63a2e', background = '#fff6df', border = '#c9533e' } = {}) {
  const group = new THREE.Group();
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.14, height + 0.14, 0.1),
    new THREE.MeshStandardMaterial({ color: '#8a5a3a', roughness: 0.75 }),
  );
  frame.castShadow = true;
  group.add(frame);
  const material = new THREE.MeshStandardMaterial({ color: background, roughness: 0.7 });
  if (typeof document !== 'undefined') {
    const pixels = 96;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * pixels);
    canvas.height = Math.round(height * pixels);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = border;
    ctx.lineWidth = Math.max(4, canvas.height * 0.07);
    ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, canvas.width - ctx.lineWidth * 2, canvas.height - ctx.lineWidth * 2);
    ctx.fillStyle = color;
    ctx.font = `800 ${Math.round(canvas.height * 0.46)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + canvas.height * 0.03, canvas.width * 0.88);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    material.map = texture;
  }
  const face = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  face.position.z = 0.056;
  group.add(face);
  group.userData.isSign = true;
  return group;
}

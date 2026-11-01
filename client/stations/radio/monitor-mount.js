import * as THREE from 'three';
import { createStudioCanvas } from './studio-canvas.js';

export const MONITOR_SCREEN_WIDTH = 4.42;
export const MONITOR_SCREEN_HEIGHT = 2.68;

function makePlaceholderTexture() {
  const canvas = createStudioCanvas(960, 600);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#142934';
  ctx.fillRect(0, 0, 960, 600);
  ctx.fillStyle = '#e9b75d';
  ctx.fillRect(0, 0, 960, 84);
  ctx.fillStyle = '#283b49';
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.fillText('RADIO · STUDIO', 38, 54);
  ctx.fillStyle = '#31515a';
  ctx.font = 'bold 20px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('СТУДИЯ 01', 918, 52);
  ctx.textAlign = 'left';

  ctx.fillStyle = '#8bc9b8';
  ctx.beginPath();
  ctx.arc(68, 130, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#b8c9c7';
  ctx.font = 'bold 21px system-ui, sans-serif';
  ctx.fillText('ТЕКСТ В ЭФИР', 88, 137);

  ctx.fillStyle = '#1d3944';
  ctx.beginPath();
  ctx.roundRect(38, 164, 884, 350, 22);
  ctx.fill();
  ctx.fillStyle = '#e9b75d';
  ctx.beginPath();
  ctx.roundRect(60, 193, 7, 260, 4);
  ctx.fill();
  ctx.fillStyle = '#f8f1df';
  ctx.font = 'bold 38px system-ui, sans-serif';
  ctx.fillText('Доброе утро, друзья!', 94, 254);
  ctx.font = '31px system-ui, sans-serif';
  ctx.fillStyle = '#d5e1dc';
  ctx.fillText('Вы слушаете радио нашего города.', 94, 310);
  ctx.fillText('Сегодня расскажем, какие профессии', 94, 362);
  ctx.fillText('можно попробовать и где найти', 94, 414);
  ctx.fillText('своё дело. Оставайтесь с нами!', 94, 466);

  ctx.fillStyle = '#78939a';
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.fillText('МИКРОФОН 01', 42, 560);
  for (let index = 0; index < 19; index++) {
    const barHeight = [12, 19, 9, 26, 15, 31, 13, 22, 10, 28, 16, 24, 11, 30, 14, 21, 8, 25, 13][index];
    ctx.fillStyle = index < 12 ? '#80c9b8' : '#36545d';
    ctx.beginPath();
    ctx.roundRect(188 + index * 15, 570 - barHeight / 2, 6, barHeight, 3);
    ctx.fill();
  }
  ctx.fillStyle = '#9db5b6';
  ctx.font = 'bold 18px monospace';
  ctx.textAlign = 'right';
  ctx.fillText('00:18', 916, 565);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  return texture;
}

export function createMonitorMount(materials, { overlayRoot, camera } = {}) {
  const group = new THREE.Group();
  group.name = 'radio-monitor-mount';
  group.position.set(0, 2.6, -2.36);

  const frame = new THREE.Mesh(new THREE.BoxGeometry(4.56, 2.82, 0.16), materials.monitorFrame);
  group.add(frame);
  const backPanel = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.66, 0.1), materials.black);
  backPanel.position.set(0, 0.02, -0.12);
  backPanel.name = 'radio-monitor-back-panel';
  group.add(backPanel);

  // The monitor hangs from the window's upper crossbar on a concealed rear arm.
  const mountStart = new THREE.Vector3(0, 1.44, -1.12);
  const mountEnd = new THREE.Vector3(0, 1.27, -0.17);
  const mountDirection = new THREE.Vector3().subVectors(mountEnd, mountStart);
  const wallArm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, mountDirection.length(), 8),
    materials.metal,
  );
  wallArm.position.copy(mountStart).add(mountEnd).multiplyScalar(0.5);
  wallArm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), mountDirection.normalize());
  wallArm.name = 'radio-monitor-wall-arm';
  group.add(wallArm);
  const wallAnchor = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6), materials.woodDark);
  wallAnchor.position.copy(mountStart);
  wallAnchor.name = 'radio-monitor-wall-anchor';
  group.add(wallAnchor);
  const monitorAnchor = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), materials.metal);
  monitorAnchor.position.copy(mountEnd);
  monitorAnchor.name = 'radio-monitor-back-anchor';
  group.add(monitorAnchor);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(MONITOR_SCREEN_WIDTH, MONITOR_SCREEN_HEIGHT),
    new THREE.MeshBasicMaterial({ map: makePlaceholderTexture() }),
  );
  screen.position.set(0, 0.02, 0.087);
  screen.name = 'radio-monitor-screen-placeholder';
  group.add(screen);

  const marker = new THREE.Mesh(new THREE.CircleGeometry(0.035, 10), materials.mint);
  marker.position.set(0, -1.35, 0.09);
  group.add(marker);

  let overlay = null;
  let content = null;
  let mountedCleanup = null;
  let restoreRootPosition = null;
  if (overlayRoot && globalThis.document?.createElement) {
    if (overlayRoot.style) {
      const computedPosition = globalThis.getComputedStyle?.(overlayRoot).position;
      if ((computedPosition ?? overlayRoot.style.position ?? 'static') === 'static') {
        const previousPosition = overlayRoot.style.position;
        overlayRoot.style.position = 'relative';
        restoreRootPosition = () => {
          if (overlayRoot.style.position === 'relative') overlayRoot.style.position = previousPosition;
        };
      }
    }
    overlay = document.createElement('div');
    overlay.className = 'studio-monitor-overlay';
    overlay.setAttribute('aria-label', 'Содержимое монитора Radio');
    Object.assign(overlay.style, {
      position: 'absolute',
      zIndex: '1',
      overflow: 'hidden',
      pointerEvents: 'none',
    });
    overlay.style.display = 'none';
    content = document.createElement('div');
    content.className = 'studio-monitor-content';
    Object.assign(content.style, {
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      pointerEvents: 'auto',
    });
    overlay.appendChild(content);
    overlayRoot.appendChild(overlay);
  }

  function updateOverlay(activeCamera = camera) {
    if (!overlay || !activeCamera || !overlayRoot) return;
    const width = Math.max(1, overlayRoot.clientWidth || 1);
    const height = Math.max(1, overlayRoot.clientHeight || 1);
    const corners = [
      [-MONITOR_SCREEN_WIDTH / 2, MONITOR_SCREEN_HEIGHT / 2 + 0.02],
      [MONITOR_SCREEN_WIDTH / 2, MONITOR_SCREEN_HEIGHT / 2 + 0.02],
      [MONITOR_SCREEN_WIDTH / 2, -MONITOR_SCREEN_HEIGHT / 2 + 0.02],
      [-MONITOR_SCREEN_WIDTH / 2, -MONITOR_SCREEN_HEIGHT / 2 + 0.02],
    ].map(([x, y]) => {
      const point = group.localToWorld(new THREE.Vector3(x, y, 0.095)).project(activeCamera);
      return { x: (point.x * 0.5 + 0.5) * width, y: (-point.y * 0.5 + 0.5) * height };
    });
    const left = Math.min(...corners.map((point) => point.x));
    const top = Math.min(...corners.map((point) => point.y));
    const boxWidth = Math.max(1, Math.max(...corners.map((point) => point.x)) - left);
    const boxHeight = Math.max(1, Math.max(...corners.map((point) => point.y)) - top);
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.width = `${boxWidth}px`;
    overlay.style.height = `${boxHeight}px`;
    overlay.style.clipPath = `polygon(${corners.map((point) => `${((point.x - left) / boxWidth) * 100}% ${((point.y - top) / boxHeight) * 100}%`).join(',')})`;
  }

  function unmount() {
    if (!content) return;
    const cleanup = mountedCleanup;
    mountedCleanup = null;
    try {
      cleanup?.();
    } finally {
      content.replaceChildren();
      overlay.style.display = 'none';
    }
  }

  function dispose() {
    try {
      unmount();
    } finally {
      overlay?.remove();
      restoreRootPosition?.();
    }
  }

  return {
    group,
    screen,
    element: content,
    mount(element, cleanup = null) {
      if (!content || !element) return false;
      unmount();
      content.replaceChildren(element);
      mountedCleanup = typeof cleanup === 'function' ? cleanup : null;
      overlay.style.display = 'block';
      updateOverlay();
      return content;
    },
    unmount,
    update: updateOverlay,
    dispose,
    /** Swap the placeholder for a canvas produced by a future 2D monitor adapter. */
    setCanvas(canvas) {
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      screen.material.map?.dispose();
      screen.material.map = texture;
      screen.material.needsUpdate = true;
    },
  };
}

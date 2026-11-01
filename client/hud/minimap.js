import { BUILDINGS, PLAZA } from '../../tools/build-world/layout.js';

const ICONS = Object.freeze({
  city_hall: '🏛️',
  fire_station: '🔥',
  bakery: '🥖',
  flower_shop: '🌷',
  music_school: '🎵',
  radio_station: '🎙️',
});

const SIZE = 176;
const CENTER = SIZE / 2;
const SCALE = 1.22;
const SVG = 'http://www.w3.org/2000/svg';

const point = (x, z) => ({ x: CENTER + (x - PLAZA.x) * SCALE, y: CENTER + (z - PLAZA.z) * SCALE });

export function createMinimap(container) {
  const root = document.createElement('section');
  root.className = 'city-minimap';
  root.setAttribute('aria-label', 'Мини-карта главной площади');
  root.innerHTML = '<div class="city-minimap-title">Площадь</div>';

  const map = document.createElementNS(SVG, 'svg');
  map.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
  map.setAttribute('role', 'img');
  map.setAttribute('aria-label', 'Позиции зданий и вашего персонажа');

  const circle = (cx, cy, r, fill, stroke = 'none', width = 1) => {
    const el = document.createElementNS(SVG, 'circle');
    el.setAttribute('cx', cx);
    el.setAttribute('cy', cy);
    el.setAttribute('r', r);
    el.setAttribute('fill', fill);
    el.setAttribute('stroke', stroke);
    el.setAttribute('stroke-width', width);
    return el;
  };

  map.append(circle(CENTER, CENTER, 69, '#e8edcf'));
  map.append(circle(CENTER, CENTER, 48, '#f4edda'));
  map.append(circle(CENTER, CENTER, 21, '#d5e9e6'));

  for (const building of BUILDINGS) {
    const { x, y } = point(building.x, building.z);
    const marker = document.createElementNS(SVG, 'g');
    marker.setAttribute('transform', `translate(${x} ${y})`);
    marker.setAttribute('aria-label', building.name);
    marker.append(circle(0, 0, 10, '#fffdf6', '#526856', 1.5));
    const icon = document.createElementNS(SVG, 'text');
    icon.textContent = ICONS[building.id] ?? '•';
    icon.setAttribute('text-anchor', 'middle');
    icon.setAttribute('dominant-baseline', 'central');
    icon.setAttribute('font-size', '12');
    marker.append(icon);
    map.append(marker);
  }

  const player = circle(CENTER, CENTER, 5.5, '#2878e5', '#fff', 2);
  player.setAttribute('class', 'city-minimap-player');
  player.setAttribute('aria-label', 'Вы здесь');
  map.append(player);
  root.append(map);
  container.append(root);

  return {
    setPosition(x, z) {
      const pos = point(x, z);
      player.setAttribute('cx', pos.x);
      player.setAttribute('cy', pos.y);
    },
    dispose() {
      root.remove();
    },
  };
}

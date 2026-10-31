// HUD роли 1: FPS, пинг, состояние кеша чанков. Экранный интерфейс (вход, диалоги) — роль 4.

import './hud.css';

const STATUS_TEXT = {
  closed: 'нет соединения',
  connecting: 'подключение…',
  open: 'в сети',
  reconnecting: 'переподключение…',
  denied: 'нужен вход',
};

/** @param {HTMLElement} container */
export function createHud(container) {
  const root = document.createElement('div');
  root.className = 'city-hud';
  const lines = {};
  for (const name of ['status', 'fps', 'ping', 'cache']) {
    lines[name] = document.createElement('div');
    root.appendChild(lines[name]);
  }
  container.appendChild(root);

  const hud = {
    setStatus(status) {
      lines.status.textContent = `Связь: ${STATUS_TEXT[status] ?? status}`;
    },
    setFps(fps) {
      lines.fps.textContent = `FPS: ${Math.round(fps)}`;
    },
    /** @param {number | null} ms */
    setPing(ms) {
      lines.ping.textContent = ms === null ? 'Пинг: —' : `Пинг: ${Math.round(ms)} мс`;
    },
    /** @param {{loaded: number, max: number, worldTotal: number, bytes: number, bytesMax: number} | null} stats */
    setCache(stats) {
      if (!stats) {
        lines.cache.textContent = 'Чанки: —';
        return;
      }
      const pct = stats.worldTotal > 0 ? (stats.loaded / stats.worldTotal) * 100 : 0;
      const kb = (n) => Math.round(n / 1024);
      lines.cache.textContent =
        `Чанки: ${stats.loaded} из ${stats.worldTotal} (${pct.toFixed(1)}%), лимит ${stats.max}` +
        ` · ${kb(stats.bytes)} из ${kb(stats.bytesMax)} КБ`;
    },
    dispose() {
      root.remove();
    },
  };
  hud.setStatus('closed');
  hud.setFps(0);
  hud.setPing(null);
  hud.setCache(null);
  return hud;
}

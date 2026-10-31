// Точка входа клиента (роль 1): движок и сеть. Экранный интерфейс подключает роль 4 через mountUI(api).

import { createClient } from './engine/app.js';
import { mountUI } from './ui/index.js';

const client = createClient({ container: document.getElementById('app') });
const unmountUI = mountUI(client.api);
client.start();

// ?debug=1 открывает api в консоли браузера (window.__city) для ручной проверки.
if (new URLSearchParams(location.search).has('debug')) window.__city = client.api;

window.addEventListener('pagehide', (e) => {
  if (e.persisted) return; // страница уходит в bfcache и может вернуться
  delete window.__city;
  unmountUI?.();
  client.stop();
});

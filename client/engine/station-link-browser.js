// Подключение station-link.js в браузере: тот же клиент, что у основной страницы (без второго рендерера), и общая панель разговора.

import { createClient } from './app.js';
import { mountNpcChat } from '../ui/npc-chat.js';
import { createStationLink } from './station-link.js';

export function showOfflineProgressWarning() {
  const warning = document.createElement('div');
  warning.setAttribute('role', 'alert');
  warning.textContent = 'Прогресс не сохранён на сервере и будет потерян при перезагрузке или выходе.';
  Object.assign(warning.style, { position: 'fixed', top: '1rem', left: '50%', transform: 'translateX(-50%)', zIndex: '10000', padding: '0.75rem', background: '#5c2600', color: '#fff', borderRadius: '0.5rem' });
  document.body.append(warning);
}

export function openStationLink({ container, ...options }) {
  const link = createStationLink({ ...options, client: createClient({ container, networkOnly: true }), mountChat: mountNpcChat });
  // Esc закрывает панель и тогда, когда фокус ушёл с неё после нажатия кнопки-подсказки (кнопка пропадает из разметки).
  const onKeyDown = (event) => {
    if (event.key === 'Escape' && link.chat.state.open) link.chat.close();
  };
  window.addEventListener('keydown', onKeyDown);
  const dispose = link.dispose;
  link.dispose = () => {
    window.removeEventListener('keydown', onKeyDown);
    dispose();
  };
  return link;
}

import { createRadioStudio } from './scene.js';

const root = document.querySelector('#studio');
const button = document.querySelector('#on-air-toggle');
const light = document.querySelector('#status-light');
const status = document.querySelector('#status-label');
const studio = createRadioStudio({ container: root });

button.addEventListener('click', () => {
  const isOnAir = studio.setOnAir(!studio.getOnAir());
  button.setAttribute('aria-pressed', String(isOnAir));
  button.textContent = isOnAir ? 'Завершить эфир' : 'Включить эфир';
  light.classList.toggle('is-live', isOnAir);
  status.textContent = isOnAir ? 'Индикатор ON AIR включён' : 'Студия готова к эфиру';
});

window.addEventListener('pagehide', (event) => {
  if (!event.persisted) studio.dispose();
});

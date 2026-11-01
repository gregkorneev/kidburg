const STYLE_ID = 'location-loading-style';
const OVERLAY_ID = 'location-loading';
const navigating = new WeakSet();

const CSS = `
#${OVERLAY_ID} {
  position: fixed;
  z-index: 10000;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  color: #263f37;
  background: rgba(22, 39, 34, 0.72);
  backdrop-filter: blur(7px);
  font: 600 20px/1.35 system-ui, sans-serif;
}
#${OVERLAY_ID} .location-loading-card {
  display: flex;
  min-width: min(280px, 82vw);
  align-items: center;
  gap: 18px;
  padding: 24px 30px;
  border: 1px solid rgba(255, 255, 255, 0.78);
  border-radius: 22px;
  background: #fffdf4;
  box-shadow: 0 18px 55px rgba(0, 0, 0, 0.24);
}
#${OVERLAY_ID} .location-loading-spinner {
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border: 4px solid #d9e5da;
  border-top-color: #42866b;
  border-radius: 50%;
  animation: location-loading-spin 0.8s linear infinite;
}
@keyframes location-loading-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  #${OVERLAY_ID} .location-loading-spinner { animation-duration: 1.8s; }
}
`;

function showLocationLoading(doc, message) {
  if (!doc?.body) return;
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head?.append(style);
  }
  let overlay = doc.getElementById(OVERLAY_ID);
  if (!overlay) {
    overlay = doc.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'location-loading';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.setAttribute('aria-busy', 'true');
    const card = doc.createElement('div');
    card.className = 'location-loading-card';
    const spinner = doc.createElement('span');
    spinner.className = 'location-loading-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const label = doc.createElement('span');
    label.textContent = message;
    card.append(spinner, label);
    overlay.append(card);
    doc.body.append(overlay);
  }
}

/** Показывает экран ожидания и даёт браузеру кадр, чтобы нарисовать его до смены страницы. */
export function navigateWithLoading(win, doc, href, { replace = false, message = 'Загружаем локацию…' } = {}) {
  if (!win?.location) return;
  if (navigating.has(win)) return;
  navigating.add(win);
  showLocationLoading(doc ?? win.document, message);
  const navigate = () => (replace ? win.location.replace(href) : win.location.assign(href));
  if (typeof win.requestAnimationFrame === 'function') {
    win.requestAnimationFrame(navigate);
  } else {
    navigate();
  }
}

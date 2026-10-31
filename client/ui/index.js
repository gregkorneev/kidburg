import './auth.css';

const STATUS = {
  closed: 'нет соединения',
  connecting: 'подключение…',
  open: 'в сети',
  reconnecting: 'переподключение…',
  denied: 'нужен повторный вход',
};

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Экран входа/регистрации и состояние соединения для игры и LAN-preview. */
export function mountUI(api) {
  const root = element('div', 'auth-root');
  root.setAttribute('aria-live', 'polite');
  document.body.append(root);

  let user = api.auth.session()?.user ?? null;
  let status = api.net.status;
  let mode = 'login';
  let busy = false;
  let message = '';
  let draftName = ''; // имя не теряется при ошибке входа

  function render() {
    root.replaceChildren();

    if (user) {
      const badge = element('div', 'auth-badge');
      const details = element('div', 'auth-badge__details');
      details.append(
        element('strong', '', user.name),
        element('span', '', message || STATUS[status] || status),
      );
      const logout = element('button', 'auth-button auth-button--small', 'Выйти');
      logout.type = 'button';
      logout.addEventListener('click', () => api.auth.logout());
      badge.append(details, logout);
      root.append(badge);
      return;
    }

    const panel = element('section', 'auth-panel');
    panel.setAttribute('aria-labelledby', 'auth-title');
    const title = element('h1', '', mode === 'login' ? 'Вход в город' : 'Новый житель');
    title.id = 'auth-title';
    const intro = element('p', 'auth-intro', 'Для каждого компьютера используйте отдельный аккаунт.');
    const form = element('form', 'auth-form');
    const nameLabel = element('label', 'auth-label', 'Имя');
    const nameInput = element('input', 'auth-input');
    nameInput.name = 'name';
    nameInput.autocomplete = 'username';
    nameInput.required = true;
    nameInput.maxLength = 24;
    nameInput.autocapitalize = 'none';
    nameInput.value = draftName;
    nameInput.addEventListener('input', () => { draftName = nameInput.value; });
    nameLabel.append(nameInput);

    const passwordLabel = element('label', 'auth-label', 'Пароль');
    const passwordInput = element('input', 'auth-input');
    passwordInput.name = 'password';
    passwordInput.type = 'password';
    passwordInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    passwordInput.required = true;
    passwordInput.maxLength = 128;
    passwordLabel.append(passwordInput);

    const feedback = element('p', 'auth-message', message);
    feedback.hidden = !message;
    const submit = element('button', 'auth-button auth-button--primary', busy ? 'Подключаем…' : mode === 'login' ? 'Войти' : 'Создать аккаунт');
    submit.type = 'submit';
    submit.disabled = busy;
    form.append(nameLabel, passwordLabel, feedback, submit);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      message = '';
      render();
      const name = nameInput.value.trim();
      const password = passwordInput.value;
      try {
        user = mode === 'login'
          ? await api.auth.login(name, password)
          : await api.auth.register(name, password);
        message = '';
        draftName = '';
      } catch (error) {
        message = error?.message || 'Не удалось войти. Проверьте подключение к серверу.';
      } finally {
        busy = false;
        render();
      }
    });

    const toggle = element('button', 'auth-link', mode === 'login' ? 'Создать аккаунт' : 'Уже есть аккаунт? Войти');
    toggle.type = 'button';
    toggle.addEventListener('click', () => {
      mode = mode === 'login' ? 'register' : 'login';
      message = '';
      render();
    });
    panel.append(title, intro, form, toggle);
    root.append(panel);
  }

  const offAuth = api.on('auth', (info) => {
    user = info?.user ?? null;
    message = '';
    render();
  });
  const offStatus = api.net.on('status', ({ status: next }) => {
    status = next;
    render();
  });
  const offWelcome = api.on('welcome', () => {
    status = 'open';
    message = '';
    render();
  });
  const offError = api.on('error', (error) => {
    message = error?.message || 'Ошибка соединения с сервером.';
    render();
  });

  render();
  return () => {
    offAuth();
    offStatus();
    offWelcome();
    offError();
    root.remove();
  };
}

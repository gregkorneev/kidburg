import './auth.css';
import { mountNpcChat } from './npc-chat.js';

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

/**
 * Экран входа (имя и код комнаты), состояние соединения и разговор с NPC для игры и LAN-preview.
 * Возвращает функцию снятия интерфейса; её свойство `chat` — контроллер разговора (open, close, onOpenChange).
 */
export function mountUI(api) {
  const root = element('div', 'auth-root');
  root.setAttribute('aria-live', 'polite');
  document.body.append(root);
  const chat = mountNpcChat(api);

  let user = api.auth.session()?.user ?? null;
  let status = api.net.status;
  let busy = false;
  let message = '';
  let draftName = ''; // введённое не теряется при ошибке входа
  let draftRoom = '';
  let roomTouched = false; // игрок сам правил поле кода: подставленный код его не затирает
  let hostRoom = null; // код от сервера, только если игра открыта на компьютере сервера; лишь в памяти страницы

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
    const title = element('h1', '', 'Вход в игру');
    title.id = 'auth-title';
    const intro = element('p', 'auth-intro', hostRoom
      ? 'Вы на компьютере сервера: код комнаты подставлен. Введите имя и войдите.'
      : 'Введите своё имя и код комнаты, который показан на экране сервера.');
    const form = element('form', 'auth-form');
    const nameLabel = element('label', 'auth-label', 'Имя');
    const nameInput = element('input', 'auth-input');
    nameInput.name = 'name';
    nameInput.autocomplete = 'username';
    nameInput.required = true;
    nameInput.maxLength = 20;
    nameInput.autocapitalize = 'none';
    nameInput.value = draftName;
    nameInput.addEventListener('input', () => { draftName = nameInput.value; });
    nameLabel.append(nameInput);

    const roomLabel = element('label', 'auth-label', 'Код комнаты');
    const roomInput = element('input', 'auth-input auth-input--code');
    roomInput.name = 'room';
    roomInput.autocomplete = 'off';
    roomInput.required = true;
    roomInput.maxLength = 4;
    roomInput.autocapitalize = 'characters';
    roomInput.spellcheck = false;
    roomInput.placeholder = 'ABCD';
    if (hostRoom && !roomTouched && !draftRoom) draftRoom = hostRoom;
    roomInput.value = draftRoom;
    roomInput.addEventListener('input', () => {
      roomTouched = true;
      // Только латинские буквы, всегда заглавные: код состоит из четырёх латинских букв.
      roomInput.value = roomInput.value.replace(/[^a-zA-Z]/g, '').toUpperCase();
      draftRoom = roomInput.value;
    });
    roomLabel.append(roomInput);

    const feedback = element('p', 'auth-message', message);
    feedback.hidden = !message;
    const submit = element('button', 'auth-button auth-button--primary', busy ? 'Подключаем…' : 'Войти');
    submit.type = 'submit';
    submit.disabled = busy;
    form.append(nameLabel, roomLabel, feedback, submit);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      message = '';
      render();
      try {
        user = await api.auth.join(nameInput.value.trim(), roomInput.value);
        message = '';
        draftName = '';
        draftRoom = '';
        roomTouched = false;
      } catch (error) {
        message = error?.message || 'Не удалось войти. Проверьте подключение к серверу.';
      } finally {
        busy = false;
        render();
      }
    });
    panel.append(title, intro, form);
    if (hostRoom) {
      const invite = element('p', 'auth-invite');
      invite.append('Код для игроков по сети: ', element('strong', 'auth-invite__code', hostRoom));
      panel.append(invite);
    }
    root.append(panel);
  }

  let hostRoomAsked = false;
  /** На компьютере сервера просит у него код комнаты; с других компьютеров ответа нет, поле остаётся пустым. */
  function loadHostRoom() {
    if (user || hostRoomAsked) return;
    hostRoomAsked = true;
    Promise.resolve(api.auth.localRoom()).catch(() => null).then((code) => {
      if (!code) return;
      hostRoom = code;
      if (user) return;
      const focused = document.activeElement?.name; // render пересоздаёт форму: вернём фокус на поле
      render(); // введённые draftName и draftRoom сохраняются
      if (focused) root.querySelector(`[name="${focused}"]`)?.focus?.();
    });
  }

  const offAuth = api.on('auth', (info) => {
    user = info?.user ?? null;
    message = '';
    render();
    loadHostRoom();
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
  loadHostRoom();
  const unmount = () => {
    offAuth();
    offStatus();
    offWelcome();
    offError();
    chat.dispose();
    root.remove();
  };
  return Object.assign(unmount, { chat });
}

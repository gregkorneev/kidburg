import './auth.css';
import logoUrl from '../../assets/branding/careerium-logo.png';
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
export function mountUI(api, { createPreview } = {}) {
  const root = element('div', 'auth-root');
  root.setAttribute('aria-live', 'polite');
  document.body.append(root);
  const chat = mountNpcChat(api);

  let user = api.auth.session()?.user ?? null;
  let status = api.net.status;
  let busy = false;
  let step = 'login';
  let avatar = { skin: 0, clothes: 0, hair: 0, hairColor: 0, shoes: 0 };
  let preview = null;
  const categories = [['skin', 'Цвет кожи'], ['clothes', 'Одежда'], ['hair', 'Причёска'], ['hairColor', 'Цвет волос'], ['shoes', 'Обувь']];
  const errors = { bad_name: 'Проверьте имя игрока.', bad_room: 'Проверьте код комнаты.', name_taken: 'Это имя уже занято.', bad_appearance: 'Не удалось сохранить внешность. Попробуйте ещё раз.', network: 'Сервер недоступен. Проверьте подключение.' };

  async function join(withAvatar) {
    if (busy) return;
    busy = true;
    message = '';
    render();
    try {
      user = await api.auth.join(draftName.trim(), draftRoom, ...(withAvatar ? [{ avatar: { ...avatar } }] : []));
      message = '';
      draftName = '';
      draftRoom = '';
      roomTouched = false;
      step = 'login';
    } catch (error) {
      if (!withAvatar && error?.code === 'appearance_required') {
        step = 'customize';
        return;
      }
      message = errors[error?.code] || error?.message || 'Не удалось войти. Проверьте подключение к серверу.';
    } finally {
      busy = false;
      render();
    }
  }
  let message = '';
  let draftName = ''; // введённое не теряется при ошибке входа
  let draftRoom = '';
  let roomTouched = false; // игрок сам правил поле кода: подставленный код его не затирает
  let hostRoom = null; // код от сервера, только если игра открыта на компьютере сервера; лишь в памяти страницы

  function render() {
    preview?.dispose?.();
    preview = null;
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

    const layout = element('div', 'auth-layout');
    const brand = element('section', 'auth-brand');
    brand.setAttribute('aria-label', 'Carrierium — Город профессий');
    const logo = element('img', 'auth-brand__logo');
    logo.src = logoUrl;
    logo.alt = 'Carrierium — Город профессий';
    brand.append(logo);

    const content = element('div', 'auth-content');
    const panel = element('section', 'auth-panel');
    panel.setAttribute('aria-labelledby', 'auth-title');
    if (step !== 'login') {
      panel.className += ' auth-panel--customizer';
      const title = element('h1', '', step === 'customize' ? 'Создай персонажа' : 'Всё готово?');
      title.id = 'auth-title';
      const intro = element('p', 'auth-intro', step === 'customize' ? 'Выбери, как будет выглядеть твой персонаж.' : 'Проверь выбор и отправляйся в город.');
      const stage = element('div', 'avatar-preview');
      stage.setAttribute('role', 'img');
      stage.setAttribute('aria-label', 'Область предпросмотра персонажа');
      if (createPreview) {
        preview = createPreview(stage);
        preview?.setAvatar?.({ ...avatar });
      } else {
        stage.append(element('span', 'avatar-preview__placeholder', 'Предпросмотр персонажа'));
      }
      panel.append(title, intro, stage);
      if (step === 'customize') {
        const options = element('div', 'avatar-options');
        for (const [key, label] of categories) {
          const group = element('fieldset', 'avatar-group');
          group.append(element('legend', '', label));
          const choices = element('div', 'avatar-choices');
          for (let i = 0; i < 4; i++) {
            const button = element('button', 'avatar-choice', String(i + 1));
            button.type = 'button';
            button.setAttribute('aria-label', `${label}: вариант ${i + 1}`);
            button.setAttribute('aria-pressed', String(avatar[key] === i));
            button.addEventListener('click', () => {
              avatar[key] = i;
              for (const [index, choice] of Array.from(choices.children).entries()) choice.setAttribute('aria-pressed', String(index === i));
              preview?.setAvatar?.({ ...avatar });
            });
            choices.append(button);
          }
          group.append(choices);
          options.append(group);
        }
        panel.append(options);
      } else {
        const summary = element('p', 'avatar-summary', categories.map(([key, label]) => `${label}: ${avatar[key] + 1}`).join(' · '));
        panel.append(summary);
      }
      const feedback = element('p', 'auth-message', message);
      feedback.hidden = !message;
      feedback.setAttribute('role', 'alert');
      const actions = element('div', 'avatar-actions');
      const back = element('button', 'auth-button', 'Назад');
      back.type = 'button';
      back.disabled = busy;
      back.addEventListener('click', () => { step = step === 'confirm' ? 'customize' : 'login'; message = ''; render(); });
      const next = element('button', 'auth-button auth-button--primary', busy ? 'Подключаем…' : step === 'customize' ? 'Продолжить' : 'Войти в игру');
      next.type = 'button';
      next.disabled = busy;
      next.addEventListener('click', () => { if (step === 'customize') { step = 'confirm'; render(); } else join(true); });
      actions.append(back, next);
      panel.append(feedback, actions);
      content.append(panel);
      layout.append(brand, content);
      root.append(layout);
      return;
    }
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
    feedback.setAttribute('role', 'alert');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      draftName = nameInput.value;
      draftRoom = roomInput.value;
      if (!draftName.trim() || !draftRoom) { message = 'Введите имя и код комнаты.'; render(); return; }
      await join(false);
    });
    panel.append(title, intro, form);
    if (hostRoom) {
      const invite = element('p', 'auth-invite');
      invite.append('Код для игроков по сети: ', element('strong', 'auth-invite__code', hostRoom));
      panel.append(invite);
    }
    content.append(panel);
    layout.append(brand, content);
    root.append(layout);
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
    preview?.dispose?.();
    chat.dispose();
    root.remove();
  };
  return Object.assign(unmount, { chat });
}

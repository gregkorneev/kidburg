import './npc-chat.css';
import { MAX_TEXT, createNpcChat } from './npc-chat-core.js';

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Подсказка «E — поговорить» и панель разговора с NPC поверх игры. Возвращает контроллер ядра с dispose(). */
export function mountNpcChat(api) {
  const chat = createNpcChat({ api });
  const { state } = chat;

  const root = element('div', 'npc-root');
  const hint = element('div', 'npc-hint');
  hint.hidden = true;
  const hintText = element('span');
  hint.append(element('kbd', '', 'E'), hintText);

  const panel = element('section', 'npc-panel');
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', 'npc-title');

  const head = element('div', 'npc-head');
  const titleBox = element('div', 'npc-title');
  const title = element('strong');
  title.id = 'npc-title';
  const status = element('span', 'npc-status');
  titleBox.append(title, status);
  const close = element('button', 'npc-close', 'Закрыть');
  close.type = 'button';
  head.append(titleBox, close);

  const log = element('div', 'npc-log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  const empty = element('p', 'npc-empty', 'Напишите первое сообщение — собеседник ответит в течение нескольких секунд.');
  const error = element('p', 'npc-error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const hintLine = element('p', 'npc-assist-hint'); // фиксированная памятка игры, не реплика NPC
  hintLine.hidden = true;
  const noteLine = element('p', 'npc-assist-note');
  noteLine.setAttribute('role', 'status');
  noteLine.hidden = true;
  const actions = element('div', 'npc-actions');
  actions.hidden = true;

  const form = element('form', 'npc-form');
  const input = element('input', 'npc-input');
  input.type = 'text';
  input.maxLength = MAX_TEXT;
  input.autocomplete = 'off';
  input.placeholder = 'Ваш вопрос…';
  input.setAttribute('aria-label', 'Сообщение собеседнику');
  const send = element('button', 'npc-send', 'Отправить');
  send.type = 'submit';
  form.append(input, send);

  panel.append(head, hintLine, log, error, noteLine, actions, form);
  root.append(hint, panel);
  document.body.append(root);

  const nodes = new Map(); // id сообщения -> узел
  let shownAgent = null;
  let shownActions = '';

  function statusText() {
    if (state.status === 'queued') return `В очереди: ${state.queue}`;
    if (state.status === 'waiting') return 'Собеседник думает…';
    if (state.status === 'streaming') return 'Отвечает…';
    return 'Готов к разговору';
  }

  function renderAssist() {
    const { assist } = state;
    hintLine.hidden = !assist.hint;
    if (hintLine.textContent !== assist.hint) hintLine.textContent = assist.hint;
    noteLine.hidden = !assist.note;
    if (noteLine.textContent !== assist.note) noteLine.textContent = assist.note;
    actions.hidden = assist.actions.length === 0;
    if (shownActions !== assist.sig) {
      shownActions = assist.sig;
      actions.replaceChildren(
        ...assist.actions.map((action, index) => {
          const button = element('button', `npc-action${action.primary ? ' npc-action--primary' : ''}`, action.label);
          button.type = 'button';
          button.dataset.action = String(index);
          return button;
        }),
      );
    }
    // Кнопки не работают, пока идёт ответ: реплика и действие не должны перемешаться.
    actions.childNodes.forEach((button, index) => {
      button.disabled = state.status !== 'idle' || Boolean(assist.actions[index]?.disabled);
    });
  }

  function render() {
    hint.hidden = state.open || !state.near || !state.online;
    if (!hint.hidden) hintText.textContent = `Поговорить: ${state.near.name}`;

    panel.hidden = !state.open;
    if (!state.open) return;

    title.textContent = state.npc.name;
    status.textContent = statusText();
    error.textContent = state.error;
    error.hidden = !state.error;
    input.disabled = !chat.canSend;
    send.disabled = !chat.canSend;
    renderAssist();

    if (shownAgent !== state.npc.agentId) {
      shownAgent = state.npc.agentId;
      nodes.clear();
      log.replaceChildren();
    }
    const keep = new Set(state.messages.map((m) => m.id));
    for (const [id, node] of nodes) {
      if (!keep.has(id)) {
        node.remove();
        nodes.delete(id);
      }
    }
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    for (const message of state.messages) {
      let node = nodes.get(message.id);
      if (!node) {
        node = element('div');
        nodes.set(message.id, node);
        log.append(node);
      }
      node.className = `npc-msg npc-msg--${message.from}${message.pending ? ' npc-msg--pending' : ''}`;
      if (node.textContent !== message.text) node.textContent = message.text;
    }
    if (state.messages.length === 0) log.append(empty);
    else empty.remove();
    if (atBottom) log.scrollTop = log.scrollHeight;
  }

  const offRender = chat.subscribe(render);
  const offOpen = chat.onOpenChange((open) => {
    if (open) setTimeout(() => input.focus(), 0);
    else input.blur();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (chat.send(input.value)) input.value = '';
  });
  actions.addEventListener('click', (event) => {
    const button = event.target.closest?.('button[data-action]');
    if (button) chat.choose(state.assist.actions[Number(button.dataset.action)]);
  });
  close.addEventListener('click', () => chat.close());
  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    chat.close();
  });

  render();
  const baseDispose = chat.dispose;
  chat.dispose = () => {
    offRender();
    offOpen();
    baseDispose();
    root.remove();
  };
  return chat;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../../shared/protocol.js';
import { createEmitter } from '../engine/emitter.js';
import { MAX_MESSAGES, MAX_TEXT, createNpcChat } from './npc-chat-core.js';

const THERAPIST = { agentId: 'therapist', name: 'therapist' };

function setup({ status = 'open', sendOk = true, me = { id: 1 } } = {}) {
  const emitter = createEmitter();
  const sent = [];
  const calls = [];
  const api = {
    on: (type, handler) => emitter.on(type, handler),
    state: { me },
    ui: { lockPointer: () => calls.push('lock'), unlockPointer: () => calls.push('unlock') },
    net: { status, send: (msg) => (sendOk ? (sent.push(msg), true) : false) },
  };
  const timeouts = [];
  const timers = {
    setTimeout: (fn) => (timeouts.push(fn), timeouts.length),
    clearTimeout: (id) => {
      if (id) timeouts[id - 1] = null;
    },
  };
  const chat = createNpcChat({ api, timers });
  const server = {
    queue: (reqId, position, agentId = 'therapist') => emitter.emit('agent_queue', { t: 'agent_queue', agentId, reqId, position }),
    token: (reqId, token, agentId = 'therapist') => emitter.emit('agent_token', { t: 'agent_token', agentId, reqId, token }),
    done: (reqId, agentId = 'therapist') => emitter.emit('agent_done', { t: 'agent_done', agentId, reqId }),
    fail: (reqId, message, agentId = 'therapist') => emitter.emit('agent_error', { t: 'agent_error', agentId, reqId, message }),
  };
  const fireTimeout = () => timeouts.filter(Boolean).at(-1)?.();
  return { chat, api, emitter, sent, calls, server, fireTimeout };
}

test('E у NPC открывает панель, закрытие возвращает управление мышью', () => {
  const { chat, emitter, calls } = setup();
  emitter.emit('interact', null); // нажали E, рядом никого
  assert.equal(chat.state.open, false);

  emitter.emit('npc_near', { agentId: 'nurse', name: 'nurse' });
  assert.deepEqual(chat.state.near, { agentId: 'nurse', name: 'Медсестра' });
  emitter.emit('interact', { agentId: 'nurse', name: 'nurse' });
  assert.equal(chat.state.open, true);
  assert.equal(chat.state.npc.name, 'Медсестра');
  chat.close();
  assert.equal(chat.state.open, false);
  assert.deepEqual(calls, ['unlock', 'lock']);
  assert.equal(chat.open({}), false, 'без agentId панель не открывается');
});

test('send: npc_talk проходит validate, ответ собирается из токенов, после done можно писать дальше', () => {
  const { chat, sent, server } = setup();
  chat.open(THERAPIST);
  assert.equal(chat.send('  Расскажите   о работе \n'), true);
  assert.equal(sent.length, 1);
  assert.equal(validate(sent[0], 'c2s').ok, true);
  assert.deepEqual(
    { t: sent[0].t, agentId: sent[0].agentId, text: sent[0].text },
    { t: 'npc_talk', agentId: 'therapist', text: 'Расскажите о работе' },
  );
  assert.equal(chat.state.status, 'waiting');
  assert.equal(chat.canSend, false);
  assert.equal(chat.send('вторая, пока ждём'), false, 'пока идёт ответ, вторая реплика не уходит');
  assert.equal(sent.length, 1);

  const reqId = sent[0].reqId;
  server.queue(reqId, 2);
  assert.equal(chat.state.status, 'queued');
  assert.equal(chat.state.queue, 2);
  server.token(reqId, 'Здрав');
  server.token(reqId, 'ствуйте');
  assert.equal(chat.state.status, 'streaming');
  assert.equal(chat.state.queue, null);
  assert.deepEqual(chat.state.messages.map((m) => [m.from, m.text, m.pending]), [
    ['me', 'Расскажите о работе', false],
    ['npc', 'Здравствуйте', true],
  ]);
  server.done(reqId);
  assert.equal(chat.state.status, 'idle');
  assert.equal(chat.state.messages[1].pending, false);
  assert.equal(chat.state.error, '');

  assert.equal(chat.send('А как учиться?'), true);
  assert.notEqual(sent[1].reqId, reqId, 'у каждого запроса свой reqId');
});

test('чужие и устаревшие сообщения (другой reqId или agentId) игнорируются', () => {
  const { chat, sent, server } = setup();
  chat.open(THERAPIST);
  chat.send('Привет');
  const reqId = sent[0].reqId;
  server.token('другой', 'ЧУЖОЕ');
  server.token(reqId, 'ЧУЖОЙ_АГЕНТ', 'nurse');
  server.done('другой');
  server.fail('другой', 'ошибка');
  assert.equal(chat.state.status, 'waiting');
  assert.equal(chat.state.messages[1].text, '');
  server.token(reqId, 'Свой');
  assert.equal(chat.state.messages[1].text, 'Свой');
});

test('agent_error: пустая реплика исчезает, частичный ответ остаётся, ошибка видна и можно повторить', () => {
  const { chat, sent, server } = setup();
  chat.open(THERAPIST);
  chat.send('Привет');
  server.fail(sent[0].reqId, 'Локальная модель недоступна (Ollama не запущена?)');
  assert.equal(chat.state.status, 'idle');
  assert.equal(chat.state.error, 'Локальная модель недоступна (Ollama не запущена?)');
  assert.deepEqual(chat.state.messages.map((m) => m.from), ['me'], 'пустой ответ не показывается');

  assert.equal(chat.send('Ещё раз'), true);
  assert.equal(chat.state.error, '', 'новая реплика сбрасывает ошибку');
  server.token(sent[1].reqId, 'Начало ответа');
  server.fail(sent[1].reqId, 'Связь с моделью оборвалась');
  assert.equal(chat.state.messages.at(-1).text, 'Начало ответа');
  assert.equal(chat.state.messages.at(-1).pending, false);
  assert.equal(chat.state.error, 'Связь с моделью оборвалась');
  assert.equal(chat.canSend, true);
});

test('error too_far/rate_limit/bad_msg завершают запрос; повторный agent_error после него не мешает', () => {
  const { chat, emitter, sent, server } = setup();
  chat.open(THERAPIST);
  chat.send('Привет');
  emitter.emit('error', { t: 'error', code: 'too_far', message: 'Слишком далеко от собеседника' });
  assert.equal(chat.state.error, 'Слишком далеко от собеседника');
  assert.equal(chat.canSend, true);
  server.fail(sent[0].reqId, 'Подойдите ближе к собеседнику'); // дубль сервера: запрос уже закрыт
  assert.equal(chat.state.error, 'Слишком далеко от собеседника');

  chat.send('Ещё');
  emitter.emit('error', { t: 'error', code: 'unauth', message: 'не про разговор' });
  assert.equal(chat.state.status, 'waiting', 'посторонние ошибки не трогают запрос');
});

test('нет связи: реплика не уходит; обрыв посреди ответа даёт ошибку и разрешает повтор', () => {
  const closed = setup({ status: 'reconnecting' });
  closed.chat.open(THERAPIST);
  assert.equal(closed.chat.send('Привет'), false);
  assert.equal(closed.sent.length, 0);
  assert.match(closed.chat.state.error, /Нет связи/);
  assert.equal(closed.chat.state.messages.length, 0);

  const refused = setup({ sendOk: false });
  refused.chat.open(THERAPIST);
  assert.equal(refused.chat.send('Привет'), false);
  assert.equal(refused.chat.state.messages.length, 0, 'неотправленная реплика не остаётся в переписке');
  assert.equal(refused.chat.canSend, true);

  const { chat, emitter, sent, server } = setup();
  chat.open(THERAPIST);
  chat.send('Привет');
  server.token(sent[0].reqId, 'Част');
  emitter.emit('status', { status: 'reconnecting' });
  assert.equal(chat.state.status, 'idle');
  assert.match(chat.state.error, /Связь с сервером прервалась/);
  assert.equal(chat.state.messages.at(-1).text, 'Част');
  server.token(sent[0].reqId, 'запоздалый'); // старый сокет закрыт: токены уже не принимаются
  assert.equal(chat.state.messages.at(-1).text, 'Част');
  emitter.emit('status', { status: 'open' });
  assert.equal(chat.send('Повтор'), true);
});

test('сервер молчит: по таймауту запрос завершается ошибкой', () => {
  const { chat, sent, fireTimeout } = setup();
  chat.open(THERAPIST);
  chat.send('Привет');
  fireTimeout();
  assert.equal(chat.state.status, 'idle');
  assert.match(chat.state.error, /не пришёл вовремя/);
  assert.equal(chat.send('Ещё'), true);
  assert.equal(sent.length, 2);
});

test('проверка текста: пустой и слишком длинный не уходят', () => {
  const { chat, sent } = setup();
  chat.open(THERAPIST);
  assert.equal(chat.send('   '), false);
  assert.match(chat.state.error, /Введите/);
  assert.equal(chat.send('я'.repeat(MAX_TEXT + 1)), false);
  assert.match(chat.state.error, new RegExp(String(MAX_TEXT)));
  assert.equal(chat.send('я'.repeat(MAX_TEXT)), true);
  assert.equal(sent.length, 1);
});

test('переписка с разными NPC отдельная, выход из игры стирает всё и закрывает панель', () => {
  const { chat, emitter, sent, server } = setup();
  chat.open(THERAPIST);
  chat.send('Привет, врач');
  server.token(sent[0].reqId, 'Здравствуйте');
  server.done(sent[0].reqId);
  chat.close();

  chat.open({ agentId: 'nurse', name: 'nurse' });
  assert.deepEqual(chat.state.messages, []);
  chat.send('Привет, сестра');
  assert.equal(sent[1].agentId, 'nurse');
  server.token(sent[1].reqId, 'Добрый день', 'nurse');
  server.done(sent[1].reqId, 'nurse');
  chat.close();

  chat.open(THERAPIST);
  assert.deepEqual(chat.state.messages.map((m) => m.text), ['Привет, врач', 'Здравствуйте']);

  emitter.emit('auth', null);
  assert.equal(chat.state.open, false);
  assert.deepEqual(chat.state.messages, []);
  chat.open(THERAPIST);
  assert.deepEqual(chat.state.messages, [], 'после выхода история прежнего игрока не показывается');
});

test('длина переписки ограничена, dispose снимает обработчики', () => {
  const { chat, emitter, sent, server } = setup();
  chat.open(THERAPIST);
  for (let i = 0; i < MAX_MESSAGES; i++) {
    chat.send(`вопрос ${i}`);
    server.token(sent.at(-1).reqId, `ответ ${i}`);
    server.done(sent.at(-1).reqId);
  }
  assert.ok(chat.state.messages.length <= MAX_MESSAGES);
  assert.equal(chat.state.messages.at(-1).text, `ответ ${MAX_MESSAGES - 1}`);

  let notified = 0;
  chat.subscribe(() => notified++);
  chat.dispose();
  emitter.emit('npc_near', THERAPIST);
  assert.equal(notified, 0);
});

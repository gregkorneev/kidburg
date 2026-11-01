// Экран входа без браузера: небольшая подставная модель DOM, css подменяется пустым модулем.

import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function load(url, context, next) {
      if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
      if (url.endsWith('.png')) return { format: 'module', source: 'export default "/test-logo.png"', shortCircuit: true };
      return next(url, context);
    }`),
);

class Node {
  constructor(tag) {
    this.tag = tag;
    this.children = Object.assign(Object.create(null), { length: 0, push: Array.prototype.push, flatMap: Array.prototype.flatMap, [Symbol.iterator]: Array.prototype[Symbol.iterator] });
    this.attributes = {};
    this.listeners = {};
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.hidden = false;
  }
  append(...items) { for (const item of items) this.children.push(typeof item === 'string' ? Object.assign(new Node('#text'), { textContent: item }) : item); }
  replaceChildren(...items) { this.children = Object.assign(Object.create(null), { length: 0, push: Array.prototype.push, flatMap: Array.prototype.flatMap, [Symbol.iterator]: Array.prototype[Symbol.iterator] }); this.append(...items); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  async fire(type, event = {}) { for (const fn of this.listeners[type] ?? []) await fn({ preventDefault() {}, ...event }); }
  focus() { globalThis.document.activeElement = this; }
  remove() { this.removed = true; }
  all() { return [this, ...this.children.flatMap((child) => child.all())]; }
  querySelector(selector) {
    const name = /\[name="(.+)"\]/.exec(selector)?.[1];
    return this.all().find((node) => node.name === name) ?? null;
  }
  text() { return this.all().map((node) => node.textContent).join(' '); }
  type(value) { this.value = value; return this.fire('input'); }
}

const body = new Node('body');
globalThis.document = { body, activeElement: null, createElement: (tag) => new Node(tag) };
const { mountUI } = await import('./index.js');

const flush = () => new Promise((resolve) => setImmediate(resolve));

function mount({ localRoom = async () => null, join = async () => ({ name: 'Аня' }), createPreview } = {}) {
  body.children = [];
  const calls = [];
  const noop = () => () => {};
  const api = {
    auth: { session: () => null, localRoom, join: (...args) => { calls.push(args); return join(...args); } },
    on: noop,
    net: { status: 'closed', on: noop },
  };
  const dispose = mountUI(api, { createPreview });
  const root = body.children[0];
  const field = (name) => root.querySelector(`[name="${name}"]`);
  return { root, field, calls, dispose };
}

test('компьютер сервера: поле кода заполнено, код виден владельцу', async () => {
  const ui = mount({ localRoom: async () => 'BCDF' });
  assert.equal(ui.field('room').value, '', 'до ответа сервера поле пустое');
  await flush();
  assert.equal(ui.field('room').value, 'BCDF');
  assert.match(ui.root.text(), /Код для игроков по сети:\s+BCDF/);
  assert.match(ui.root.text(), /код комнаты подставлен/);
});

test('экран входа делится на панель с логотипом и панель авторизации', () => {
  const ui = mount({ localRoom: async () => null });
  const layout = ui.root.all().find((node) => node.className === 'auth-layout');
  const [brand, content] = layout.children;
  assert.equal(brand.className, 'auth-brand');
  assert.equal(brand.children[0].tag, 'img');
  assert.equal(brand.children[0].alt, 'Carrierium — Город профессий');
  assert.equal(brand.children[0].src, '/test-logo.png');
  assert.ok(content.all().some((node) => node.className === 'auth-panel'));
});

test('автозаполнение: игроку остаётся ввести имя и войти', async () => {
  const ui = mount({ localRoom: async () => 'BCDF' });
  await flush();
  ui.field('name').value = 'Аня';
  const form = ui.root.all().find((node) => node.tag === 'form');
  await form.fire('submit');
  assert.match(ui.root.text(), /Создай персонажа/);
  await ui.root.all().find((node) => node.textContent === 'Продолжить').fire('click');
  await ui.root.all().find((node) => node.textContent === 'Войти в игру').fire('click');
  assert.deepEqual(ui.calls, [['Аня', 'BCDF', { avatar: { skin: 0, clothes: 0, hair: 0, shoes: 0 } }]]);
});

test('другой компьютер: сервер кода не дал, поле пустое и код не показан', async () => {
  const ui = mount({ localRoom: async () => null });
  await flush();
  assert.equal(ui.field('room').value, '');
  assert.doesNotMatch(ui.root.text(), /Код для игроков/);
  assert.match(ui.root.text(), /код комнаты, который показан на экране сервера/);
});

test('ручной ввод не затирается: игрок начал вводить код до ответа сервера', async () => {
  const ui = mount({ localRoom: async () => 'BCDF' });
  await ui.field('room').type('zq');
  await flush();
  assert.equal(ui.field('room').value, 'ZQ');
});

test('игрок стёр код сам — подставленный код не возвращается при перерисовке', async () => {
  const ui = mount({ localRoom: async () => 'BCDF', join: async () => { throw new Error('Неверный код комнаты'); } });
  await flush();
  await ui.field('room').type('');
  await ui.field('name').type('Аня');
  const form = ui.root.all().find((node) => node.tag === 'form');
  await ui.root.all().find((node) => node.textContent === 'Уже играл? Войти').fire('click'); // неудачный вход перерисовывает форму
  assert.equal(ui.field('room').value, '');
  assert.equal(ui.field('name').value, 'Аня', 'имя сохраняется');
});

test('сбой запроса кода не ломает форму входа', async () => {
  const ui = mount({ localRoom: async () => { throw new Error('boom'); } });
  await flush();
  assert.ok(ui.field('room'));
  assert.equal(ui.field('room').value, '');
});

async function customize(ui) {
  await ui.field('name').type('Аня');
  await ui.field('room').type('BCDF');
  await ui.root.all().find((node) => node.tag === 'form').fire('submit');
}

test('категории, выбор, доступность и preview сохраняют draft до подтверждения', async () => {
  const updates = [];
  const ui = mount({ createPreview: () => ({ setAvatar: (value) => updates.push(value) }) });
  await customize(ui);
  const groups = ui.root.all().filter((node) => node.tag === 'fieldset');
  assert.equal(groups.length, 4);
  for (const group of groups) {
    const choices = group.all().filter((node) => node.className === 'avatar-choice');
    assert.equal(choices.length, 4);
    assert.deepEqual(choices.map((node) => node.attributes['aria-pressed']), ['true', 'false', 'false', 'false']);
    assert.ok(choices.every((node) => node.attributes['aria-label'] && node.type === 'button'));
    await choices[2].fire('click');
    assert.equal(choices[2].attributes['aria-pressed'], 'true');
  }
  assert.deepEqual(updates.at(-1), { skin: 2, clothes: 2, hair: 2, shoes: 2 });
  await ui.root.all().find((node) => node.textContent === 'Продолжить').fire('click');
  await ui.root.all().find((node) => node.textContent === 'Назад').fire('click');
  assert.equal(ui.root.all().filter((node) => node.className === 'avatar-choice' && node.attributes['aria-pressed'] === 'true').length, 4);
  assert.deepEqual(updates.at(-1), { skin: 2, clothes: 2, hair: 2, shoes: 2 });
});

test('ошибки не сбрасывают выбор, повтор отправляет полный avatar, серверный user сохраняется', async () => {
  let count = 0;
  const serverUser = { name: 'Сервер', appearance: { skin: 1 } };
  const ui = mount({ join: async () => { if (count++ === 0) throw Object.assign(new Error('offline'), { code: 'network' }); return serverUser; } });
  await customize(ui);
  await ui.root.all().filter((node) => node.className === 'avatar-choice')[3].fire('click');
  await ui.root.all().find((node) => node.textContent === 'Продолжить').fire('click');
  await ui.root.all().find((node) => node.textContent === 'Войти в игру').fire('click');
  assert.match(ui.root.text(), /Сервер недоступен/);
  await ui.root.all().find((node) => node.textContent === 'Назад').fire('click');
  assert.equal(ui.root.all().filter((node) => node.className === 'avatar-choice')[3].attributes['aria-pressed'], 'true');
  await ui.root.all().find((node) => node.textContent === 'Продолжить').fire('click');
  await ui.root.all().find((node) => node.textContent === 'Войти в игру').fire('click');
  assert.deepEqual(ui.calls[1][2], { avatar: { skin: 3, clothes: 0, hair: 0, shoes: 0 } });
  assert.match(ui.root.text(), /Сервер/);
});

test('ошибки контракта показываются без потери выбора', async () => {
  for (const code of ['bad_name', 'bad_room', 'name_taken', 'bad_appearance']) {
    const ui = mount({ join: async () => { throw Object.assign(new Error('raw'), { code }); } });
    await customize(ui);
    await ui.root.all().filter((node) => node.className === 'avatar-choice')[1].fire('click');
    await ui.root.all().find((node) => node.textContent === 'Продолжить').fire('click');
    await ui.root.all().find((node) => node.textContent === 'Войти в игру').fire('click');
    assert.ok(ui.root.all().some((node) => node.attributes.role === 'alert' && !node.hidden));
    await ui.root.all().find((node) => node.textContent === 'Назад').fire('click');
    assert.equal(ui.root.all().filter((node) => node.className === 'avatar-choice')[1].attributes['aria-pressed'], 'true');
  }
});

test('все 16 кнопок обновляют только выбранную категорию, оформление и preview', async () => {
  const updates = [];
  const ui = mount({ createPreview: () => ({ setAvatar: (value) => updates.push(value) }) });
  await customize(ui);
  const state = { skin: 0, clothes: 0, hair: 0, shoes: 0 };
  const groups = ui.root.all().filter((node) => node.tag === 'fieldset');
  for (const [groupIndex, key] of ['skin', 'clothes', 'hair', 'shoes'].entries()) {
    const choices = groups[groupIndex].all().filter((node) => node.className === 'avatar-choice');
    for (let value = 0; value < 4; value++) {
      const count = updates.length;
      await choices[value].fire('click');
      state[key] = value;
      assert.equal(updates.length, count + 1);
      assert.deepEqual(updates.at(-1), state);
      assert.deepEqual(choices.map((node) => node.attributes['aria-pressed']), choices.map((_, i) => String(i === value)));
    }
  }
  ui.dispose();
});

// Авторизация Control Center: закрыто без пароля, вход, сессия, CSRF, Origin, адрес клиента, лимит попыток.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_PASSWORD, adminLogin, adminRequest, join, makeAdminApp, makeApp } from './helpers.js';

const HEADERS = { host: 'localhost:3000', origin: 'http://localhost:3000' };
const PROTECTED = [
  ['GET', '/api/admin/overview'],
  ['GET', '/api/admin/clients'],
  ['GET', '/api/admin/stream'],
  ['GET', '/api/admin/world'],
  ['GET', '/api/admin/world/interactive'],
  ['POST', '/api/admin/world/objects'],
  ['PATCH', '/api/admin/world/objects/o_0000000000'],
  ['DELETE', '/api/admin/world/objects/o_0000000000'],
  ['POST', '/api/admin/world/undo'],
  ['POST', '/api/admin/world/clear'],
  ['GET', '/api/admin/agents'],
  ['PUT', '/api/admin/agents/marusya'],
  ['DELETE', '/api/admin/agents/marusya/settings'],
  ['POST', '/api/admin/agents/marusya/test'],
  ['GET', '/api/admin/audit'],
  ['POST', '/api/admin/logout'],
];

test('без ADMIN_PASSWORD панель закрыта: 503, а не открытый доступ', async () => {
  const app = await makeApp();
  for (const url of ['/api/admin/status', '/api/admin/overview', '/api/admin/world']) {
    const res = await app.inject({ method: 'GET', url, headers: HEADERS });
    assert.equal(res.statusCode, 503, url);
    assert.equal(res.json().error, 'admin_disabled');
  }
  const login = await app.inject({ method: 'POST', url: '/api/admin/login', headers: HEADERS, payload: { password: 'anything-at-all' } });
  assert.equal(login.statusCode, 503);
  await app.close();
});

test('слишком короткий пароль тоже считается «не задан»', async () => {
  const app = await makeApp({ adminPassword: 'short' });
  const res = await app.inject({ method: 'GET', url: '/api/admin/overview', headers: HEADERS });
  assert.equal(res.statusCode, 503);
  await app.close();
});

test('неавторизованный запрос не проходит ни в один административный маршрут', async () => {
  const app = await makeAdminApp();
  for (const [method, url] of PROTECTED) {
    const res = await app.inject({ method, url, headers: HEADERS, payload: method === 'GET' || method === 'DELETE' ? undefined : {} });
    assert.ok([401, 403].includes(res.statusCode), `${method} ${url} -> ${res.statusCode}`);
  }
  await app.close();
});

test('игрок с действующим токеном и кодом комнаты прав администратора не получает', async () => {
  const app = await makeAdminApp();
  const { token } = await join(app, 'Игрок');
  for (const [method, url] of PROTECTED) {
    const res = await app.inject({
      method,
      url,
      headers: { ...HEADERS, authorization: `Bearer ${token}`, 'x-csrf-token': 'x' },
      payload: method === 'GET' || method === 'DELETE' ? undefined : {},
    });
    assert.equal(res.statusCode, 401, `${method} ${url}`);
  }
  // Подделанная cookie с токеном игрока и код комнаты вместо пароля тоже не работают.
  const forged = await app.inject({ method: 'GET', url: '/api/admin/overview', headers: { ...HEADERS, cookie: `carrierium_admin=${token}` } });
  assert.equal(forged.statusCode, 401);
  const byRoom = await app.inject({ method: 'POST', url: '/api/admin/login', headers: HEADERS, payload: { password: app.room.code } });
  assert.equal(byRoom.statusCode, 401);
  await app.close();
});

test('вход: верный пароль выдаёт HttpOnly SameSite=Strict cookie, неверный отклоняется', async () => {
  const app = await makeAdminApp();
  const bad = await app.inject({ method: 'POST', url: '/api/admin/login', headers: HEADERS, payload: { password: 'wrong-password' } });
  assert.equal(bad.statusCode, 401);
  assert.equal(bad.headers['set-cookie'], undefined);

  const ok = await app.inject({ method: 'POST', url: '/api/admin/login', headers: HEADERS, payload: { password: ADMIN_PASSWORD } });
  assert.equal(ok.statusCode, 200);
  const cookie = ok.headers['set-cookie'];
  assert.match(cookie, /^carrierium_admin=[A-Za-z0-9_-]{40,}/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.ok(!ok.body.includes(ADMIN_PASSWORD), 'пароль не возвращается клиенту');
  assert.equal(ok.headers['cache-control'], 'no-store');

  const session = { cookie: cookie.split(';')[0], csrf: ok.json().csrf };
  const overview = await adminRequest(app, session, 'GET', '/api/admin/overview');
  assert.equal(overview.statusCode, 200);
  await app.close();
});

test('после пяти неверных попыток вход блокируется даже с верным паролем', async () => {
  const app = await makeAdminApp();
  for (let i = 0; i < 5; i++) {
    const res = await app.inject({ method: 'POST', url: '/api/admin/login', headers: HEADERS, payload: { password: `wrong-${i}-password` } });
    assert.equal(res.statusCode, 401);
  }
  const blocked = await app.inject({ method: 'POST', url: '/api/admin/login', headers: HEADERS, payload: { password: ADMIN_PASSWORD } });
  assert.equal(blocked.statusCode, 429);
  await app.close();
});

test('изменяющие запросы: нужен CSRF-токен и Origin этого же хоста', async () => {
  const app = await makeAdminApp();
  const session = await adminLogin(app);
  const payload = { type: 'bench', x: 300, z: 300 };

  const noCsrf = await app.inject({ method: 'POST', url: '/api/admin/world/validate', headers: { ...HEADERS, cookie: session.cookie }, payload });
  assert.equal(noCsrf.statusCode, 403);
  assert.equal(noCsrf.json().error, 'bad_csrf');

  const wrongCsrf = await adminRequest(app, session, 'POST', '/api/admin/world/validate', payload, { 'x-csrf-token': 'x'.repeat(session.csrf.length) });
  assert.equal(wrongCsrf.statusCode, 403);

  const evil = await adminRequest(app, session, 'POST', '/api/admin/world/validate', payload, { origin: 'http://evil.example' });
  assert.equal(evil.statusCode, 403);
  assert.ok(['bad_origin', 'admin_remote_disabled'].includes(evil.json().error)); // чужой Origin отсекает уже проверка адреса владельца

  const noOrigin = await app.inject({ method: 'POST', url: '/api/admin/world/validate', headers: { host: 'localhost:3000', cookie: session.cookie, 'x-csrf-token': session.csrf }, payload });
  assert.equal(noOrigin.statusCode, 403);

  const good = await adminRequest(app, session, 'POST', '/api/admin/world/validate', payload);
  assert.equal(good.statusCode, 200);
  await app.close();
});

test('вход с чужого Origin отклоняется до проверки пароля', async () => {
  const app = await makeAdminApp();
  const res = await app.inject({ method: 'POST', url: '/api/admin/login', headers: { host: 'localhost:3000', origin: 'http://evil.example' }, payload: { password: ADMIN_PASSWORD } });
  assert.equal(res.statusCode, 403);
  assert.equal(res.headers['set-cookie'], undefined);
  await app.close();
});

test('выход завершает сессию: cookie больше не работает', async () => {
  const app = await makeAdminApp();
  const session = await adminLogin(app);
  const out = await adminRequest(app, session, 'POST', '/api/admin/logout');
  assert.equal(out.statusCode, 200);
  assert.match(out.headers['set-cookie'], /Max-Age=0/);
  const after = await adminRequest(app, session, 'GET', '/api/admin/overview');
  assert.equal(after.statusCode, 401);
  await app.close();
});

test('сессии живут только в памяти: после перезапуска сервера старая cookie не действует', async () => {
  const first = await makeAdminApp();
  const session = await adminLogin(first);
  await first.close();
  const second = await makeAdminApp();
  const res = await adminRequest(second, session, 'GET', '/api/admin/overview');
  assert.equal(res.statusCode, 401);
  await second.close();
});

test('доступ с другого компьютера закрыт по умолчанию и открывается явной настройкой', async () => {
  const remote = { remoteAddress: '192.168.50.7' };
  const closed = await makeAdminApp({ localAddresses: () => ['192.168.50.1'] });
  const denied = await closed.inject({ method: 'GET', url: '/api/admin/status', headers: HEADERS, remoteAddress: remote.remoteAddress });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json().error, 'admin_remote_disabled');
  const page = await closed.inject({ method: 'GET', url: '/admin/', remoteAddress: remote.remoteAddress, headers: HEADERS });
  assert.equal(page.statusCode, 403);
  await closed.close();

  const open = await makeAdminApp({ adminAllowRemote: true, localAddresses: () => ['192.168.50.1'] });
  const allowed = await open.inject({ method: 'GET', url: '/api/admin/status', headers: HEADERS, remoteAddress: remote.remoteAddress });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.json().remoteAllowed, true);
  await open.close();
});

test('ответы админ-API не кешируются и не содержат пароль, а страница получает CSP', async () => {
  const app = await makeAdminApp();
  const session = await adminLogin(app);
  const res = await adminRequest(app, session, 'GET', '/api/admin/overview');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.ok(!res.body.includes(ADMIN_PASSWORD));
  const audit = await adminRequest(app, session, 'GET', '/api/admin/audit');
  assert.ok(!audit.body.includes(ADMIN_PASSWORD));
  assert.ok(!audit.body.includes(session.csrf));
  await app.close();
});

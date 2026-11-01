// Экран входа и состояния «панель недоступна».

import { useState } from 'preact/hooks';
import logoUrl from '../../../assets/branding/careerium-logo.png';
import { session, login, boot } from '../state.js';
import { useStore } from '../lib/store.js';
import { Button, Icon, Notice, Spinner } from './ui.jsx';

export function Brand({ small = false }) {
  return (
    <div class={`brand ${small ? 'brand--small' : ''}`}>
      <img src={logoUrl} alt="" class="brand__logo" width="56" height="56" />
      <div class="brand__text">
        <strong>CARRIERIUM</strong>
        <span>Control Center</span>
      </div>
    </div>
  );
}

function Shell({ children }) {
  return (
    <main class="gate">
      <div class="gate__card card">
        <Brand />
        {children}
      </div>
    </main>
  );
}

export function GateScreen() {
  const { phase, message, busy } = useStore(session);
  const [password, setPassword] = useState('');

  if (phase === 'loading') {
    return (
      <Shell>
        <div class="gate__body"><Spinner label="Проверяем доступ…" /></div>
      </Shell>
    );
  }
  if (phase === 'disabled') {
    return (
      <Shell>
        <h1 class="gate__title">Панель отключена</h1>
        <p class="gate__text">Административный пароль на сервере не задан, поэтому доступ закрыт.</p>
        <ol class="gate__steps">
          <li>Остановите сервер.</li>
          <li>Задайте переменную окружения <code>ADMIN_PASSWORD</code> (не короче 8 символов), например: <code>ADMIN_PASSWORD=ваш-пароль npm start</code>.</li>
          <li>Запустите сервер заново и обновите эту страницу.</li>
        </ol>
        <Button variant="secondary" icon="refresh" onClick={boot}>Проверить снова</Button>
      </Shell>
    );
  }
  if (phase === 'remote') {
    return (
      <Shell>
        <h1 class="gate__title">Доступ только с компьютера сервера</h1>
        <p class="gate__text">Панель администратора открыта только на самом компьютере, где запущен сервер. Откройте её там по адресу <code>localhost:порт/admin/</code>.</p>
        <p class="gate__text gate__text--muted">Удалённый доступ можно включить явно переменной <code>ADMIN_ALLOW_REMOTE=1</code>, но делайте это только в доверенной сети.</p>
      </Shell>
    );
  }
  if (phase === 'unreachable') {
    return (
      <Shell>
        <h1 class="gate__title">Сервер не отвечает</h1>
        <p class="gate__text">{message || 'Не удалось связаться с сервером.'}</p>
        <Button variant="primary" icon="refresh" onClick={boot}>Повторить</Button>
      </Shell>
    );
  }

  const submit = (e) => {
    e.preventDefault();
    if (!password || busy) return;
    login(password).then(() => { setPassword(''); document.getElementById('admin-password')?.focus(); });
  };
  return (
    <Shell>
      <h1 class="gate__title">Вход для администратора</h1>
      <p class="gate__text">Введите пароль, заданный на сервере.</p>
      <form class="gate__form" onSubmit={submit}>
        <div class="field">
          <div class="field__head"><label for="admin-password">Пароль</label></div>
          <input id="admin-password" class="input" type="password" autocomplete="current-password" autofocus value={password} onInput={(e) => setPassword(e.currentTarget.value)} aria-describedby="login-msg" disabled={busy} />
        </div>
        <div id="login-msg"><Notice tone="bad">{message}</Notice></div>
        <Button variant="primary" busy={busy} disabled={!password} type="submit" class="btn--block"><Icon name="lock" size={16} />Войти</Button>
      </form>
    </Shell>
  );
}

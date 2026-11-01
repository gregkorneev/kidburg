// Каркас: шапка, вкладки с клавиатурной навигацией, индикатор связи, выход.

import { useEffect, useRef } from 'preact/hooks';
import { live, logout, prefs, session, setPref } from '../state.js';
import { useStore } from '../lib/store.js';
import { Brand, GateScreen } from './Login.jsx';
import { Overview } from './Overview.jsx';
import { Clients } from './Clients.jsx';
import { World } from './World.jsx';
import { Agents } from './Agents.jsx';
import { Audit } from './Audit.jsx';
import { Button, Icon, Pill } from './ui.jsx';

const TABS = [
  { id: 'overview', label: 'Обзор', icon: 'overview', View: Overview },
  { id: 'clients', label: 'Клиенты', icon: 'clients', View: Clients },
  { id: 'world', label: 'Мир', icon: 'world', View: World },
  { id: 'agents', label: 'Агенты', icon: 'agents', View: Agents },
  { id: 'audit', label: 'Журнал', icon: 'audit', View: Audit },
];

function ConnectionPill() {
  const conn = useStore(live, (s) => s.conn);
  if (conn === 'online') return <Pill tone="ok" dot title="Поток данных активен">Онлайн</Pill>;
  if (conn === 'idle') return <Pill tone="muted" dot>Нет связи</Pill>;
  return <Pill tone="warn" dot title="Данные обновятся автоматически после подключения">{conn === 'connecting' ? 'Подключение…' : 'Переподключение…'}</Pill>;
}

function Dashboard() {
  const tabId = useStore(prefs, (p) => (TABS.some((t) => t.id === p.tab) ? p.tab : 'overview'));
  const refs = useRef({});
  const active = TABS.find((t) => t.id === tabId);

  const onKey = (e) => {
    const i = TABS.findIndex((t) => t.id === tabId);
    let next = null;
    if (e.key === 'ArrowRight') next = TABS[(i + 1) % TABS.length];
    else if (e.key === 'ArrowLeft') next = TABS[(i + TABS.length - 1) % TABS.length];
    else if (e.key === 'Home') next = TABS[0];
    else if (e.key === 'End') next = TABS[TABS.length - 1];
    if (next) {
      e.preventDefault();
      setPref({ tab: next.id });
      refs.current[next.id]?.focus();
    }
  };

  useEffect(() => {
    document.title = `${active.label} — Control Center CARRIERIUM`;
  }, [active]);

  return (
    <div class="shell">
      <header class="topbar">
        <Brand small />
        <nav class="tabs" role="tablist" aria-label="Разделы панели" onKeyDown={onKey}>
          {TABS.map((t) => (
            <button key={t.id} id={`tab-${t.id}`} ref={(el) => (refs.current[t.id] = el)} type="button" role="tab" aria-selected={t.id === tabId} aria-controls="tabpanel" tabIndex={t.id === tabId ? 0 : -1} class="tab" onClick={() => setPref({ tab: t.id })}>
              <Icon name={t.icon} size={17} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
        <div class="topbar__right">
          <ConnectionPill />
          <Button variant="ghost" small icon="logout" onClick={logout} title="Выйти из панели">Выйти</Button>
        </div>
      </header>
      <main id="tabpanel" role="tabpanel" aria-labelledby={`tab-${tabId}`} class={`content content--${tabId}`} tabIndex={-1}>
        <active.View />
      </main>
    </div>
  );
}

export function App() {
  const phase = useStore(session, (s) => s.phase);
  return phase === 'ready' ? <Dashboard /> : <GateScreen />;
}

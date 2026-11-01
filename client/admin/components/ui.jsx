// Общие элементы интерфейса: иконки, кнопки, подтверждение на месте, плашки, состояния.

import { useEffect, useRef, useState } from 'preact/hooks';

const ICONS = {
  overview: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  clients: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5M16 4.5a3.2 3.2 0 0 1 0 6M18 14.8c2 .7 3.5 2.3 3.5 5.2',
  world: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14',
  agents: 'M12 3v3M7 8h10a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3zM9 13h.01M15 13h.01M9.5 16.5h5',
  audit: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7',
  logout: 'M10 4H5v16h5M14 8l4 4-4 4M18 12H9',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  refresh: 'M20 11a8 8 0 0 0-14-4M4 4v4h4M4 13a8 8 0 0 0 14 4M20 20v-4h-4',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  chevron: 'M9 6l6 6-6 6',
  alert: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  send: 'M4 12l16-8-6 16-3-6z',
  cursor: 'M5 4l14 7-6 2-2 6z',
  sortUp: 'M7 14l5-5 5 5',
  sortDown: 'M7 10l5 5 5-5',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
};

export function Icon({ name, size = 18, class: cls = '' }) {
  return (
    <svg class={`icon ${cls}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      <path d={ICONS[name] ?? ''} />
    </svg>
  );
}

export function Spinner({ label = 'Загрузка…' }) {
  return (
    <span class="spinner" role="status">
      <span class="spinner__dot" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

/** variant: primary | secondary | ghost | danger */
export function Button({ variant = 'secondary', icon, busy = false, disabled = false, small = false, children, class: cls = '', ...rest }) {
  return (
    <button type="button" class={`btn btn--${variant} ${small ? 'btn--small' : ''} ${cls}`} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <span class="btn__spin" aria-hidden="true" /> : icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </button>
  );
}

/** Опасное действие с подтверждением на месте (без модального окна). */
export function ConfirmButton({ label, confirmLabel = 'Да, выполнить', question, icon = 'trash', onConfirm, busy = false, disabled = false, small = false }) {
  const [asking, setAsking] = useState(false);
  const noRef = useRef(null);
  useEffect(() => {
    if (asking) noRef.current?.focus();
  }, [asking]);
  useEffect(() => {
    if (busy) setAsking(false);
  }, [busy]);
  if (!asking) {
    return (
      <Button variant="danger" icon={icon} small={small} disabled={disabled} busy={busy} onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  }
  return (
    <span class="confirm" role="group" aria-label="Подтверждение" onKeyDown={(e) => e.key === 'Escape' && setAsking(false)}>
      <span class="confirm__q">{question}</span>
      <Button variant="danger" small onClick={() => { setAsking(false); onConfirm(); }}>{confirmLabel}</Button>
      <button type="button" class="btn btn--ghost btn--small" ref={noRef} onClick={() => setAsking(false)}>Отмена</button>
    </span>
  );
}

/** tone: ok | warn | bad | info | muted */
export function Pill({ tone = 'muted', dot = false, children, title }) {
  return (
    <span class={`pill pill--${tone}`} title={title}>
      {dot ? <span class="pill__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function EmptyState({ title, children, icon }) {
  return (
    <div class="empty">
      {icon ? <Icon name={icon} size={28} /> : null}
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

/** Сообщение об ошибке/успехе: aria-live, чтобы вспомогательные технологии зачитывали статус. */
export function Notice({ tone = 'bad', children, action }) {
  if (!children) return <div class="notice-slot" role="status" aria-live="polite" />;
  return (
    <div class={`notice notice--${tone}`} role={tone === 'bad' ? 'alert' : 'status'} aria-live="polite">
      <Icon name={tone === 'ok' ? 'check' : 'alert'} size={16} />
      <span class="notice__text">{children}</span>
      {action}
    </div>
  );
}

/** Подпись + элемент управления + подсказка/ошибка; for связывает подпись с полем. */
export function Field({ id, label, help, error, counter, children, class: cls = '' }) {
  return (
    <div class={`field ${error ? 'field--error' : ''} ${cls}`}>
      <div class="field__head">
        <label for={id}>{label}</label>
        {counter ? <span class="field__counter">{counter}</span> : null}
      </div>
      {children}
      {error ? <p class="field__error" id={`${id}-err`}>{error}</p> : help ? <p class="field__help" id={`${id}-help`}>{help}</p> : null}
    </div>
  );
}

export function Toggle({ id, checked, onChange, label, disabled }) {
  return (
    <button type="button" id={id} role="switch" aria-checked={checked} aria-label={label} class={`toggle ${checked ? 'toggle--on' : ''}`} disabled={disabled} onClick={() => onChange(!checked)}>
      <span class="toggle__knob" />
      <span class="toggle__text">{checked ? 'Вкл' : 'Выкл'}</span>
    </button>
  );
}

export function Segmented({ value, options, onChange, label }) {
  return (
    <div class="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} class={value === o.value ? 'is-active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

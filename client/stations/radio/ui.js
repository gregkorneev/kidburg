import { h, render } from 'preact';
import { TELEPROMPTER_SPEED_LABELS } from './teleprompter.js';

const CATEGORY_NAMES = Object.freeze({ weather: 'Погода', science: 'Научный факт' });

export function RadioScreen({
  state, pending, connected, notice, countdown, speed, paused, prompterGroup,
  onStart, onComplete, onNew, onSpeed, onPause, onLeave,
}) {
  const stage = !state || state.stage === 'idle' || state.stage === 'choose_topic' ? 'preparing' : state.stage;
  const script = state?.script;
  return h('div', { class: 'radio-shell' },
    h('section', { class: 'radio-frame', 'aria-label': 'Монитор радиостанции' },
      h('div', { class: 'radio-monitor' },
        h('header', { class: 'radio-topbar' },
          h('span', { class: 'radio-title' }, 'РАДИОСТАНЦИЯ'),
          h('span', { class: 'radio-status' },
            h('span', { class: `radio-dot${stage === 'on_air' && countdown === null ? ' radio-dot--live' : ''}`, 'aria-hidden': 'true' }),
            stage === 'on_air' && countdown === null ? 'ЭФИР' : 'РАБОЧИЙ МОНИТОР',
          ),
          h('button', { class: 'radio-exit', type: 'button', onClick: onLeave }, 'Выйти из уровня'),
        ),
        h('main', { class: 'radio-content', 'aria-live': 'polite' },
          stage === 'preparing' && h('div', { class: 'radio-preparing', role: 'status' },
            h('p', { class: 'radio-eyebrow' }, 'РАДИОСТАНЦИЯ'),
            h('h1', null, 'ИИ готовит выпуск'),
            h('p', { class: 'radio-copy' }, 'Редактор выбирает тему и готовит сценарий для эфира.'),
            h('p', { class: 'radio-note' }, pending ? 'Подбираем тему и пишем текст…' : connected ? 'Восстанавливаем подготовку выпуска…' : 'Подключаемся к радиостанции…'),
          ),
          state && stage === 'ready' && script && h('div', { class: 'radio-ready-view' },
            h('p', { class: 'radio-eyebrow' }, CATEGORY_NAMES[script.category]),
            h('h1', { class: 'radio-script-title' }, script.title),
            script.source === 'offline_fallback' && h('p', { class: 'radio-note' }, 'Для выпуска подготовлен проверенный учебный сценарий.'),
            h('div', { class: 'radio-script' }, script.text),
            h('p', { class: 'radio-speed-label' }, 'Скорость телесуфлёра'),
            h('div', { class: 'radio-speed', 'aria-label': 'Скорость телесуфлёра' },
              ...Object.entries(TELEPROMPTER_SPEED_LABELS).map(([key, label]) => h('button', {
                type: 'button', 'aria-pressed': speed === key, onClick: () => onSpeed(key),
              }, label)),
            ),
            h('div', { class: 'radio-actions' }, h('button', {
              class: 'radio-button radio-button--primary', type: 'button', disabled: Boolean(pending), onClick: onStart,
            }, pending === 'start_broadcast' ? 'Запускаем эфир…' : 'Начать эфир')),
          ),
          state && stage === 'on_air' && script && h('div', { class: 'radio-live-view' },
            countdown !== null
              ? h('div', { class: 'radio-countdown', role: 'status' },
                  h('p', { class: 'radio-eyebrow' }, 'ПРИГОТОВЬСЯ К ЭФИРУ'),
                  h('h1', { style: { fontSize: 'clamp(76px, 18vw, 150px)', textAlign: 'center', color: '#f0af58' } }, String(countdown)),
                )
              : h('div', null,
                  h('div', { class: 'radio-live-badge' }, h('span', { class: 'radio-dot radio-dot--live', 'aria-hidden': 'true' }), 'ON AIR'),
                  h('div', { class: 'radio-prompter-window', role: 'region', 'aria-label': 'Телесуфлёр', 'aria-live': 'polite' },
                    h('div', { class: 'radio-prompter-text' }, prompterGroup || '…'),
                  ),
                  h('div', { class: 'radio-live-controls' },
                    h('button', { type: 'button', onClick: onPause }, paused ? 'Продолжить' : 'Пауза'),
                    h('button', { class: 'radio-button radio-button--primary', type: 'button', disabled: Boolean(pending), onClick: onComplete },
                      pending === 'complete_broadcast' ? 'Завершаем эфир…' : 'Завершить эфир'),
                  ),
                ),
          ),
          state && stage === 'completed' && h('div', null,
            h('p', { class: 'radio-eyebrow' }, 'ВЫПУСК ЗАВЕРШЁН'),
            h('h1', null, 'Эфир завершён!'),
            h('p', { class: 'radio-copy' }, 'Отличная работа! Ты провёл радиовыпуск.'),
            h('div', { class: 'radio-actions' }, h('button', {
              class: 'radio-button radio-button--primary', type: 'button', disabled: Boolean(pending), onClick: onNew,
            }, pending === 'new_broadcast' ? 'Готовим новый выпуск…' : 'Новый выпуск')),
          ),
          notice && h('p', { class: 'radio-error', role: 'alert' }, notice),
          !connected && h('p', { class: 'radio-note radio-offline', role: 'status' }, 'Нет соединения. Подключаемся заново; экран восстановится из сохранённого состояния.'),
          connected && state && h('p', { class: 'radio-note radio-online' }, 'Связь с радиостанцией установлена'),
        ),
      ),
    ),
  );
}

export function mountRadioUI(root, props) {
  render(h(RadioScreen, props), root);
}

export function unmountRadioUI(root) {
  render(null, root);
}

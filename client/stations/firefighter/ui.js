import { h, render } from 'preact';
import { FIRE_HIT_LIMIT, OBJECTIVES } from './state.js';

function Button({ option, onChoose, busy }) {
  return h('button', {
    class: `choice-button${option.primary ? ' choice-button--primary' : ''}`,
    type: 'button',
    disabled: busy,
    onClick: () => onChoose(option),
  }, option.label);
}

function StationUI({ state, prompt, notice, dialog, hoseActive, busy = false, onChoose, onCloseDialog }) {
  const progress = Math.round((state.fireHits / FIRE_HIT_LIMIT) * 100);
  return h('div', { class: 'station-ui' },
    h('header', { class: 'topbar' },
      h('div', { class: 'brand' },
        h('div', { class: 'brand-mark', 'aria-hidden': 'true' }, 'К'),
        h('div', null,
          h('strong', null, 'ПОЖАРНАЯ ЧАСТЬ'),
          h('span', null, 'Учебная смена'),
        ),
      ),
      h('div', { class: 'demo-badge' }, 'СЕТЕВОЙ РЕЖИМ'),
    ),

    h('section', { class: 'objective-card', 'aria-live': 'polite' },
      h('span', { class: 'eyebrow' }, state.stage === 'completed' ? 'СМЕНА ЗАВЕРШЕНА' : 'ТЕКУЩАЯ ЦЕЛЬ'),
      h('h1', null, OBJECTIVES[state.stage]),
      state.stage === 'fire_drill' && h('div', { class: 'progress-wrap' },
        h('div', { class: 'progress-label' },
          h('span', null, 'Учебная мишень'),
          h('strong', null, `${progress}%`),
        ),
        h('div', { class: 'progress-track' },
          h('div', { class: 'progress-value', style: { width: `${progress}%` } }),
        ),
      ),
      state.stage === 'completed' && h('p', { class: 'completion-copy' }, 'Ты прошёл инструктаж, подготовился и завершил два учебных задания.'),
    ),

    h('div', { class: 'center-reticle', 'aria-hidden': 'true' }, h('span')),

    h('aside', { class: 'controls-card' },
      h('span', { class: 'eyebrow' }, 'УПРАВЛЕНИЕ'),
      h('div', { class: 'control-row' }, h('kbd', null, 'W A S D'), h('span', null, 'движение')),
      h('div', { class: 'control-row' }, h('kbd', null, 'SHIFT'), h('span', null, 'быстрее')),
      h('div', { class: 'control-row' }, h('kbd', null, 'E'), h('span', null, 'действие')),
      h('div', { class: 'control-row' }, h('kbd', null, 'ESC'), h('span', null, 'курсор')),
      hoseActive && h('p', { class: 'hose-tip' }, 'Наведите прицел на огонь и удерживайте левую кнопку мыши.'),
      h('p', { class: 'demo-note' }, 'Прогресс хранится на сервере.'),
    ),

    prompt && h('div', { class: 'interaction-prompt', 'aria-live': 'polite' },
      h('kbd', null, 'E'), h('span', null, prompt),
    ),

    notice && h('div', { class: 'toast', role: 'status' }, notice),

    h('footer', { class: 'safety-note' }, 'Игровая тренировка условная и не заменяет реальные инструкции экстренных служб.'),

    dialog && h('div', { class: 'dialog-backdrop', onClick: onCloseDialog },
      h('section', {
        class: 'dialog-card',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'dialog-title',
        onClick: (event) => event.stopPropagation(),
      },
        h('div', { class: 'dialog-avatar', 'aria-hidden': 'true' }, 'М'),
        h('span', { class: 'eyebrow' }, 'МАРУСЯ ГРОМОВА · НАСТАВНИК'),
        h('h2', { id: 'dialog-title' }, dialog.title),
        h('p', null, dialog.body),
        h('div', { class: 'dialog-actions' }, dialog.options.map((option) =>
          h(Button, { key: option.label, option, onChoose, busy }))),
      ),
    ),
  );
}

export function mountStationUI(root, props) {
  render(h(StationUI, props), root);
}

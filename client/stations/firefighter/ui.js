import { h, render } from 'preact';
import { OBJECTIVES, WINDOW_COUNT, WINDOW_HIT_LIMIT, countDoneWindows } from './state.js';
import { QUALITY_LABELS, QUALITY_LEVELS } from '../../engine/art/quality.js';

function Button({ option, onChoose, busy }) {
  return h('button', {
    class: `choice-button${option.primary ? ' choice-button--primary' : ''}`,
    type: 'button',
    disabled: busy,
    onClick: () => onChoose(option),
  }, option.label);
}

export function StationUI({
  state, prompt, notice, dialog, hoseActive, targetWindow = null, busy = false, controlsOpen = true, quality = 'medium',
  onChoose, onCloseDialog, onToggleControls = () => {}, onQuality = () => {},
}) {
  const done = countDoneWindows(state.windows);
  const target = targetWindow === null ? undefined : state.windows[targetWindow];
  const progress = target === undefined ? 0 : Math.round((target / WINDOW_HIT_LIMIT) * 100);
  return h('div', { class: 'station-ui' },
    h('header', { class: 'topbar' },
      h('div', { class: 'brand' },
        h('div', { class: 'brand-mark', 'aria-hidden': 'true' }, 'К'),
        h('div', null,
          h('strong', null, 'ПОЖАРНАЯ ЧАСТЬ'),
          h('span', null, 'Учебная смена'),
        ),
      ),
    ),

    h('section', { class: 'objective-card', 'aria-live': 'polite' },
      h('span', { class: 'eyebrow' }, state.stage === 'completed' ? 'СМЕНА ЗАВЕРШЕНА' : 'ТЕКУЩАЯ ЦЕЛЬ'),
      h('h1', null, OBJECTIVES[state.stage]),
      state.stage === 'fire_drill' && h('div', { class: 'progress-wrap' },
        h('div', { class: 'progress-label' },
          h('span', null, `Потушено окон: ${done}/${WINDOW_COUNT}`),
          h('strong', null, target === undefined ? 'Наведите прицел на окно' : `Окно ${targetWindow + 1}: ${progress}%`),
        ),
        h('div', { class: 'progress-track' },
          h('div', { class: 'progress-value', style: { width: `${progress}%` } }),
        ),
      ),
      state.stage === 'completed' && h('p', { class: 'completion-copy' }, 'Ты потушил все окна учебной стены и доставил манекен в безопасную зону.'),
    ),

    h('div', { class: 'center-reticle', 'aria-hidden': 'true' }, h('span')),

    h('aside', { class: `controls-card${controlsOpen ? '' : ' controls-card--closed'}` },
      h('button', {
        class: 'controls-toggle',
        type: 'button',
        'aria-expanded': controlsOpen,
        title: 'Показать или скрыть подсказки (H)',
        onClick: onToggleControls,
      }, h('span', { class: 'eyebrow' }, 'УПРАВЛЕНИЕ'), h('kbd', null, controlsOpen ? 'H' : '?')),
      controlsOpen && h('div', { class: 'controls-body' },
        h('div', { class: 'control-row' }, h('kbd', null, 'W A S D'), h('span', null, 'движение')),
        h('div', { class: 'control-row' }, h('kbd', null, 'SHIFT'), h('span', null, 'быстрее')),
        h('div', { class: 'control-row' }, h('kbd', null, 'E'), h('span', null, 'действие')),
        h('div', { class: 'control-row' }, h('kbd', null, 'L'), h('span', null, 'в город')),
        h('div', { class: 'control-row' }, h('kbd', null, 'ESC'), h('span', null, 'курсор')),
        h('div', { class: 'quality-row', role: 'group', 'aria-label': 'Качество графики' },
          h('span', null, 'Графика'),
          QUALITY_LEVELS.map((level) => h('button', {
            key: level,
            type: 'button',
            class: `quality-button${level === quality ? ' quality-button--active' : ''}`,
            'aria-pressed': level === quality,
            onClick: () => onQuality(level),
          }, QUALITY_LABELS[level]))),
      ),
      hoseActive && h('p', { class: 'hose-tip' }, 'Наведите прицел на окно с огнём и удерживайте левую кнопку мыши.'),
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

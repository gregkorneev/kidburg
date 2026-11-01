import { h, render } from 'preact';
import { LESSON, MELODY, NOTES, noteById } from './melody.js';
import { STAGE_LABELS } from './state.js';
import { QUALITY_LABELS, QUALITY_LEVELS } from '../../engine/art/quality.js';

function targetSequence(stage) {
  if (stage === 'learning') return LESSON;
  if (['practice', 'concert'].includes(stage)) return MELODY;
  return [];
}

function LessonCard({ state, onListen }) {
  if (state.stage === 'not_started' || state.stage === 'briefing' || state.stage === 'completed') return null;
  const sequence = targetSequence(state.stage);
  const current = sequence[state.index] ?? null;
  const complete = sequence.length ? state.index / sequence.length : 1;
  return h('section', { class: 'lesson-card', 'aria-live': 'polite' },
    h('div', { class: 'eyebrow' }, `ЭТАП · ${STAGE_LABELS[state.stage]}`),
    h('div', { class: 'lesson-heading' },
      h('div', null, h('h2', null, state.stage === 'learning' ? 'Познакомься с клавишами' : state.stage === 'concert' ? 'Твой выход!' : 'Разучи мелодию')),
      state.stage !== 'learning' && h('button', { class: 'listen-button', type: 'button', onClick: onListen }, '▶ Послушать пример'),
    ),
    current && h('div', { class: 'next-note' }, h('span', null, 'СЛЕДУЮЩАЯ НОТА'), h('strong', null, noteById(current).label), h('kbd', null, noteById(current).key?.replace('Key', '') ?? 'мышь')),
    h('div', { class: 'progress-track', role: 'progressbar', 'aria-valuenow': Math.round(complete * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('span', { style: { width: `${complete * 100}%` } })),
    h('div', { class: 'score-strip', 'aria-label': 'Последовательность нот' }, sequence.map((id, index) => h('span', {
      key: `${id}-${index}`, class: `score-note${index < state.index ? ' is-done' : index === state.index ? ' is-next' : ''}`,
    }, noteById(id).label))),
    h('p', { class: 'tempo-hint' }, 'Играй в удобном темпе — время не ограничено.'),
    h('div', { class: 'keyboard-map' }, NOTES.filter((note) => !note.black).map((note) => h('span', { key: note.id, class: current === note.id ? 'is-target' : '' }, h('kbd', null, note.key.replace('Key', '')), note.label))),
  );
}

function Dialog({ stage, onAccept, onRepeat }) {
  if (stage === 'briefing') return h('div', { class: 'dialog-backdrop' }, h('section', { class: 'dialog-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dialog-title' },
    h('div', { class: 'maestro-mark' }, '♪'), h('span', { class: 'eyebrow' }, 'МАЭСТРО АРТЁМ · ПРЕПОДАВАТЕЛЬ МУЗЫКИ'),
    h('h2', { id: 'dialog-title' }, 'Добро пожаловать в музыкальную школу!'),
    h('p', null, 'Привет! Я Артём, преподаватель музыки. Сегодня ты попробуешь себя в роли пианиста. Сначала познакомимся с нотами, затем разучим мелодию и выступим перед зрителями!'),
    h('p', null, 'Подойди к пианино и нажми E. Играй клавишами A S D F G H J K или нажимай прямо на клавиши мышью. Esc вернёт к прогулке.'),
    h('button', { type: 'button', class: 'primary-button', onClick: onAccept }, 'Начать урок'),
  ));
  if (stage === 'completed') return h('div', { class: 'dialog-backdrop' }, h('section', { class: 'dialog-card dialog-card--complete', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dialog-title' },
    h('div', { class: 'maestro-mark applause' }, '♫'), h('span', { class: 'eyebrow' }, 'БРАВО! · КОНЦЕРТ СОСТОЯЛСЯ'),
    h('h2', { id: 'dialog-title' }, 'Зал аплодирует тебе!'), h('p', null, 'Маэстро Артём поздравляет тебя: ты выучил ноты, сыграл мелодию и выступил перед зрителями.'),
    h('button', { type: 'button', class: 'primary-button', onClick: onRepeat }, 'Повторить урок'),
  ));
  return null;
}

export function PianistUI({ state, prompt, notice, noticeType, controlsOpen, quality, onQuality, onAccept, onRepeat, onListen, onToggleSound, onVolume, onToggleControls }) {
  return h('div', { class: 'pianist-ui' },
    h('header', { class: 'brand-card' }, h('div', { class: 'brand-icon', 'aria-hidden': 'true' }, '♫'), h('div', null, h('strong', null, 'МУЗЫКАЛЬНАЯ ШКОЛА'), h('span', null, 'Пианист · урок Маэстро Артёма'))),
    h(LessonCard, { state, onListen }),
    h('aside', { class: `controls-card${controlsOpen ? '' : ' controls-card--closed'}` },
      h('button', { class: 'controls-toggle', type: 'button', 'aria-expanded': controlsOpen, onClick: onToggleControls }, h('span', null, 'УПРАВЛЕНИЕ'), h('kbd', null, controlsOpen ? 'H' : '?')),
      controlsOpen && h('div', { class: 'controls-body' },
        h('div', null, h('kbd', null, 'W A S D'), ' движение'), h('div', null, h('kbd', null, 'мышь'), ' осмотреться'),
        h('div', null, h('kbd', null, 'E'), ' действие / пианино'), h('div', null, h('kbd', null, 'Esc'), ' выйти из пианино'),
        h('div', null, h('kbd', null, 'H'), ' подсказки'),
        h('fieldset', { class: 'quality-picker' }, h('legend', null, 'Качество графики'), h('div', { class: 'quality-options', role: 'group', 'aria-label': 'Качество графики' }, QUALITY_LEVELS.map((level) => h('button', { key: level, type: 'button', class: `quality-choice${quality === level ? ' is-selected' : ''}`, 'aria-pressed': quality === level, onClick: () => onQuality(level) }, QUALITY_LABELS[level])))),
        h('div', { class: 'sound-row' }, h('button', { type: 'button', class: 'sound-toggle', onClick: onToggleSound, 'aria-pressed': state.soundEnabled }, state.soundEnabled ? 'Звук включён' : 'Звук выключен'), h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: state.volume, 'aria-label': 'Громкость', onInput: (event) => onVolume(Number(event.currentTarget.value)) })),
      ),
    ),
    prompt && h('div', { class: 'interaction-prompt', 'aria-live': 'polite' }, h('kbd', null, 'E'), h('span', null, prompt.replace(/^E — /, ''))),
    notice && h('div', { class: `toast toast--${noticeType}`, role: 'status', 'aria-live': 'polite' }, notice),
    state.stage === 'not_started' && !prompt && h('div', { class: 'welcome-hint' }, 'Подойди к Маэстро Артёму и нажми E, чтобы познакомиться.'),
    state.pianoMode && h('div', { class: 'piano-mode-badge' }, 'Игра на пианино · Esc — закончить'),
    h(Dialog, { stage: state.stage, onAccept, onRepeat }),
    h('footer', { class: 'footer-note' }, 'Локальный игровой прототип · прогресс сохранён до перезагрузки страницы'),
  );
}

export function mountPianistUI(root, props) { render(h(PianistUI, props), root); }

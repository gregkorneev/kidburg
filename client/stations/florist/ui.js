import { h, render } from 'preact';
import { FLOWERS, ORDER, RIBBONS, orderMatches } from './state.js';
import { QUALITY_LABELS, QUALITY_LEVELS } from '../../engine/art/quality.js';

const flowerCount = (stems, type) => stems.filter((stem) => stem.type === type).length;

function OrderCard({ state, onRibbon }) {
  const stageTitle = ({ briefing: 'Шаг 1 · знакомство', collecting: 'Шаг 2 · сборка', wrapping: 'Шаг 3 · упаковка', handoff: 'Шаг 4 · выдача' })[state.stage] ?? 'Заказ';
  const correct = orderMatches(state.stems);
  return h('section', { class: 'order-card', 'aria-live': 'polite' },
    h('div', { class: 'card-eyebrow' }, state.stage === 'wrapping' ? 'ЗАКАЗ СОБРАН' : 'ЗАКАЗ ЛИЛИИ'),
    h('p', { class: 'order-stage' }, stageTitle),
    h('h2', null, 'Нежный букет ко дню рождения'),
    h('p', { class: 'order-copy' }, '2 розовых тюльпана · 2 белые ромашки · 1 веточка зелени · розовая лента'),
    h('ul', { class: 'order-list' }, Object.entries(ORDER.stems).map(([type, count]) => {
      const actual = flowerCount(state.stems, type);
      const className = actual === count ? 'is-correct' : actual > count ? 'is-over' : '';
      return h('li', { key: type, class: className },
        h('span', { class: `flower-dot flower-dot--${type}` }),
        h('span', null, FLOWERS[type].plural),
        h('strong', null, `${actual}/${count}`),
      );
    })),
    h('div', { class: 'order-progress' }, h('span', { style: { width: `${Math.min(100, state.stems.length / ORDER.total * 100)}%` } })),
    h('p', { class: 'held-note' }, state.heldFlower
      ? `В руке: ${FLOWERS[state.heldFlower.type].label}. Отнесите на рабочий стол.`
      : `В букете: ${state.stems.length}/${ORDER.total} стеблей${state.stage === 'wrapping' ? ` · состав ${correct ? 'верный' : 'нужно исправить'}` : ''}.`),
    state.stage === 'wrapping' && !correct && h('p', { class: 'correction-hint' }, 'В букете есть ошибка. Вернитесь к рабочему столу и исправьте состав. Уберите последний стебель и замените его.'),
    state.stage === 'wrapping' && correct && h('div', { class: 'ribbon-picker', role: 'group', 'aria-label': 'Выбрать ленту' },
      h('span', { class: 'ribbon-label' }, `Лента: ${state.ribbon ? RIBBONS[state.ribbon] : 'не выбрана'}`),
      Object.entries(RIBBONS).map(([id, label], index) => h('button', {
        key: id,
        type: 'button',
        class: `ribbon-choice ribbon-choice--${id}${state.ribbon === id ? ' is-selected' : ''}`,
        'aria-pressed': state.ribbon === id,
        onClick: () => onRibbon(id),
      }, `${index + 1} · ${label}`)),
      h('small', null, 'Затем подойдите к упаковочному столу и нажмите E.'),
    ),
    state.stage === 'handoff' && h('p', { class: 'held-note held-note--success' }, 'Букет упакован. Отнесите его на стойку выдачи.'),
  );
}

function Dialog({ stage, onAcceptOrder, onRepeat }) {
  if (stage === 'briefing') {
    return h('div', { class: 'dialog-backdrop' },
      h('section', { class: 'dialog-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dialog-title' },
        h('div', { class: 'dialog-avatar', 'aria-hidden': 'true' }, 'Л'),
        h('span', { class: 'card-eyebrow' }, 'ЛИЛИЯ · ФЛОРИСТ'),
        h('h2', { id: 'dialog-title' }, 'Добро пожаловать в цветочную лавку!'),
        h('p', null, 'Флорист подбирает цветы, цвета и форму так, чтобы букет передавал настроение. Сегодня соберём нежный подарок ко дню рождения.'),
        h('p', null, 'Возьми каждый стебель по одному, составь букет на рабочем столе и упакуй его розовой лентой.'),
        h('button', { type: 'button', class: 'primary-button', onClick: onAcceptOrder }, 'Получить заказ'),
      ),
    );
  }
  if (stage === 'completed') {
    return h('div', { class: 'dialog-backdrop' },
      h('section', { class: 'dialog-card dialog-card--complete', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dialog-title' },
        h('div', { class: 'completion-flower', 'aria-hidden': 'true' }, '✿'),
        h('span', { class: 'card-eyebrow' }, 'ЗАКАЗ ВЫПОЛНЕН'),
        h('h2', { id: 'dialog-title' }, 'Получился чудесный букет!'),
        h('p', null, 'Лилия передала букет заказчику. Ты подобрал цветы, собрал композицию и аккуратно её упаковал.'),
        h('button', { type: 'button', class: 'primary-button', onClick: onRepeat }, 'Повторить заказ'),
      ),
    );
  }
  return null;
}

export function FloristUI({ state, prompt = '', notice = '', noticeType = 'success', controlsOpen = true, quality = 'medium', onQuality, onAcceptOrder, onRibbon, onRepeat, onToggleControls }) {
  return h('div', { class: 'florist-ui' },
    h('header', { class: 'brand-card' },
      h('div', { class: 'brand-icon', 'aria-hidden': 'true' }, '✿'),
      h('div', null, h('strong', null, 'ЦВЕТОЧНАЯ ЛАВКА'), h('span', null, 'Смена флориста')),
    ),
    state.stage !== 'not_started' && h(OrderCard, { state, onRibbon }),
    h('aside', { class: `controls-card${controlsOpen ? '' : ' controls-card--closed'}` },
      h('button', { class: 'controls-toggle', type: 'button', 'aria-expanded': controlsOpen, onClick: onToggleControls },
        h('span', null, 'УПРАВЛЕНИЕ'), h('kbd', null, controlsOpen ? 'H' : '?')),
      controlsOpen && h('div', { class: 'controls-body' },
        h('div', null, h('kbd', null, 'W A S D'), ' двигаться'),
        h('div', null, h('kbd', null, 'SHIFT'), ' быстрее'),
        h('div', null, h('kbd', null, 'мышь'), ' поворот камеры'),
        h('div', null, h('kbd', null, 'E'), ' действие'),
        h('div', null, h('kbd', null, 'H'), ' подсказки'),
        h('div', null, h('kbd', null, 'L'), ' в город'),
        h('fieldset', { class: 'quality-picker' },
          h('legend', null, 'Качество графики'),
          h('div', { class: 'quality-options', role: 'group', 'aria-label': 'Качество графики' },
            QUALITY_LEVELS.map((level) => h('button', {
              key: level,
              type: 'button',
              class: `quality-choice${quality === level ? ' is-selected' : ''}`,
              'aria-pressed': quality === level,
              onClick: () => onQuality(level),
            }, QUALITY_LABELS[level])),
          ),
        ),
      ),
    ),
    prompt && h('div', { class: 'interaction-prompt', 'aria-live': 'polite' }, h('kbd', null, 'E'), h('span', null, prompt.replace(/^E — /, ''))),
    notice && h('div', { class: `toast toast--${noticeType}`, role: 'status', 'aria-live': 'polite' }, notice),
    state.stage === 'not_started' && h('div', { class: 'welcome-hint' }, 'Подойди к Лилии и нажми E, чтобы начать обучение.'),
    h(Dialog, { stage: state.stage, onAcceptOrder, onRepeat }),
    h('footer', { class: 'footer-note' }, 'Локальный прототип · прогресс хранится только до перезагрузки страницы'),
  );
}

export function mountFloristUI(root, props) {
  render(h(FloristUI, props), root);
  return () => render(null, root);
}

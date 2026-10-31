import { h, render } from 'preact';
import { OBJECTIVES, STAGES } from './state.js';
import { QUALITY_LABELS, QUALITY_LEVELS } from '../../engine/art/quality.js';

const STEP_LABELS = Object.freeze({
  waiting_order: 'Заказ', order_received: 'Ингредиенты', ingredients_ready: 'Формовка',
  product_shaped: 'Выпечка', product_baked: 'Забрать', product_ready: 'Выдача', completed: 'Готово',
});

function QualityButtons({ quality, onQuality }) {
  return h('div', { class: 'quality-row', role: 'group', 'aria-label': 'Качество графики' },
    h('span', null, 'Графика'),
    QUALITY_LEVELS.map((level) => h('button', {
      key: level, type: 'button', class: `quality-button${quality === level ? ' quality-button--active' : ''}`,
      'aria-pressed': quality === level, onClick: () => onQuality(level),
    }, QUALITY_LABELS[level])),
  );
}

export function BakeryUI({ state, prompt = '', notice = '', quality = 'medium', onQuality = () => {} }) {
  const currentIndex = STAGES.indexOf(state.stage);
  return h('div', { class: 'bakery-ui' },
    h('header', { class: 'bakery-brand' },
      h('span', { class: 'bakery-mark', 'aria-hidden': 'true' }, 'П'),
      h('span', null, h('strong', null, 'ПЕКАРНЯ'), h('small', null, 'Учебная смена')),
    ),
    h('section', { class: 'objective-card', 'aria-live': 'polite' },
      h('span', { class: 'eyebrow' }, state.stage === 'completed' ? 'ЗАКАЗ ЗАВЕРШЁН' : 'ТЕКУЩАЯ ЦЕЛЬ'),
      h('h1', null, OBJECTIVES[state.stage]),
      h('p', { class: 'order-copy' }, `Выполнено заказов: ${state.completedOrders}`),
      h('ol', { class: 'steps', 'aria-label': 'Этапы заказа' }, STAGES.slice(0, -1).map((stage, index) =>
        h('li', {
          key: stage,
          class: `step${index < currentIndex ? ' step--done' : ''}${index === currentIndex && state.stage !== 'completed' ? ' step--current' : ''}`,
        }, STEP_LABELS[stage]),
      )),
    ),
    h('aside', { class: 'controls-card' },
      h('span', { class: 'eyebrow' }, 'УПРАВЛЕНИЕ'),
      h('div', { class: 'control-row' }, h('kbd', null, 'W A S D'), h('span', null, 'движение')),
      h('div', { class: 'control-row' }, h('kbd', null, 'SHIFT'), h('span', null, 'быстрее')),
      h('div', { class: 'control-row' }, h('kbd', null, 'E'), h('span', null, 'действие')),
      h('div', { class: 'control-row' }, h('kbd', null, 'L'), h('span', null, 'в город')),
      h(QualityButtons, { quality, onQuality }),
    ),
    h('div', { class: 'bakery-reticle', 'aria-hidden': 'true' }),
    prompt && h('div', { class: 'interaction-prompt', role: 'status', 'aria-live': 'polite' },
      h('kbd', null, 'E'), h('span', null, prompt),
    ),
    notice && h('div', { class: 'toast', role: 'status' }, notice),
    h('footer', { class: 'station-footnote' }, 'Локальный прототип · прогресс только в этой вкладке'),
  );
}

export function mountBakeryUI(root, props) {
  render(h(BakeryUI, props), root);
}

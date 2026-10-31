export const FLOWERS = Object.freeze({
  pink_tulip: Object.freeze({ label: 'Розовый тюльпан', plural: 'розовых тюльпанов' }),
  white_daisy: Object.freeze({ label: 'Белая ромашка', plural: 'белых ромашек' }),
  red_rose: Object.freeze({ label: 'Красная роза', plural: 'красных роз' }),
  greenery: Object.freeze({ label: 'Веточка зелени', plural: 'веточек зелени' }),
});

export const RIBBONS = Object.freeze({
  pink: 'Розовая лента',
  yellow: 'Жёлтая лента',
  blue: 'Синяя лента',
});

export const ORDER = Object.freeze({
  stems: Object.freeze({ pink_tulip: 2, white_daisy: 2, greenery: 1 }),
  total: 5,
  ribbon: 'pink',
});

export const STAGES = Object.freeze(['not_started', 'briefing', 'collecting', 'wrapping', 'handoff', 'completed']);

export function createInitialState() {
  return { stage: 'not_started', heldFlower: null, stems: [], ribbon: null, wrapped: false };
}

export function orderMatches(stems) {
  if (!Array.isArray(stems) || stems.length !== ORDER.total) return false;
  const counts = Object.create(null);
  for (const stem of stems) {
    if (!stem || !Object.hasOwn(FLOWERS, stem.type)) return false;
    counts[stem.type] = (counts[stem.type] ?? 0) + 1;
  }
  return Object.entries(ORDER.stems).every(([type, count]) => counts[type] === count)
    && Object.keys(counts).every((type) => Object.hasOwn(ORDER.stems, type));
}

const unchanged = (state, feedback) => ({ state, changed: false, feedback });

/** Локальный автомат задания; в модуле нет зависимостей от Three.js, браузера или DOM. */
export function transitionTask(state, action) {
  if (!state || !action || typeof action.type !== 'string') {
    return unchanged(state, 'Не удалось распознать действие. Попробуйте ещё раз.');
  }

  if (action.type === 'repeat') {
    if (state.stage !== 'completed') return unchanged(state, 'Повторить заказ можно после его сдачи.');
    return { state: createInitialState(), changed: true, feedback: 'Лилия подготовила новый заказ. Подойдите к ней для инструктажа.' };
  }
  if (state.stage === 'completed') return unchanged(state, 'Заказ уже завершён.');

  switch (action.type) {
    case 'start_briefing':
      if (state.stage !== 'not_started') return unchanged(state, 'Инструктаж уже начался.');
      return { state: { ...state, stage: 'briefing' }, changed: true, feedback: 'Лилия начинает обучение.' };

    case 'accept_order':
      if (state.stage !== 'briefing') return unchanged(state, 'Сначала поговорите с Лилией.');
      return { state: { ...state, stage: 'collecting' }, changed: true, feedback: 'Заказ принят. Выберите цветы для букета.' };

    case 'take_flower': {
      if (state.stage !== 'collecting') return unchanged(state, 'Сначала получите заказ у Лилии.');
      if (state.heldFlower) return unchanged(state, `Сначала положите ${FLOWERS[state.heldFlower.type]?.label.toLowerCase() ?? 'цветок'} на рабочий стол.`);
      if (state.stems.length >= ORDER.total) return unchanged(state, 'В букете уже пять стеблей. Уберите последний, чтобы заменить цветок.');
      if (!Object.hasOwn(FLOWERS, action.flower)) return unchanged(state, 'Такого цветка в лавке нет.');
      return {
        state: { ...state, heldFlower: { id: action.id ?? `${action.flower}-${state.stems.length}`, type: action.flower } },
        changed: true,
        feedback: `${FLOWERS[action.flower].label}: отнесите цветок на рабочий стол.`,
      };
    }

    case 'add_flower':
      if (state.stage !== 'collecting') return unchanged(state, 'Сейчас нельзя добавлять цветы.');
      if (!state.heldFlower) return unchanged(state, 'Сначала возьмите цветок из ведра.');
      if (state.stems.length >= ORDER.total) return unchanged(state, 'Букет уже заполнен. Уберите последний стебель, чтобы исправить состав.');
      {
        const stems = [...state.stems, state.heldFlower];
        const complete = stems.length === ORDER.total;
        return {
          state: { ...state, heldFlower: null, stems, stage: complete ? 'wrapping' : 'collecting' },
          changed: true,
          feedback: complete ? 'Пять стеблей собраны. Проверьте состав и выберите ленту.' : `Добавлен стебель: ${stems.length}/${ORDER.total}.`,
        };
      }

    case 'remove_last':
      if (!['collecting', 'wrapping'].includes(state.stage)) return unchanged(state, 'Сейчас нельзя менять букет.');
      if (state.heldFlower) return unchanged(state, 'Сначала положите цветок из руки на стол.');
      if (!state.stems.length) return unchanged(state, 'В букете пока нет цветов.');
      return {
        state: { ...state, stems: state.stems.slice(0, -1), stage: 'collecting', ribbon: null, wrapped: false },
        changed: true,
        feedback: 'Последний стебель убран. Можно заменить его.',
      };

    case 'choose_ribbon':
      if (state.stage !== 'wrapping') return unchanged(state, 'Сначала соберите пять стеблей.');
      if (!Object.hasOwn(RIBBONS, action.ribbon)) return unchanged(state, 'Такой ленты нет на полке.');
      return { state: { ...state, ribbon: action.ribbon, wrapped: false }, changed: true, feedback: `${RIBBONS[action.ribbon]} выбрана.` };

    case 'wrap':
      if (state.stage !== 'wrapping') return unchanged(state, 'Сначала соберите букет.');
      if (!orderMatches(state.stems)) return unchanged(state, 'В букете неверный состав. Уберите последний цветок и проверьте заказ.');
      if (state.ribbon !== ORDER.ribbon) return unchanged(state, 'Для этого заказа нужна розовая лента. Выберите её на полке.');
      return { state: { ...state, wrapped: true, stage: 'handoff' }, changed: true, feedback: 'Букет упакован. Отнесите заказ на стойку выдачи.' };

    case 'handoff':
      if (state.stage !== 'handoff' || !state.wrapped) return unchanged(state, 'Сначала правильно соберите и упакуйте букет.');
      return { state: { ...state, stage: 'completed' }, changed: true, feedback: 'Лилия приняла букет и поздравила заказчика. Заказ выполнен!' };

    default:
      return unchanged(state, 'Это действие сейчас недоступно.');
  }
}

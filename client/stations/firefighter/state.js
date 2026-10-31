/** Учебная стена: четыре окна, каждое тушится независимо. */
export const WINDOW_COUNT = 4;
/** Попаданий струи, после которых окно считается потушенным. */
export const WINDOW_HIT_LIMIT = 12;
/** Всего попаданий на все окна (прогресс этапа). */
export const FIRE_HIT_LIMIT = WINDOW_COUNT * WINDOW_HIT_LIMIT;

export const OBJECTIVES = Object.freeze({
  not_started: 'Поговорите с наставником у пожарной части',
  briefing: 'Выслушайте инструктаж Маруси',
  equipping: 'Наденьте экипировку в шкафу',
  fire_drill: 'Потушите окна учебной стены',
  rescue: 'Доставьте манекен в безопасную зону',
  debrief: 'Вернитесь к Марусе за итогом тренировки',
  completed: 'Учебная смена завершена',
});

/** Состояние окна по числу попаданий: active (огонь не тронут), extinguishing или done. */
export function windowStatus(hits) {
  if (hits >= WINDOW_HIT_LIMIT) return 'done';
  return hits > 0 ? 'extinguishing' : 'active';
}

export const isValidWindowIndex = (index) => Number.isInteger(index) && index >= 0 && index < WINDOW_COUNT;

export const countDoneWindows = (windows) => windows.filter((hits) => hits >= WINDOW_HIT_LIMIT).length;

/**
 * Состояние задания. `windows[i]` — число попаданий по окну i (0..WINDOW_HIT_LIMIT): единственное
 * хранимое поле тушения; статус окна и общий прогресс вычисляются из него.
 */
export function createInitialState() {
  return {
    stage: 'not_started',
    equipped: false,
    windows: Array.from({ length: WINDOW_COUNT }, () => 0),
    carryingMannequin: false,
    mannequinDelivered: false,
  };
}

const unchanged = (state, feedback) => ({ state, changed: false, feedback });

/** Чистый локальный автомат. Сохранение и отправка сообщений намеренно остаются внешними. */
export function transitionTask(state, action) {
  if (!state || !action || typeof action.type !== 'string') {
    return unchanged(state, 'Не удалось распознать действие. Попробуйте ещё раз.');
  }

  // Повтор — единственное действие после завершения: новая смена начинается с инструктажа,
  // прогресс прошлой (экипировка, окна, манекен) обнуляется. До завершения сбросить нельзя.
  if (action.type === 'repeat') {
    if (state.stage === 'completed') {
      return {
        state: { ...createInitialState(), stage: 'briefing' },
        changed: true,
        feedback: 'Новая учебная смена: Маруся снова проводит инструктаж.',
      };
    }
    return unchanged(state, 'Повторить смену можно только после её завершения.');
  }

  if (state.stage === 'completed') {
    return unchanged(state, 'Эта учебная смена уже завершена.');
  }

  switch (action.type) {
    case 'start':
      if (state.stage === 'not_started') {
        return { state: { ...state, stage: 'briefing' }, changed: true, feedback: 'Маруся начинает инструктаж.' };
      }
      return unchanged(state, 'Вы уже начали эту тренировку.');

    case 'accept_briefing':
      if (state.stage === 'briefing') {
        return { state: { ...state, stage: 'equipping' }, changed: true, feedback: 'Инструктаж завершён. Наденьте экипировку.' };
      }
      return unchanged(state, 'Сначала поговорите с Марусей.');

    case 'equip':
      if (state.stage === 'equipping') {
        return { state: { ...state, stage: 'fire_drill', equipped: true }, changed: true, feedback: 'Готово! Теперь на учебный полигон.' };
      }
      return unchanged(state, state.equipped ? 'Экипировка уже надета.' : 'Сначала получите инструктаж.');

    case 'window_hit': {
      if (state.stage !== 'fire_drill') return unchanged(state, 'Сначала подготовьтесь к упражнению на полигоне.');
      if (!isValidWindowIndex(action.index)) return unchanged(state, 'Эта цель сейчас недоступна.');
      if (state.windows[action.index] >= WINDOW_HIT_LIMIT) return unchanged(state, 'Это окно уже потушено.');
      const windows = state.windows.map((hits, i) => (i === action.index ? hits + 1 : hits));
      const done = countDoneWindows(windows);
      if (done === WINDOW_COUNT) {
        return {
          state: { ...state, windows, stage: 'rescue' },
          changed: true,
          feedback: 'Все окна потушены! Теперь найдите учебный манекен.',
        };
      }
      const justDone = windows[action.index] >= WINDOW_HIT_LIMIT;
      return {
        state: { ...state, windows },
        changed: true,
        feedback: justDone ? `Окно ${action.index + 1} потушено! Осталось: ${WINDOW_COUNT - done}.` : '',
      };
    }

    case 'pickup_mannequin':
      if (state.stage !== 'rescue') return unchanged(state, 'Манекен станет доступен после упражнения на полигоне.');
      if (state.carryingMannequin) return unchanged(state, 'Вы уже несёте манекен. Отнесите его к зелёной отметке.');
      if (state.mannequinDelivered) return unchanged(state, 'Манекен уже доставлен.');
      return {
        state: { ...state, carryingMannequin: true },
        changed: true,
        feedback: 'Манекен поднят. Отнесите его в обозначенную учебную зону.',
      };

    case 'deliver_mannequin':
      if (state.stage !== 'rescue') return unchanged(state, 'Сначала завершите упражнение на полигоне.');
      if (!state.carryingMannequin) return unchanged(state, 'Сначала подойдите к манекену и нажмите E.');
      return {
        state: { ...state, carryingMannequin: false, mannequinDelivered: true, stage: 'debrief' },
        changed: true,
        feedback: 'Манекен доставлен. Вернитесь к Марусе за итогом.',
      };

    case 'report':
      if (state.stage === 'debrief' && state.mannequinDelivered) {
        return { state: { ...state, stage: 'completed' }, changed: true, feedback: 'Учебная смена завершена!' };
      }
      return unchanged(state, 'Сначала закончите все этапы тренировки.');

    default:
      return unchanged(state, 'Это действие сейчас недоступно.');
  }
}

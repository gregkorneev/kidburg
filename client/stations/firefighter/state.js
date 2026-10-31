export const FIRE_HIT_LIMIT = 18;

export const OBJECTIVES = Object.freeze({
  not_started: 'Поговорите с наставником у пожарной части',
  briefing: 'Выслушайте инструктаж Маруси',
  equipping: 'Наденьте экипировку в шкафу',
  fire_drill: 'Потушите учебную мишень',
  rescue: 'Доставьте манекен в безопасную зону',
  debrief: 'Вернитесь к Марусе за итогом тренировки',
  completed: 'Учебная смена завершена',
});

export function createInitialState() {
  return {
    stage: 'not_started',
    equipped: false,
    fireHits: 0,
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

    case 'fire_hit':
      if (state.stage !== 'fire_drill') return unchanged(state, 'Сначала подготовьтесь к упражнению на полигоне.');
      if (state.fireHits >= FIRE_HIT_LIMIT) return unchanged(state, 'Учебная мишень уже потушена.');
      {
        const fireHits = state.fireHits + 1;
        const stage = fireHits >= FIRE_HIT_LIMIT ? 'rescue' : state.stage;
        return {
          state: { ...state, fireHits, stage },
          changed: true,
          feedback: stage === 'rescue' ? 'Мишень потушена. Теперь найдите учебный манекен.' : 'Струя попала по учебной мишени!',
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

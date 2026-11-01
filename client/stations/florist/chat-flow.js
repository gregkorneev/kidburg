// Разговор с Лилией: памятки этапов и кнопки панели. Реплики Лилии генерирует ИИ на сервере (agentId lilia).
// Состав букета и ленту проверяет игровой автомат (state.js, на сервере — station_tasks.js), а не Лилия.

import { ORDER } from './state.js';

export const LILIA = Object.freeze({ agentId: 'lilia', name: 'Лилия' });

export const QUESTIONS = Object.freeze({
  next: 'Что мне делать дальше?',
  order: 'Какие цветы нужны для этого заказа?',
  mix: 'Как подобрать цветы, чтобы букет смотрелся красиво?',
  care: 'Как ухаживать за срезанными цветами?',
  wrap: 'Зачем нужна упаковка и лента?',
  profession: 'Как стать флористом?',
});

const HINTS = Object.freeze({
  not_started: 'Лилия готова объяснить заказ. Начните обучение кнопкой ниже.',
  briefing: 'Выслушайте условия заказа и примите его в окне инструктажа.',
  collecting: `Соберите букет из ${ORDER.total} стеблей: 2 розовых тюльпана, 2 белые ромашки и 1 веточка зелени. Если ошиблись, уберите последний стебель у рабочего стола.`,
  wrapping: 'Выберите розовую ленту (клавиша 1) и упакуйте букет на упаковочном столе.',
  handoff: 'Отнесите упакованный букет на стойку выдачи.',
  completed: 'Заказ выдан. Можно узнать больше о профессии или повторить заказ.',
});

/** Памятка игры на этапе: фиксированный текст интерфейса, не слова Лилии. */
export const hintForStage = (stage) => HINTS[stage] ?? HINTS.not_started;

/**
 * Кнопки панели. Начать обучение и повторить заказ выполняет игрок; разговор цветы не берёт и букет не оценивает.
 * @param {(action: {type: string}) => void} perform применить действие станции
 */
export function planActions(stage, { ask, act }, perform) {
  switch (stage) {
    case 'not_started':
      return [act('Начать обучение', () => perform({ type: 'start_briefing' })), ask(QUESTIONS.order), ask(QUESTIONS.profession)];
    case 'collecting':
      return [ask(QUESTIONS.next), ask(QUESTIONS.mix), ask(QUESTIONS.care)];
    case 'wrapping':
      return [ask(QUESTIONS.next), ask(QUESTIONS.wrap), ask(QUESTIONS.mix)];
    case 'completed':
      return [act('Повторить заказ', () => perform({ type: 'repeat' }), { primary: false }), ask(QUESTIONS.profession, 'Узнать больше о профессии', { primary: true }), ask(QUESTIONS.care)];
    default:
      return [ask(QUESTIONS.next), ask(QUESTIONS.order), ask(QUESTIONS.care)];
  }
}

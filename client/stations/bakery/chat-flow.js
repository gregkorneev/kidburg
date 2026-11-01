// Разговор с мастером-пекарем: памятки этапов и кнопки панели. Реплики пекаря генерирует ИИ на сервере (agentId baker).

import { OBJECTIVES } from './state.js';

export const BAKER = Object.freeze({ agentId: 'baker', name: 'Мастер-пекарь' });

export const QUESTIONS = Object.freeze({
  next: 'Что мне делать дальше?',
  bread: 'Расскажи, как печётся хлеб от заказа до выдачи.',
  hygiene: 'Почему пекарю так важны чистые руки и порядок?',
  oven: 'Как безопасно работать у печи?',
  profession: 'Как стать пекарем или кондитером?',
});

/** Памятка игры на этапе: фиксированный текст интерфейса, не слова пекаря. */
export const hintForStage = (stage) => OBJECTIVES[stage] ?? OBJECTIVES.waiting_order;

/**
 * Кнопки панели. Действия пекаря (заказ, новый заказ) выполняет игрок нажатием кнопки: разговор ничего не засчитывает.
 * @param {string} stage
 * @param {{ask: Function, act: Function}} helpers
 * @param {(action: string) => void} perform применить действие станции
 */
export function planActions(stage, { ask, act }, perform) {
  switch (stage) {
    case 'waiting_order':
      return [act('Получить заказ', () => perform('get_order')), ask(QUESTIONS.bread), ask(QUESTIONS.next)];
    case 'completed':
      return [act('Принять новый заказ', () => perform('repeat_order')), ask(QUESTIONS.profession), ask(QUESTIONS.hygiene)];
    case 'product_shaped':
      return [ask(QUESTIONS.next), ask(QUESTIONS.oven), ask(QUESTIONS.bread)];
    default:
      return [ask(QUESTIONS.next), ask(QUESTIONS.hygiene), ask(QUESTIONS.profession)];
  }
}

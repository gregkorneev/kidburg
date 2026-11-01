// Разговор с Маэстро Артёмом: памятки этапов и кнопки панели. Реплики Маэстро генерирует ИИ на сервере (agentId maestro).
// Ноты, репетицию и концерт оценивает игровой автомат (state.js, на сервере — station_tasks.js), а не Маэстро.

export const MAESTRO = Object.freeze({ agentId: 'maestro', name: 'Маэстро Артём' });

export const QUESTIONS = Object.freeze({
  next: 'Что мне делать дальше?',
  notes: 'Как запомнить ноты До, Ре, Ми и Соль?',
  rhythm: 'Что такое ритм и как не спешить?',
  rehearse: 'Как лучше репетировать мелодию?',
  fear: 'Как справиться с волнением перед концертом?',
  profession: 'Как стать музыкантом или преподавателем музыки?',
});

const HINTS = Object.freeze({
  not_started: 'Маэстро готов начать урок. Начните его кнопкой ниже или клавишей E.',
  briefing: 'Выслушайте Маэстро и нажмите «Принять» в окне урока.',
  learning: 'Сядьте за учебное пианино (E) и сыграйте ноты До, Ре, Ми, Соль по порядку. Esc — выйти из режима пианино.',
  practice: 'Сыграйте мелодию из восьми нот на учебном пианино. Ошиблись — начните фразу заново.',
  concert: 'Подойдите к сцене и нажмите E у сценического пианино, чтобы выступить.',
  completed: 'Концерт сыгран. Можно узнать больше о профессии или повторить урок.',
});

/** Памятка игры на этапе: фиксированный текст интерфейса, не слова Маэстро. */
export const hintForStage = (stage) => HINTS[stage] ?? HINTS.not_started;

/**
 * Кнопки панели. Начать и повторить урок выполняет игрок; разговор ноты не засчитывает.
 * @param {(action: {type: string}) => void} perform применить действие станции
 */
export function planActions(stage, { ask, act }, perform) {
  switch (stage) {
    case 'not_started':
      return [act('Начать урок', () => perform({ type: 'start_briefing' })), ask(QUESTIONS.notes), ask(QUESTIONS.profession)];
    case 'learning':
      return [ask(QUESTIONS.next), ask(QUESTIONS.notes), ask(QUESTIONS.rhythm)];
    case 'practice':
      return [ask(QUESTIONS.next), ask(QUESTIONS.rehearse), ask(QUESTIONS.rhythm)];
    case 'concert':
      return [ask(QUESTIONS.next), ask(QUESTIONS.fear), ask(QUESTIONS.rehearse)];
    case 'completed':
      return [act('Повторить урок', () => perform({ type: 'repeat' }), { primary: false }), ask(QUESTIONS.profession, 'Узнать больше о профессии', { primary: true }), ask(QUESTIONS.fear)];
    default:
      return [ask(QUESTIONS.next), ask(QUESTIONS.notes), ask(QUESTIONS.profession)];
  }
}

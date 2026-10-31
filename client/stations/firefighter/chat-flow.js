// Разговор с Марусей на станции. Реплики Маруси клиент не хранит и не придумывает: их по npc_talk
// генерирует ИИ на сервере (с учётом хода задания и памяти). Здесь только то, что принадлежит игре:
// фразы самого игрока, фиксированные подсказки интерфейса и кнопки действий, которые подтверждает сервер.

export const MARUSYA = Object.freeze({ agentId: 'marusya', name: 'Маруся Громова' });

/** Реплики игрока. Ответ на каждую приходит от ИИ; после действия реплика уходит только по подтверждению сервера. */
export const SAY = Object.freeze({
  hello: 'Здравствуйте, Маруся!',
  afterStart: 'Давай начнём! Расскажи, как пройдёт тренировка.',
  afterBriefing: 'Мне всё понятно. Что дальше?',
  afterReport: 'Учебная смена завершена. Что скажешь?',
  afterRepeat: 'Хочу пройти смену ещё раз. С чего начнём?',
});

export const QUESTIONS = Object.freeze({
  howItGoes: 'Расскажи, как проходит тренировка.',
  profession: 'Расскажи больше о профессии пожарного.',
  gear: 'Зачем пожарным защитная экипировка?',
  wall: 'Чем учебная стена отличается от настоящего пожара?',
  next: 'Что мне делать дальше?',
});

/** Памятка игры на каждом этапе: фиксированный текст интерфейса, подписан в панели как подсказка игры, а не слова NPC. */
export const STAGE_HINTS = Object.freeze({
  not_started: 'Порядок тренировки: инструктаж, экипировка в шкафу, четыре окна учебной стены, манекен, итог у Маруси. Всё условно и не заменяет правила настоящей безопасности.',
  briefing: 'Выслушайте Марусю и нажмите «Понятно, к экипировке». Всё условно и не заменяет правила настоящей безопасности.',
  equipping: 'Экипировку надевают в шкафу, а не у Маруси: подойдите к нему и нажмите E.',
  fire_drill: 'Возьмите учебный рукав у стойки и потушите все окна учебной стены. Не пересекайте ограничительную линию.',
  rescue: 'Поднимите манекен и отнесите его к зелёной отметке.',
  debrief: 'Нажмите «Завершить смену», чтобы подвести итог.',
  completed: 'Смена завершена. Можно узнать больше о профессии или повторить учебную смену.',
});

const ask = (text, label = text, extra = {}) => ({ label, text, ...extra });
const act = (label, action, after, primary = true) => ({ label, action, after, primary });

/**
 * Кнопки панели на этапе `stage`. Вопрос (`text`) отправляет реплику игрока; действие (`action`) просит сервер
 * выполнить шаг задания и продолжает разговор только после его подтверждения. Повтор смены предлагается
 * лишь на завершённом этапе, и сервер всё равно принимает его только оттуда.
 */
export function planActions(stage) {
  switch (stage) {
    case 'not_started':
      return [act('Начать тренировку', 'start', SAY.afterStart), ask(QUESTIONS.howItGoes), ask(QUESTIONS.profession)];
    case 'briefing':
      return [act('Понятно, к экипировке', 'accept_briefing', SAY.afterBriefing), ask(QUESTIONS.howItGoes), ask(QUESTIONS.gear)];
    case 'equipping':
    case 'fire_drill':
    case 'rescue':
      return [ask(QUESTIONS.next), ask(QUESTIONS.gear), ask(QUESTIONS.wall)];
    case 'debrief':
      return [act('Завершить смену', 'report', SAY.afterReport), ask(QUESTIONS.next)];
    case 'completed':
      return [ask(QUESTIONS.profession, 'Узнать больше о профессии', { primary: true }), act('Повторить учебную смену', 'repeat', SAY.afterRepeat, false)];
    default:
      return [];
  }
}

/**
 * @param {object} deps
 * @param {import('../../ui/npc-chat-core.js').NpcChat} deps.chat контроллер панели разговора
 * @param {() => {stage: string}} deps.getState подтверждённое сервером состояние
 * @param {(action: string, handlers: {onConfirmed?: Function}) => boolean} deps.dispatch task_answer через сервер
 * @param {() => boolean} deps.isOnline
 * @param {() => boolean} [deps.isBusy] ждём ответ сервера на действие
 * @param {() => string} [deps.getNotice] сообщение игре (отказ сервера и т. п.)
 */
export function createMarusyaChat({ chat, getState, dispatch, isOnline, isBusy = () => false, getNotice = () => '' }) {
  // Первое обращение на каждом этапе за страницу: игрок здоровается, ответ генерирует ИИ.
  // Память прошлых разговоров хранит сервер, поэтому после перезагрузки Маруся продолжает, а не начинает заново.
  const greeted = new Set();

  function assist() {
    const { stage } = getState();
    const busy = isBusy();
    return {
      hint: STAGE_HINTS[stage] ?? '',
      note: getNotice(),
      actions: planActions(stage).map(({ label, primary = false, text, action, after }) =>
        action
          ? { label, primary, disabled: busy, run: () => dispatch(action, { onConfirmed: () => after && chat.send(after) }) }
          : { label, primary, text }),
    };
  }

  return {
    /** Обновляет подсказку и кнопки по текущему состоянию. */
    sync: () => chat.setAssist(assist()),
    /** Открывает панель у Маруси; на новом для страницы этапе игрок здоровается. */
    open() {
      if (!isOnline()) return false;
      chat.open(MARUSYA);
      chat.setAssist(assist());
      const { stage } = getState();
      if (!greeted.has(stage) && chat.canSend && chat.send(SAY.hello)) greeted.add(stage);
      return true;
    },
    reset: () => greeted.clear(),
  };
}

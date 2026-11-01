// Разговор с наставником станции поверх общей панели (client/ui/npc-chat.js).
//
// Реплики наставника по npc_talk генерирует ИИ на сервере. Здесь только то, что принадлежит игре:
// фиксированная памятка этапа (подписана в панели как подсказка игры, а не слова NPC), готовые вопросы игрока
// и кнопки игровых действий. Кнопка действия выполняет шаг через станцию (и сервер его подтверждает);
// сам разговор шаги не засчитывает. Приветствие автоматически не отправляется: без вопроса игрока модель не запускается.

export const ask = (text, label = text, extra = {}) => ({ label, text, ...extra });
export const act = (label, run, extra = {}) => ({ label, run, primary: true, ...extra });

/**
 * @param {object} deps
 * @param {import('../ui/npc-chat-core.js').NpcChat} deps.chat
 * @param {{agentId: string, name: string}} deps.npc
 * @param {() => string} deps.getStage подтверждённый (локальный) этап станции
 * @param {(stage: string) => string} deps.hint памятка игры для этапа
 * @param {(stage: string, helpers: {ask: Function, act: Function}) => Array<object>} deps.plan кнопки: вопросы и действия станции
 * @param {() => boolean} [deps.isOnline]
 * @param {() => string} [deps.getNotice]
 */
export function createStationChatFlow({ chat, npc, getStage, hint, plan, isOnline = () => true, getNotice = () => '' }) {
  const assist = () => {
    const stage = getStage();
    return {
      hint: hint(stage) ?? '',
      note: getNotice(),
      actions: plan(stage, { ask, act }).map(({ label, primary = false, text, run }) =>
        run ? { label, primary, run } : { label, primary, text }),
    };
  };
  return {
    /** Обновляет памятку и кнопки по текущему этапу (после действия станции). */
    sync: () => chat.setAssist(assist()),
    /** Открывает панель у наставника. @returns {boolean} false, если связи нет и станция остаётся локальной */
    open() {
      if (!isOnline()) return false;
      if (!chat.open(npc)) return false;
      chat.setAssist(assist());
      return true;
    },
    close: () => chat.close(),
  };
}

import { RADIO_FALLBACKS } from '../../content/radio/fallback-scripts.js';
import { SCIENCE_FACTS } from '../../content/radio/science-facts.js';

export const RADIO_TASK_ID = 'radio_station_v1';
const RECENT_LIMIT = 5;
const WEATHER_DISCLAIMER = 'Это учебный вымышленный прогноз для тренировки радиоведущего.';
const MAX_SCRIPT_TEXT = 700;

const initialState = () => ({
  version: 1,
  stage: 'idle',
  category: null,
  script: null,
  recentTopicIds: [],
  recentTopics: [],
  completedBroadcasts: 0,
});

function restoreState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.version !== 1) return initialState();
  // Legacy choose_topic progress was an in-flight preparation, not a gameplay step.
  const stage = ['idle', 'ready', 'on_air', 'completed'].includes(raw.stage) ? raw.stage : 'idle';
  const category = raw.category === 'weather' || raw.category === 'science' ? raw.category : null;
  const ids = Array.isArray(raw.recentTopicIds) ? raw.recentTopicIds.filter((id) => typeof id === 'string').slice(-RECENT_LIMIT) : [];
  const topics = Array.isArray(raw.recentTopics)
    ? raw.recentTopics
        .filter((topic) => topic && typeof topic.topicId === 'string' && typeof topic.title === 'string')
        .slice(-RECENT_LIMIT)
        .map(({ topicId, title }) => ({ topicId, title: title.slice(0, 80) }))
    : [];
  let script = null;
  if (
    raw.script &&
    typeof raw.script === 'object' &&
    (raw.script.category === 'weather' || raw.script.category === 'science') &&
    typeof raw.script.topicId === 'string' &&
    typeof raw.script.title === 'string' &&
    typeof raw.script.text === 'string' &&
    ['ollama', 'offline_fallback'].includes(raw.script.source)
  ) {
    script = {
      category: raw.script.category,
      topicId: raw.script.topicId,
      title: raw.script.title.slice(0, 80),
      text: raw.script.text.slice(0, 700),
      source: raw.script.source,
    };
  }
  if (['ready', 'on_air', 'completed'].includes(stage) && !script) return initialState();
  return {
    version: 1,
    stage,
    category,
    script,
    recentTopicIds: ids,
    recentTopics: topics,
    completedBroadcasts: Number.isSafeInteger(raw.completedBroadcasts) && raw.completedBroadcasts >= 0 ? raw.completedBroadcasts : 0,
  };
}

const response = (state, feedback = '', changed = false, error) => ({
  state: structuredClone(state),
  done: state.stage === 'completed',
  feedback,
  changed,
  ...(error ? { error } : {}),
});

const byCategory = (category) => RADIO_FALLBACKS[category] ?? [];
const firstUnused = (items, used) => items.find((item) => !used.includes(item.topicId)) ?? null;
const nextCategory = (previous) => previous === 'weather' ? 'science' : 'weather';
const withWeatherDisclaimer = (text) => {
  const body = text.split(WEATHER_DISCLAIMER).join('').trim();
  const bodyLimit = MAX_SCRIPT_TEXT - WEATHER_DISCLAIMER.length - 1;
  return `${WEATHER_DISCLAIMER} ${body.slice(0, bodyLimit).trim()}`;
};
const scienceFallbackText = (fact) =>
  `Сегодня в научном эфире — проверенный факт: ${fact.text} Так звучит наш выпуск: ${fact.title}. Послушайте наш короткий разбор.`;

/** Radio stores its own progress in task_progress. Generation locks are transient and per user. */
export function createRadioTask({ db, generateRadioScript, now = Date.now, log = console }) {
  // Physical requests stay here until their Promise settles. Revision validity
  // is tracked separately so invalidating a request never frees its busy lock.
  const activeGenerations = new Map();
  const currentRevisions = new Map();
  let nextGenerationRevision = 0;

  function invalidateGeneration(userId) {
    currentRevisions.delete(userId);
  }

  function load(userId) {
    const saved = db.getTaskProgress(userId, RADIO_TASK_ID);
    const state = restoreState(saved?.state);
    if (saved?.state?.stage === 'choose_topic') {
      try {
        db.saveTaskProgress(userId, RADIO_TASK_ID, { state, done: false }, now());
      } catch (err) {
        log.error?.({ err, userId }, 'не удалось нормализовать старый прогресс Radio');
      }
    }
    return state;
  }

  function save(userId, state, feedback = '') {
    try {
      db.saveTaskProgress(userId, RADIO_TASK_ID, { state, done: state.stage === 'completed' }, now());
      return response(state, feedback, true);
    } catch (err) {
      log.error?.({ err, userId }, 'не удалось сохранить прогресс Radio');
      return response(state, 'Не удалось сохранить прогресс. Попробуйте ещё раз.', false, 'storage');
    }
  }

  function getState(userId) {
    return response(load(userId));
  }

  async function generate(userId, state, context = {}) {
      if (activeGenerations.has(userId)) return response(state, 'Сценарий уже готовится. Подождите ответ.');
      if (state.stage !== 'idle' || !state.category) return response(state, 'Подготовка выпуска ещё не началась.');

      const revision = ++nextGenerationRevision;
      const generation = { revision };
      activeGenerations.set(userId, generation);
      currentRevisions.set(userId, revision);
      const isCurrent = () => (
        !context.signal?.aborted &&
        activeGenerations.get(userId) === generation &&
        currentRevisions.get(userId) === revision
      );
      const fact = state.category === 'science' ? firstUnused(SCIENCE_FACTS, state.recentTopicIds) : null;
      try {
        let script;
        try {
          if (state.category === 'science' && !fact) throw new Error('no unused science fact');
          script = await generateRadioScript({
            userId,
            category: state.category,
            recentTopicIds: state.recentTopicIds,
            recentTopics: state.recentTopics.map((topic) => topic.title),
            ...(fact ? { fact } : {}),
            signal: context.signal,
          });
          if (script?.category === 'weather' && typeof script.text === 'string') {
            script = { ...script, text: withWeatherDisclaimer(script.text) };
          }
          if (
            !script ||
            script.category !== state.category ||
            typeof script.topicId !== 'string' ||
            typeof script.title !== 'string' || script.title.length < 3 || script.title.length > 80 ||
            typeof script.text !== 'string' || script.text.trim().length < 20 || script.text.length > 700 ||
            script.source !== 'ollama' ||
            state.recentTopicIds.includes(script.topicId) ||
            (fact && script.topicId !== fact.topicId)
          ) {
            throw new Error('invalid generated Radio script');
          }
        } catch (err) {
          if (!isCurrent()) return response(load(userId));
          const fallback = state.category === 'science'
            ? (fact && !state.recentTopicIds.includes(fact.topicId) ? fact : firstUnused(byCategory('science'), state.recentTopicIds))
            : firstUnused(byCategory('weather'), state.recentTopicIds);
          // Check again before using the selected fallback. A stale or aborted
          // generation must never turn an AI error into a saved fallback.
          if (!isCurrent()) return response(load(userId));
          if (!fallback) {
            log.warn?.({ err, userId, category: state.category }, 'нет неиспользованного сценария Radio для fallback');
            return response(state, 'Нет доступного сценария. Начните новый выпуск и попробуйте снова.', false, 'generation');
          }
          script = {
            category: state.category,
            topicId: fallback.topicId,
            title: fallback.title,
            text: state.category === 'science' ? scienceFallbackText(fallback) : fallback.text,
            source: 'offline_fallback',
          };
          log.warn?.({ err, userId, category: state.category }, 'для Radio выбран локальный fallback-сценарий');
        }
        if (!isCurrent()) return response(load(userId));
        if (script.category === 'weather') script = { ...script, text: withWeatherDisclaimer(script.text) };
        if (!isCurrent()) return response(load(userId));
        const ready = { ...state, stage: 'ready', script };
        return save(userId, ready, script.source === 'offline_fallback' ? 'Используется готовый учебный сценарий.' : 'Сценарий готов к эфиру.');
      } finally {
        if (activeGenerations.get(userId) === generation) activeGenerations.delete(userId);
        if (currentRevisions.get(userId) === revision) currentRevisions.delete(userId);
      }
  }

  async function prepareNext(userId, previousState, context = {}) {
    const category = previousState.stage === 'idle' && previousState.category
      ? previousState.category
      : nextCategory(previousState.category);
    const selected = { ...previousState, stage: 'idle', category, script: null };
    const saved = save(userId, selected, 'ИИ готовит новый выпуск.');
    if (!saved.changed) return saved;
    return generate(userId, selected, context);
  }

  async function handle(userId, payload, context = {}) {
    if (!Number.isInteger(userId) || userId <= 0) throw new TypeError('нужен userId авторизованного соединения');
    const state = load(userId);
    const action = payload && typeof payload === 'object' && typeof payload.action === 'string' ? payload.action : '';

    if (action === 'open') {
      if (state.stage === 'idle') {
        return prepareNext(userId, state, context);
      }
      return response(state);
    }

    // Compatibility/recovery action for a server-restored in-progress preparation.
    if (action === 'generate_script') return generate(userId, state, context);

    if (action === 'select_category') {
      return response(state, 'Тип выпуска выбирает редактор Radio автоматически.');
    }

    if (action === 'start_broadcast') {
      if (state.stage !== 'ready' || !state.script) return response(state, 'Сначала подготовьте сценарий.');
      return save(userId, { ...state, stage: 'on_air' });
    }

    if (action === 'complete_broadcast') {
      if (state.stage === 'completed') return response(state, 'Этот выпуск уже завершён.');
      if (state.stage !== 'on_air' || !state.script) return response(state, 'Сначала начните эфир.');
      const recentTopics = [...state.recentTopics, { topicId: state.script.topicId, title: state.script.title }].slice(-RECENT_LIMIT);
      const completed = {
        ...state,
        stage: 'completed',
        recentTopics,
        recentTopicIds: recentTopics.map((topic) => topic.topicId),
        completedBroadcasts: state.completedBroadcasts + 1,
      };
      return save(userId, completed);
    }

    if (action === 'new_broadcast') {
      if (state.stage !== 'completed') return response(state, 'Завершите текущий выпуск перед началом нового.');
      return prepareNext(userId, state, context);
    }

    return response(state, 'Это действие Radio сейчас недоступно.');
  }

  return {
    taskId: RADIO_TASK_ID,
    getState,
    handle,
    forget(userId) {
      invalidateGeneration(userId);
    },
  };
}

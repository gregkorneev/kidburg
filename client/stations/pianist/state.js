import { LESSON, MELODY, noteById, RHYTHM_BPM, RHYTHM_TOLERANCE_MS } from './melody.js';

export const STAGES = Object.freeze(['not_started', 'briefing', 'learning', 'practice', 'rhythm', 'concert_ready', 'concert', 'completed']);
export const STAGE_LABELS = Object.freeze({
  not_started: 'Знакомство', briefing: 'Знакомство с Маэстро', learning: 'Изучение нот',
  practice: 'Репетиция мелодии', rhythm: 'Работа с ритмом', concert_ready: 'Пора на сцену',
  concert: 'Концерт', completed: 'Концерт состоялся',
});

export function createInitialState() {
  return { stage: 'not_started', index: 0, pianoMode: false, soundEnabled: true, volume: 0.55, lastBeatAt: null, lastFeedback: '' };
}

const noChange = (state, feedback) => ({ state, changed: false, feedback });
const changed = (state, feedback = '') => ({ state, changed: true, feedback });
const targetSequence = (stage) => stage === 'learning' ? LESSON : MELODY;

export function transitionTask(state, action) {
  if (!state || !action || typeof action.type !== 'string') return noChange(state, 'Действие не распознано.');
  if (action.type === 'start_briefing' && state.stage === 'not_started') return changed({ ...state, stage: 'briefing' }, 'Маэстро Артём начинает урок.');
  if (action.type === 'accept' && state.stage === 'briefing') return changed({ ...state, stage: 'learning', index: 0 }, 'Начнём с четырёх нот: До, Ре, Ми, Соль.');
  if (action.type === 'enter_piano' && ['learning', 'practice', 'rhythm', 'concert_ready'].includes(state.stage)) {
    if (state.stage === 'concert_ready' && !action.atStage) return noChange(state, 'Для концерта подойди к сценическому пианино.');
    return changed({ ...state, pianoMode: true, index: state.stage === 'concert_ready' ? 0 : state.index, lastBeatAt: null }, 'Esc — выйти из режима пианино.');
  }
  if (action.type === 'leave_piano' && state.pianoMode) return changed({ ...state, pianoMode: false, lastBeatAt: null });
  if (action.type === 'repeat' && state.stage === 'completed') return changed(createInitialState(), 'Маэстро готов провести урок ещё раз.');
  if (action.type === 'toggle_sound') return changed({ ...state, soundEnabled: !state.soundEnabled });
  if (action.type === 'volume') return changed({ ...state, volume: Math.min(1, Math.max(0, Number(action.value) || 0)) });
  if (action.type !== 'note' || !state.pianoMode) return noChange(state, 'Подойди к пианино и нажми E.');
  const note = noteById(action.note);
  if (!note) return noChange(state, 'Такой ноты нет на клавиатуре.');
  if (note.black) return noChange(state, 'Чёрные клавиши подходят для свободной игры.');
  if (!['learning', 'practice', 'rhythm', 'concert_ready'].includes(state.stage)) return noChange(state, 'Сейчас свободная игра.');
  const sequence = state.stage === 'concert_ready' ? MELODY : targetSequence(state.stage);
  const expected = sequence[state.index];
  if (note.id !== expected) {
    if (state.stage === 'learning') return changed({ ...state, index: 0, lastBeatAt: null }, `Попробуй ещё раз с начала: нужна нота ${noteById(LESSON[0]).label}.`);
    return changed({ ...state, index: 0, lastBeatAt: null }, `Ничего страшного — начни эту фразу заново с ноты ${noteById(sequence[0]).label}.`);
  }
  if (state.stage === 'rhythm' && state.index > 0) {
    const delta = action.at - state.lastBeatAt;
    const beat = 60_000 / RHYTHM_BPM;
    if (delta < beat - RHYTHM_TOLERANCE_MS) return changed({ ...state, index: 0, lastBeatAt: null }, 'Чуть спокойнее: дождись следующей доли метронома и начни снова.');
    if (delta > beat + RHYTHM_TOLERANCE_MS) return changed({ ...state, index: 0, lastBeatAt: null }, 'Нажимай ближе к щелчку метронома. Попробуй ещё раз.');
  }
  const nextIndex = state.index + 1;
  if (nextIndex < sequence.length) return changed({ ...state, index: nextIndex, lastBeatAt: action.at, lastFeedback: '' });
  if (state.stage === 'learning') return changed({ ...state, stage: 'practice', index: 0, lastBeatAt: null }, 'Отлично! Теперь сыграй мелодию из восьми нот.');
  if (state.stage === 'practice') return changed({ ...state, stage: 'rhythm', index: 0, lastBeatAt: null }, 'Мелодия выучена. Повтори её в ровном ритме — 90 ударов в минуту.');
  if (state.stage === 'rhythm') return changed({ ...state, stage: 'concert_ready', index: 0, pianoMode: false, lastBeatAt: null }, 'Прекрасный ритм! Подойди к сцене и нажми E у пианино.');
  if (state.stage === 'concert_ready') return changed({ ...state, stage: 'completed', index: sequence.length, pianoMode: false, lastBeatAt: null }, 'Зал аплодирует! Ты успешно выступил на концерте!');
  return noChange(state, 'Готово.');
}

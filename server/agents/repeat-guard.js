// Защита от повторов в ответах NPC: сравнение начала нового ответа с тем, что агент уже говорил этому игроку.
// Сравнение нечёткое (слова без регистра, пунктуации и окончаний), поэтому два разных ответа модели не обязаны
// отличаться побуквенно, а переформулированный повтор содержательного совета всё равно распознаётся.

const MIN_WORDS = 3; // короче предложения не сравниваем: «Хорошо.» может встретиться дважды без повтора
const STEM = 5; // грубая основа: первые буквы слова убирают падежные окончания

const words = (text) =>
  String(text)
    .toLowerCase()
    .replaceAll('ё', 'е')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** Множество основ слов длиной от 3 букв (предлоги и частицы не считаются). */
export function fingerprint(text) {
  return new Set(words(text).filter((w) => w.length >= 3).map((w) => w.slice(0, STEM)));
}

/** Сходство множеств основ, 0..1 (Жаккар). */
export function similarity(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const item of a) if (b.has(item)) common += 1;
  return common / (a.size + b.size - common);
}

/** Предложения текста (с хвостом без знака конца). */
export function splitSentences(text) {
  return (String(text).match(/[^.!?…]+[.!?…]*/gu) ?? []).map((s) => s.trim()).filter(Boolean);
}

/**
 * @param {object} deps
 * @param {string[]} deps.previous прежние реплики агента этому игроку (ответы и краткие заметки о них)
 * @param {number} [deps.threshold] сходство предложений, начиная с которого оно считается повтором
 * @param {number} [deps.minChars] сколько символов начала ответа нужно для решения
 * @param {number} [deps.maxChars] после скольких символов решение принимается в любом случае
 */
export function createRepeatGuard({ previous, threshold = 0.7, minChars = 25, maxChars = 140 }) {
  const known = [];
  for (const text of previous) {
    for (const sentence of splitSentences(text)) {
      const print = fingerprint(sentence);
      if (print.size >= MIN_WORDS) known.push(print);
    }
  }

  /**
   * Решение по уже полученному началу ответа.
   * @returns {'wait'|'ok'|'repeat'} wait — данных мало, ok — можно показывать, repeat — это повтор
   */
  function check(opening, { ended = false } = {}) {
    const text = opening.trim();
    if (!text) return ended ? 'ok' : 'wait';
    const sentences = splitSentences(text);
    // Предложение завершено, если после него что-то есть или стоит знак конца.
    const done = sentences.filter((s, i) => i < sentences.length - 1 || /[.!?…]$/u.test(s));
    const enough = ended || text.length >= maxChars || (done.length > 0 && done.join(' ').length >= minChars);
    if (!enough) return 'wait';
    const candidates = ended || text.length >= maxChars ? sentences : done;
    for (const sentence of candidates) {
      const print = fingerprint(sentence);
      if (print.size < MIN_WORDS) continue;
      if (known.some((old) => similarity(print, old) >= threshold)) return 'repeat';
    }
    return 'ok';
  }

  return { check };
}

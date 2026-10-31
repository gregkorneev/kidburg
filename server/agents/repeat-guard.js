// Защита от повторов в ответах NPC: сравнение начала нового ответа с тем, что агент уже говорил этому игроку.
// Сравнение нечёткое (слова без регистра, пунктуации и окончаний), поэтому два разных ответа модели не обязаны
// отличаться побуквенно, а переформулированный повтор приветствия или совета всё равно распознаётся.

/** Приветствие в начале ответа: здороваться агент должен только при первой встрече. */
const GREETING = /^(привет\p{L}*|здравствуй\p{L}*|добр(ый|ое|ого) (день|вечер|утро|утра)|приветству\p{L}*|салют|хай)$/u;

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

/** Здоровается ли текст в самом начале («Привет, Аня!», «Здравствуйте!», «Добрый день»). */
export function startsWithGreeting(text) {
  const w = words(text);
  if (GREETING.test(w[0] ?? '')) return true;
  return GREETING.test(`${w[0] ?? ''} ${w[1] ?? ''}`);
}

/**
 * @param {object} deps
 * @param {string[]} deps.previous прежние реплики агента этому игроку (ответы и краткие заметки о них)
 * @param {boolean} deps.met true, если игрок и агент уже разговаривали: тогда здороваться повторно нельзя
 * @param {number} [deps.threshold] сходство предложений, начиная с которого оно считается повтором
 * @param {number} [deps.minChars] сколько символов начала ответа нужно для решения
 * @param {number} [deps.maxChars] после скольких символов решение принимается в любом случае
 */
export function createRepeatGuard({ previous, met, threshold = 0.7, minChars = 25, maxChars = 140 }) {
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
    // Первое слово определено, когда за ним есть разделитель или поток закончился.
    const firstWordKnown = ended || /[\s,.!?…:;—-]/u.test(text.slice(1));
    if (met && firstWordKnown && startsWithGreeting(text)) return 'repeat';
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

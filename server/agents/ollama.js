// Клиент локальной Ollama: потоковый /api/chat (NDJSON). Только loopback, без внешних адресов.

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const MAX_ERROR_BODY = 2048;

/**
 * Ошибка обращения к Ollama. `message` безопасно показывать игроку, `detail` — только для журнала.
 * code: unavailable | model_missing | http | timeout | bad_stream | model_error | empty
 */
export class OllamaError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'OllamaError';
    this.expose = true; // message можно отправить игроку
    this.code = code;
    this.detail = detail;
  }
}

/** Адрес Ollama допустим только на loopback: ИИ-запросы не должны покидать сервер. */
export function assertLoopbackUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`OLLAMA_URL: некорректный адрес`);
  }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error('OLLAMA_URL: разрешён только http на 127.0.0.1, localhost или [::1]');
  }
  return url.origin;
}

async function readErrorBody(res) {
  try {
    const text = (await res.text()).slice(0, MAX_ERROR_BODY);
    try {
      const json = JSON.parse(text);
      return typeof json.error === 'string' ? json.error : text;
    } catch {
      return text;
    }
  } catch {
    return '';
  }
}

/**
 * Потоково запрашивает ответ модели и отдаёт фрагменты текста.
 * Завершается, когда Ollama прислала `done: true`; иначе бросает OllamaError.
 * Отмена `signal` обрывает HTTP-запрос и бросает AbortError (вызывающий отличает её по signal.aborted).
 *
 * @param {object} p
 * @param {string} p.baseUrl
 * @param {string} p.model
 * @param {{role:string, content:string}[]} p.messages
 * @param {object} [p.options] параметры модели Ollama (num_predict, temperature, num_ctx)
 * @param {boolean} [p.think] включить режим рассуждений (по умолчанию выключен)
 * @param {string|number} [p.keepAlive]
 * @param {'json'|object} [p.format] Ollama response format constraint
 * @param {AbortSignal} [p.signal]
 * @param {number} [p.idleTimeoutMs] максимальная пауза между фрагментами
 * @param {number} [p.totalTimeoutMs] предел на весь ответ
 * @param {typeof fetch} [p.fetchImpl] подмена для тестов
 */
export async function* chatStream({
  baseUrl = DEFAULT_OLLAMA_URL,
  model,
  messages,
  options = {},
  think = false,
  keepAlive,
  format,
  signal,
  idleTimeoutMs = 45_000,
  totalTimeoutMs = 120_000,
  fetchImpl = fetch,
}) {
  const origin = assertLoopbackUrl(baseUrl);
  const controller = new AbortController();
  let timedOut = false;
  const abortForTimeout = () => {
    timedOut = true;
    controller.abort();
  };
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const totalTimer = setTimeout(abortForTimeout, totalTimeoutMs);
  let idleTimer = setTimeout(abortForTimeout, idleTimeoutMs);
  const touch = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(abortForTimeout, idleTimeoutMs);
  };

  try {
    const body = { model, messages, stream: true, think, options };
    if (format !== undefined) body.format = format;
    if (keepAlive !== undefined) body.keep_alive = keepAlive;
    let res;
    try {
      res = await fetchImpl(`${origin}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (timedOut) throw new OllamaError('timeout', 'Модель не ответила вовремя');
      if (signal?.aborted || err?.name === 'AbortError') throw err;
      throw new OllamaError('unavailable', 'Локальная модель недоступна (Ollama не запущена?)', err?.cause?.code ?? err?.message);
    }
    touch();

    if (!res.ok) {
      const detail = await readErrorBody(res);
      if (res.status === 404 && /not found/i.test(detail)) {
        throw new OllamaError('model_missing', `Модель «${model}» не загружена в Ollama`, detail);
      }
      throw new OllamaError('http', `Ollama вернула ошибку ${res.status}`, detail);
    }
    if (!res.body) throw new OllamaError('bad_stream', 'Пустой ответ Ollama');

    const decoder = new TextDecoder();
    let buffer = '';
    let finished = false;

    // Возвращает фрагмент текста ('' если в строке нет текста) или null после done.
    const handleLine = (line) => {
      let chunk;
      try {
        chunk = JSON.parse(line);
      } catch {
        throw new OllamaError('bad_stream', 'Некорректный поток от модели', line.slice(0, 80));
      }
      if (chunk === null || typeof chunk !== 'object' || Array.isArray(chunk)) {
        throw new OllamaError('bad_stream', 'Некорректный поток от модели', 'не объект');
      }
      if (typeof chunk.error === 'string') {
        throw new OllamaError('model_error', 'Модель вернула ошибку', chunk.error.slice(0, 200));
      }
      const text = typeof chunk.message?.content === 'string' ? chunk.message.content : '';
      if (chunk.done === true) finished = true;
      return text;
    };

    try {
      for await (const part of res.body) {
        touch();
        buffer += decoder.decode(part, { stream: true });
        let nl;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const text = handleLine(line);
          if (text) yield text;
          if (finished) return;
        }
        if (buffer.length > 1_000_000) throw new OllamaError('bad_stream', 'Слишком длинная строка потока');
      }
    } catch (err) {
      if (err instanceof OllamaError) throw err;
      if (timedOut) throw new OllamaError('timeout', 'Модель не ответила вовремя');
      if (signal?.aborted || err?.name === 'AbortError') throw err;
      throw new OllamaError('bad_stream', 'Связь с моделью оборвалась', err?.message);
    }

    buffer += decoder.decode();
    const tail = buffer.trim();
    if (tail) {
      const text = handleLine(tail);
      if (text) yield text;
    }
    if (!finished) throw new OllamaError('bad_stream', 'Поток модели оборвался до завершения');
  } finally {
    clearTimeout(totalTimer);
    clearTimeout(idleTimer);
    signal?.removeEventListener('abort', onAbort);
    controller.abort();
  }
}

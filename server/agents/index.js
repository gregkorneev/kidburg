// Мозг NPC на локальной Ollama. Контракт: shared/agent-api.md.
// reply() отдаёт токены ответа; память — последние реплики пары (userId, agentId) в agent_memory.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_OLLAMA_URL, OllamaError, assertLoopbackUrl, chatStream } from './ollama.js';
import { createRepeatGuard } from './repeat-guard.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGENT_ID_RE = /^[a-z][a-z0-9_]{0,31}$/;

export const AGENT_DEFAULTS = Object.freeze({
  baseUrl: DEFAULT_OLLAMA_URL,
  model: '', // задаётся только через OLLAMA_MODEL или config.agents.model
  personaDir: path.join(HERE, 'personas'),
  maxConcurrent: 2, // совпадает с OLLAMA_NUM_PARALLEL=2 из docs/PROJECT_CONTEXT.md
  maxQueue: 8,
  maxInputChars: 500,
  historyMessages: 12, // сколько реплик хранится в agent_memory.turns
  contextMessages: 8, // сколько последних реплик уходит в модель
  contextChars: 3000, // и не больше стольких символов
  storedMessageChars: 600,
  notesKept: 8, // сколько кратких заметок «о чём уже рассказано» хранится на пару игрок-агент
  noteChars: 110,
  situationChars: 900,
  repeatRetries: 2, // сколько раз перегенерировать ответ, начало которого повторяет сказанное раньше
  repeatThreshold: 0.7, // сходство предложений (0..1), с которого оно считается повтором
  maxReplyChars: 1200,
  numPredict: 200,
  numCtx: 4096,
  temperature: 0.7,
  idleTimeoutMs: 45_000,
  totalTimeoutMs: 120_000,
  probeOnStart: false,
});

const intEnv = (v, fallback) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Настройки агентов: значения по умолчанию < переменные окружения < config.agents. */
export function resolveAgentConfig(overrides = {}, env = process.env) {
  const fromEnv = {
    baseUrl: env.OLLAMA_URL || undefined,
    model: env.OLLAMA_MODEL || undefined,
    maxConcurrent: intEnv(env.AGENT_MAX_CONCURRENT, undefined),
    maxQueue: intEnv(env.AGENT_MAX_QUEUE, undefined),
    numPredict: intEnv(env.AGENT_NUM_PREDICT, undefined),
    numCtx: intEnv(env.OLLAMA_NUM_CTX, undefined),
    idleTimeoutMs: intEnv(env.OLLAMA_IDLE_TIMEOUT_MS, undefined),
    totalTimeoutMs: intEnv(env.OLLAMA_TOTAL_TIMEOUT_MS, undefined),
    keepAlive: env.OLLAMA_KEEP_ALIVE ? (Number.isFinite(Number(env.OLLAMA_KEEP_ALIVE)) ? Number(env.OLLAMA_KEEP_ALIVE) : env.OLLAMA_KEEP_ALIVE) : undefined,
  };
  const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  const cfg = { ...AGENT_DEFAULTS, ...defined(fromEnv), ...defined(overrides) };
  cfg.baseUrl = assertLoopbackUrl(cfg.baseUrl);
  return cfg;
}

/** Одна строка без управляющих символов и кавычек, чтобы текст не ломал структуру промпта. */
function clean(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f"«»`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Реплика игрока: только управляющие символы заменяются пробелами. */
const normalizeText = (value, max) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** Начало ответа (первые предложения, пока не наберётся ~30 символов; не больше `max`): заметка о сказанном. */
function firstSentence(text, max) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  let note = '';
  for (const part of flat.match(/[^.!?…]+[.!?…]*\s*/g) ?? [flat]) {
    note = `${note}${part}`;
    if (note.trim().length >= 30) break;
  }
  note = note.trim();
  return note.length > max ? `${note.slice(0, max - 1).trimEnd()}…` : note;
}

const abortError = () => new DOMException('Запрос отменён', 'AbortError');

/** Не более `max` одновременных генераций, остальные ждут в очереди ограниченной длины. */
function createSlots(max, maxQueue) {
  let active = 0;
  const queue = [];

  const report = () => {
    queue.forEach((w, i) => {
      if (w.pos === i + 1) return;
      w.pos = i + 1;
      try {
        w.onQueue?.(w.pos);
      } catch {
        // колбэк клиента не должен ломать очередь
      }
    });
  };

  function makeRelease() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active -= 1;
      const next = queue.shift();
      if (next) {
        next.signal?.removeEventListener('abort', next.onAbort);
        active += 1;
        next.resolve(makeRelease());
        report();
      }
    };
  }

  return {
    get active() {
      return active;
    },
    get queued() {
      return queue.length;
    },
    acquire({ signal, onQueue } = {}) {
      if (signal?.aborted) return Promise.reject(abortError());
      if (active < max && queue.length === 0) {
        active += 1;
        return Promise.resolve(makeRelease());
      }
      if (queue.length >= maxQueue) {
        return Promise.reject(new OllamaError('busy', 'Все наставники сейчас заняты, попробуйте через минуту'));
      }
      return new Promise((resolve, reject) => {
        const w = { resolve, signal, onQueue, pos: 0 };
        w.onAbort = () => {
          queue.splice(queue.indexOf(w), 1);
          report();
          reject(abortError());
        };
        signal?.addEventListener('abort', w.onAbort, { once: true });
        queue.push(w);
        report();
      });
    },
  };
}

function loadPersonaFile(dir, agentId) {
  const file = path.join(dir, `${agentId}.json`);
  if (!existsSync(file)) return null;
  const data = JSON.parse(readFileSync(file, 'utf8'));
  for (const field of ['name', 'role', 'about', 'style']) {
    if (typeof data[field] !== 'string' || !data[field].trim()) {
      throw new Error(`${file}: нет поля ${field}`);
    }
  }
  return data;
}

function personaPrompt(p) {
  const lines = [`Имя: ${p.name}`, `Профессия: ${p.role}`, `О себе: ${p.about}`, `Манера речи: ${p.style}`];
  if (Array.isArray(p.topics) && p.topics.length) lines.push(`О чём охотно рассказываешь: ${p.topics.join('; ')}`);
  return lines.join('\n');
}

const isTurn = (t) =>
  t !== null && typeof t === 'object' && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string';

/** Последние реплики, влезающие в лимит по числу и по символам (идут от новых к старым). */
function pickContext(turns, cfg) {
  const picked = [];
  let chars = 0;
  for (let i = turns.length - 1; i >= 0 && picked.length < cfg.contextMessages; i--) {
    const t = turns[i];
    if (!isTurn(t)) continue;
    chars += t.text.length;
    if (chars > cfg.contextChars) break;
    picked.unshift({ role: t.role, content: t.text });
  }
  return picked;
}

/**
 * @param {object} deps
 * @param {ReturnType<import('../db/index.js').openDb>} deps.db
 * @param {object} [deps.config] настройки сервера; используется config.agents
 * @param {{warn:Function, error:Function, info?:Function}} [deps.log]
 */
export function createAgents({ db, config = {}, log, env = process.env }) {
  const cfg = resolveAgentConfig(config.agents, env);
  const slots = createSlots(cfg.maxConcurrent, cfg.maxQueue);
  const fetchImpl = config.agents?.fetchImpl ?? fetch;
  const personas = new Map();
  let systemRules = null;

  const getSystemRules = () => {
    systemRules ??= readFileSync(path.join(cfg.personaDir, 'system.md'), 'utf8').trim();
    return systemRules;
  };

  function getPersona(agentId) {
    if (personas.has(agentId)) return personas.get(agentId);
    let persona = null;
    try {
      persona = loadPersonaFile(cfg.personaDir, agentId);
    } catch (err) {
      log?.error({ err, agentId }, 'не удалось прочитать файл личности агента');
      throw new OllamaError('persona', 'Персонаж временно недоступен', err.message);
    }
    if (!persona) throw new OllamaError('persona', 'Этот персонаж пока не умеет разговаривать');
    personas.set(agentId, persona);
    return persona;
  }

  /**
   * Память пары игрок-агент: {turns, notes, exchanges, lastSituation}. Наши поля лежат в `topics.dialogue`,
   * остальное содержимое topics, а также summary и toldCards принадлежит будущему подбору карточек и не трогается.
   * При сбое чтения возвращается пустая память.
   */
  function loadMemory(userId, agentId) {
    try {
      const memory = db.getAgentMemory(userId, agentId);
      const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
      const topics = isObject(memory?.topics) ? memory.topics : {};
      const dialogue = isObject(topics.dialogue) ? topics.dialogue : {};
      const last = dialogue.lastSituation;
      return {
        raw: memory,
        topics,
        turns: Array.isArray(memory?.turns) ? memory.turns : [],
        notes: Array.isArray(dialogue.notes) ? dialogue.notes.filter((n) => typeof n === 'string') : [],
        exchanges: Number.isInteger(dialogue.exchanges) && dialogue.exchanges > 0 ? dialogue.exchanges : 0,
        lastSituation:
          isObject(last) && typeof last.key === 'string' && typeof last.label === 'string' ? { key: last.key, label: last.label } : null,
      };
    } catch (err) {
      log?.warn({ err, agentId }, 'не удалось прочитать память агента');
      return { raw: null, topics: {}, turns: [], notes: [], exchanges: 0, lastSituation: null };
    }
  }

  /**
   * Сохраняет обмен репликами: последние реплики (turns), краткие заметки о сказанном (чтобы не повторяться
   * дольше окна turns), счётчик обменов и ход задания на момент разговора.
   */
  function saveTurns(userId, agentId, text, answer, situation) {
    try {
      const memory = loadMemory(userId, agentId);
      const cut = (s) => s.slice(0, cfg.storedMessageChars);
      const turns = [
        ...memory.turns,
        { role: 'user', text: cut(text) },
        { role: 'assistant', text: cut(answer) },
      ].slice(-cfg.historyMessages);
      const note = firstSentence(answer, cfg.noteChars);
      const notes = (note ? [...memory.notes, note] : memory.notes).slice(-cfg.notesKept);
      const lastSituation = situation ? { key: situation.key, label: situation.label } : memory.lastSituation;
      db.saveAgentMemory(userId, agentId, {
        toldCards: memory.raw?.toldCards,
        summary: memory.raw?.summary,
        topics: {
          ...memory.topics,
          dialogue: { notes, exchanges: memory.exchanges + 1, ...(lastSituation ? { lastSituation } : {}) },
        },
        turns,
      });
    } catch (err) {
      log?.error({ err, agentId }, 'не удалось сохранить память агента');
    }
  }

  /** Ход задания из context.situation ({key, label, text}), собранный сервером; иначе null. */
  function readSituation(context) {
    const s = context?.situation;
    if (!s || typeof s.key !== 'string' || typeof s.text !== 'string') return null;
    const text = normalizeText(s.text, cfg.situationChars);
    const key = clean(s.key, 40);
    if (!text || !key) return null;
    return { key, label: clean(s.label, 40) || key, text };
  }

  const RETRY_NOTE =
    'Твой прошлый вариант ответа повторял то, что ты уже говорила этому игроку. Ответь иначе: без приветствия, другими словами и скажи что-то новое по теме вопроса.';

  function buildMessages(persona, req, text, situation, memory, retry = false) {
    const context = req.context ?? {};
    const facts = [];
    const player = clean(context.playerName, 32);
    if (player) facts.push(`Собеседника зовут ${player}.`);
    const district = clean(context.district, 40);
    if (district) facts.push(`Разговор идёт в районе «${district}».`);
    if (situation) {
      facts.push(`Ход задания игрока (подтверждён сервером, других сведений об успехах игрока нет): ${situation.text}`);
    }
    if (memory.exchanges === 0 && memory.turns.length === 0) {
      facts.push('Это ваша первая встреча с этим игроком: коротко представься.');
    } else {
      facts.push('Вы с этим игроком уже разговаривали: не здоровайся и не представляйся заново, продолжай разговор.');
      if (memory.notes.length) {
        facts.push(
          `Ты уже рассказывала: ${memory.notes.join(' ')} Не выдавай это за новое: если игрок не просит повторить, скажи что-то новое или напомни одной фразой.`,
        );
      }
      if (situation && memory.lastSituation && memory.lastSituation.key !== situation.key) {
        facts.push(
          `С прошлого разговора ход задания изменился: тогда был этап «${memory.lastSituation.label}», теперь «${situation.label}».`,
        );
      }
    }
    if (retry) facts.push(RETRY_NOTE);
    const system = [getSystemRules(), 'Твой персонаж:', personaPrompt(persona), facts.join(' ')]
      .filter(Boolean)
      .join('\n\n');
    return [
      { role: 'system', content: system },
      ...pickContext(memory.turns, cfg),
      { role: 'user', content: text },
    ];
  }

  async function* reply(req) {
    if (!Number.isInteger(req?.userId) || typeof req.agentId !== 'string' || !AGENT_ID_RE.test(req.agentId)) {
      throw new OllamaError('persona', 'Неверный запрос к персонажу');
    }
    const text = normalizeText(req.text, cfg.maxInputChars);
    if (!text) throw new OllamaError('empty', 'Пустая реплика');
    if (!cfg.model) {
      throw new OllamaError('not_configured', 'ИИ не настроен: администратору нужно задать переменную OLLAMA_MODEL');
    }
    const persona = getPersona(req.agentId);
    const release = await slots.acquire({ signal: req.signal, onQueue: req.onQueue });
    try {
      const situation = readSituation(req.context);
      const memory = loadMemory(req.userId, req.agentId);
      const guard = createRepeatGuard({
        previous: [...memory.notes, ...memory.turns.filter((t) => isTurn(t) && t.role === 'assistant').map((t) => t.text)],
        met: memory.exchanges > 0 || memory.turns.length > 0,
        threshold: cfg.repeatThreshold,
      });

      // Начало ответа держится, пока не проверено, что это не повтор сказанного раньше; затем текст идёт потоком.
      // Повтор не показывается игроку: ответ генерируется заново (ограниченное число раз), иначе — ошибка.
      for (let attempt = 0; attempt <= cfg.repeatRetries; attempt++) {
        const messages = buildMessages(persona, req, text, situation, memory, attempt > 0);
        const temperature = Math.min(1, cfg.temperature + 0.15 * attempt);
        const outcome = yield* generate(req, messages, temperature, guard);
        if (req.signal?.aborted) return;
        if (outcome.repeated) {
          log?.info?.({ agentId: req.agentId, attempt }, 'ответ повторяет сказанное раньше, генерация заново');
          continue;
        }
        if (!outcome.answer.trim()) throw new OllamaError('empty', 'Модель вернула пустой ответ');
        saveTurns(req.userId, req.agentId, text, outcome.answer.trim(), situation);
        return;
      }
      throw new OllamaError('repeat', 'Собеседник повторился и не придумал нового ответа. Попробуйте спросить иначе или повторите вопрос.');
    } finally {
      release();
    }
  }

  /** Одна генерация: отдаёт токены после проверки начала, возвращает {answer, repeated}. */
  async function* generate(req, messages, temperature, guard) {
    let answer = '';
    let held = '';
    let released = false;
    let truncated = false;

    const emit = function* (token) {
      if (answer.length + token.length > cfg.maxReplyChars) {
        token = token.slice(0, cfg.maxReplyChars - answer.length);
        truncated = true;
      }
      answer += token;
      if (token) yield token;
    };

    for await (let token of chatStream({
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      messages,
      options: { num_predict: cfg.numPredict, num_ctx: cfg.numCtx, temperature },
      keepAlive: cfg.keepAlive,
      signal: req.signal,
      idleTimeoutMs: cfg.idleTimeoutMs,
      totalTimeoutMs: cfg.totalTimeoutMs,
      fetchImpl,
    })) {
      if (released) {
        yield* emit(token);
        if (truncated) break;
        continue;
      }
      held += token;
      const verdict = guard.check(held.trimStart(), { ended: false });
      if (verdict === 'wait') continue;
      if (verdict === 'repeat') return { answer: '', repeated: true };
      released = true;
      yield* emit(held.trimStart());
      if (truncated) break;
    }
    if (req.signal?.aborted) return { answer, repeated: false };
    if (!released && held.trim()) {
      if (guard.check(held.trimStart(), { ended: true }) === 'repeat') return { answer: '', repeated: true };
      yield* emit(held.trimStart());
    }
    return { answer, repeated: false };
  }

  /** Проверка при старте: только журнал, ничего не бросает. */
  async function probe() {
    if (!cfg.model) {
      log?.warn('OLLAMA_MODEL не задана: разговоры с NPC вернут ошибку (пример: OLLAMA_MODEL=qwen3:8b npm start)');
      return;
    }
    try {
      const res = await fetchImpl(`${cfg.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const names = ((await res.json()).models ?? []).map((m) => m.name);
      if (!names.some((n) => n === cfg.model || n === `${cfg.model}:latest`)) {
        log?.warn(`Модель «${cfg.model}» не найдена в Ollama; загрузите её: ollama pull ${cfg.model}`);
      } else {
        log?.info(`Ollama доступна, модель «${cfg.model}» найдена`);
      }
    } catch (err) {
      log?.warn({ err: err.message }, `Ollama недоступна на ${cfg.baseUrl}: NPC не смогут отвечать`);
    }
  }

  return {
    config: cfg,
    reply,
    probe,
    get busy() {
      return { active: slots.active, queued: slots.queued };
    },
  };
}

// Экземпляр, созданный registerAgents; reply() ниже — точка входа контракта shared/agent-api.md.
let current = null;

export function registerAgents(app, ctx) {
  const agents = createAgents({ db: ctx.db, config: ctx.config, log: ctx.log });
  current = agents;
  if (!agents.config.model) agents.probe();
  else if (agents.config.probeOnStart) app.addHook('onReady', async () => void agents.probe());
  app.addHook('onClose', async () => {
    if (current === agents) current = null;
  });
}

/** Контракт: shared/agent-api.md (ReplyRequest). */
export async function* reply(req) {
  if (!current) throw new OllamaError('not_configured', 'Модуль агентов не запущен');
  yield* current.reply(req);
}

// Мозг NPC на локальной Ollama. Контракт: shared/agent-api.md.
// reply() отдаёт токены ответа; память — последние реплики пары (userId, agentId) в agent_memory.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_OLLAMA_URL, OllamaError, assertLoopbackUrl, chatStream } from './ollama.js';
import { createRepeatGuard } from './repeat-guard.js';
import { SETTINGS_DEFAULTS, applySettings, validateSettings } from './settings.js';

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

const radioTopicId = (category, title) =>
  `radio-${createHash('sha256').update(`${category}:${title.toLocaleLowerCase('ru').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}`).digest('hex').slice(0, 20)}`;

function radioOutput(raw, category, recentTopicIds, fact) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new OllamaError('bad_output', 'Модель вернула некорректный сценарий');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new OllamaError('bad_output', 'Модель вернула некорректный сценарий');
  }
  if (Object.keys(data).sort().join(',') !== 'category,text,title') {
    throw new OllamaError('bad_output', 'Модель вернула некорректный сценарий');
  }
  const modelTitle = typeof data.title === 'string' ? data.title.trim() : '';
  const text = typeof data.text === 'string' ? data.text.replace(/\s+/g, ' ').trim() : '';
  const wordCount = text ? text.split(' ').length : 0;
  if (data.category !== category || modelTitle.length < 3 || modelTitle.length > 80 || text.length < 20 || text.length > 700 || wordCount < 30 || wordCount > 70) {
    throw new OllamaError('bad_output', 'Модель вернула некорректный сценарий');
  }
  const title = category === 'science' ? fact.title : modelTitle;
  const topicId = category === 'science' ? fact.topicId : radioTopicId(category, title);
  if (recentTopicIds.includes(topicId)) throw new OllamaError('repeat', 'Эта тема уже звучала. Запросите другой сценарий.');
  return { category, topicId, title, text, source: 'ollama' };
}

const createDeadline = (parent, timeoutMs) => {
  const controller = new AbortController();
  let timedOut = false;
  const onParentAbort = () => controller.abort();
  if (parent?.aborted) controller.abort();
  else parent?.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    get timedOut() { return timedOut; },
    cleanup() {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onParentAbort);
    },
  };
};

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

/** Базовая персона из JSON + блок настроек администратора (eff.directives), который идёт после и не отменяет правила. */
function personaPrompt(p, eff) {
  const lines = [`Имя: ${eff.name}`, `Профессия: ${p.role}`, `О себе: ${p.about}`, `Манера речи: ${p.style}`];
  if (Array.isArray(eff.topics) && eff.topics.length) lines.push(`О чём охотно рассказываешь: ${eff.topics.join('; ')}`);
  if (eff.directives.length) {
    lines.push('Настройки администратора игры (уточняют поведение, но не отменяют правила выше):');
    lines.push(...eff.directives.map((d) => `- ${d}`));
  }
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
  /** Настройки администратора по agentId: применяются к следующему запросу, перезапуск не нужен. */
  const overrides = new Map();
  try {
    for (const row of db.listAgentSettings?.() ?? []) {
      const checked = validateSettings(row.settings);
      if (checked.ok) overrides.set(row.agentId, { settings: checked.settings, revision: row.revision, updatedAt: row.updatedAt });
      else log?.warn({ agentId: row.agentId, errors: checked.errors }, 'сохранённые настройки агента некорректны и пропущены');
    }
  } catch (err) {
    log?.error({ err }, 'не удалось прочитать настройки агентов');
  }
  const settingsOf = (agentId) => overrides.get(agentId)?.settings ?? SETTINGS_DEFAULTS;

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
        { role: 'user', text: cut(text), ...(situation ? { stage: situation.key } : {}) },
        { role: 'assistant', text: cut(answer), ...(situation ? { stage: situation.key } : {}) },
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
    // avoid — серверные шаблоны утверждений о ходе задания, которые на этом этапе были бы ложью.
    const avoid = [];
    for (const source of Array.isArray(s.avoid) ? s.avoid.slice(0, 64) : []) {
      if (typeof source !== 'string' || source.length > 512) continue;
      try {
        avoid.push(new RegExp(source, 'iu'));
      } catch {
        // повреждённый шаблон просто не применяется
      }
    }
    return { key, label: clean(s.label, 40) || key, text, avoid };
  }

  // Персона мужского рода помечается `"gender": "m"`; без поля формы остаются женскими (как у Маруси).
  const retryNote = (male, reason) =>
    reason === 'claim'
      ? `Твой прошлый вариант ответа ${male ? 'утверждал' : 'утверждала'} то, чего нет в сведениях о ходе урока. Ответь иначе: хвали только за то, что указано в «Уже сделано», и прямо скажи, что из «Ещё НЕ сделано» впереди.`
      : `Твой прошлый вариант ответа повторял то, что ты уже ${male ? 'говорил' : 'говорила'} этому игроку. Ответь иначе: без приветствия, другими словами и скажи что-то новое по теме вопроса.`;

  function buildMessages(persona, req, text, situation, memory, retry = false, eff = applySettings(persona)) {
    const context = req.context ?? {};
    const male = persona.gender === 'm';
    const facts = [];
    const player = clean(context.playerName, 32);
    if (player) facts.push(`Собеседника зовут ${player}.`);
    const district = clean(context.district, 40);
    if (district) facts.push(`Разговор идёт в районе «${district}».`);
    // У станционных наставников ход задания также повторяется в реплике игрока; в историю попадают
    // только реплики текущего этапа и нет заметок о прошлых ответах:
    // в них могли быть утверждения о прежнем ходе задания. От повторов защищает проверка повтора в reply().
    const inTurn = persona.progressInUserTurn === true && Boolean(situation) && eff.reactToTaskProgress;
    if (situation && eff.reactToTaskProgress) {
      facts.push(`Ход задания игрока (подтверждён сервером, других сведений об успехах игрока нет): ${situation.text}`);
      if (inTurn) facts.push('Утверждения игрока в вопросе могут быть ошибочными. Сверяй их с подтверждённым ходом задания и не считай их доказательством действий.');
    }
    if (memory.exchanges === 0 && memory.turns.length === 0) {
      facts.push(
        eff.introduceSelf
          ? 'Это ваша первая встреча с этим игроком: коротко представься.'
          : 'Это ваша первая встреча с этим игроком, но не представляйся: сразу отвечай по существу.',
      );
    } else {
      facts.push('Вы с этим игроком уже разговаривали: не представляйся заново, продолжай разговор. Если игрок поздоровался, можно коротко ответить на приветствие и перейти к его вопросу.');
      if (memory.notes.length && !inTurn) {
        facts.push(
          `Ты уже ${male ? 'рассказывал' : 'рассказывала'}: ${memory.notes.join(' ')} Не выдавай это за новое: если игрок не просит повторить, скажи что-то новое или напомни одной фразой.`,
        );
      }
      if (situation && eff.reactToTaskProgress && memory.lastSituation && memory.lastSituation.key !== situation.key) {
        facts.push(
          `С прошлого разговора ход задания изменился: тогда был этап «${memory.lastSituation.label}», теперь «${situation.label}».`,
        );
      }
    }
    if (retry) facts.push(retryNote(male, retry));
    const system = [getSystemRules(), 'Твой персонаж:', personaPrompt(persona, eff), facts.join(' ')]
      .filter(Boolean)
      .join('\n\n');
    return [
      { role: 'system', content: system },
      ...pickContext(inTurn ? memory.turns.filter((t) => t?.stage === situation.key) : memory.turns, cfg),
      { role: 'user', content: inTurn ? `Достоверные сведения о ходе урока: ${situation.text}\n\nВопрос игрока: ${text}` : text },
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
    // Настройки читаются один раз на запрос: идущая генерация не меняется на полуслове.
    const eff = applySettings(persona, req.settingsOverride ?? settingsOf(req.agentId));
    if (!eff.enabled) throw new OllamaError('disabled', 'Этот наставник сейчас недоступен. Загляните позже.');
    const situation = readSituation(req.context);
    // Потеря серверного состояния не должна незаметно отключать защиту от ложных достижений.
    if (persona.progressInUserTurn === true && req.ephemeral !== true && (!situation || !situation.avoid.length)) {
      throw new OllamaError('context_unavailable', 'Не удалось прочитать ход задания. Попробуйте поговорить позже.');
    }
    const release = await slots.acquire({ signal: req.signal, onQueue: req.onQueue });
    try {
      // Проверочные реплики администратора (ephemeral) не читают и не пишут память игроков.
      const memory = req.ephemeral === true ? emptyMemory() : loadMemory(req.userId, req.agentId);
      // Напоминание по просьбе игрока может повторять прежний ответ; проверка фактов ниже остаётся включённой.
      const reminder = /(?:^|\s)(?:напомни|повтори)(?:\s|[,.!?]|$)/iu.test(text)
        || Boolean(situation && /(?:^|\s)(?:что(?:\s+\p{L}+){0,5}\s+(?:делать|дальше)|с\s+чего(?:\s+\p{L}+){0,3}\s+начать)(?:[^\p{L}]|$)/iu.test(text));
      const repeatGuard = createRepeatGuard({
        previous: reminder ? [] : [...memory.notes, ...memory.turns.filter((t) => isTurn(t) && t.role === 'assistant').map((t) => t.text)],
        threshold: cfg.repeatThreshold,
        ...(situation?.avoid.length && persona.progressInUserTurn === true ? { minChars: 170, maxChars: 300 } : {}),
      });
      // Станционный ответ проверяется целиком до выдачи: совпадение с шаблоном вызывает перегенерацию.
      let contradicted = false;
      const guard = situation?.avoid.length && persona.progressInUserTurn === true && eff.reactToTaskProgress
        ? {
            bufferAll: true,
            check(opening, options) {
              const verdict = repeatGuard.check(opening, options);
              if (verdict !== 'ok') return verdict;
              if (!situation.avoid.some((pattern) => pattern.test(opening))) return 'ok';
              contradicted = true;
              return 'repeat';
            },
          }
        : repeatGuard;

      // Ответы с проверкой фактов буферизуются целиком; остальные проходят прежнюю проверку начала.
      for (let attempt = 0; attempt <= cfg.repeatRetries; attempt++) {
        const messages = buildMessages(persona, req, text, situation, memory, attempt > 0 ? (contradicted ? 'claim' : 'repeat') : false, eff);
        const temperature = Math.min(1, (eff.temperature ?? cfg.temperature) + 0.15 * attempt);
        const outcome = yield* generate(req, messages, temperature, guard, eff.numPredict ?? cfg.numPredict);
        if (req.signal?.aborted) return;
        if (outcome.repeated) {
          log?.info?.({ agentId: req.agentId, attempt, contradicted }, 'ответ повторяет сказанное или противоречит ходу задания, генерация заново');
          continue;
        }
        if (!outcome.answer.trim()) throw new OllamaError('empty', 'Модель вернула пустой ответ');
        if (req.ephemeral !== true) saveTurns(req.userId, req.agentId, text, outcome.answer.trim(), situation);
        return;
      }
      if (contradicted) throw new OllamaError('repeat', 'Наставник не смог ответить точно. Попробуйте спросить иначе или повторите вопрос.');
      throw new OllamaError('repeat', 'Собеседник повторился и не придумал нового ответа. Попробуйте спросить иначе или повторите вопрос.');
    } finally {
      release();
    }
  }

  /**
   * Создаёт полностью готовый сценарий Radio без обращения к памяти NPC.
   * Science принимает только выбранный сервером факт; модель меняет лишь стиль текста.
   */
  async function generateRadioScript(req) {
    if (!Number.isInteger(req?.userId) || req.userId <= 0 || !['weather', 'science'].includes(req.category)) {
      throw new OllamaError('bad_request', 'Неверный запрос сценария Radio');
    }
    const recentTopicIds = Array.isArray(req.recentTopicIds)
      ? req.recentTopicIds.filter((id) => typeof id === 'string').slice(-20)
      : [];
    const recentTopics = Array.isArray(req.recentTopics)
      ? req.recentTopics.filter((topic) => typeof topic === 'string').map((topic) => clean(topic, 80)).filter(Boolean).slice(-20)
      : [];
    const desiredWords = Number.isInteger(req.desiredWords) ? Math.max(30, Math.min(100, req.desiredWords)) : 45;
    let fact = null;
    if (req.category === 'science') {
      const source = req.fact;
      if (
        !source ||
        typeof source.topicId !== 'string' || !/^[a-z0-9-]{1,64}$/.test(source.topicId) ||
        typeof source.title !== 'string' || source.title.length < 3 || source.title.length > 80 ||
        typeof source.text !== 'string' || source.text.trim().length < 20 || source.text.length > 700 ||
        recentTopicIds.includes(source.topicId)
      ) {
        throw new OllamaError('bad_request', 'Не выбран подходящий проверенный научный факт');
      }
      fact = { topicId: source.topicId, title: source.title.trim(), text: source.text.trim() };
    }
    if (!cfg.model) throw new OllamaError('not_configured', 'ИИ не настроен: администратору нужно задать переменную OLLAMA_MODEL');

    const system = [
      'Ты пишешь короткие сценарии для детской учебной радиостанции. Верни только JSON-объект с ровно тремя строковыми полями: category, title, text. Не добавляй Markdown или пояснения.',
      req.category === 'weather'
        ? 'Создай вымышленный прогноз погоды для вымышленного города. Не утверждай, что описываешь реальную текущую погоду или реальные текущие данные. Не используй недавние темы. Напиши дружелюбный текст для чтения вслух в 3–4 коротких предложениях.'
        : 'Используй только переданный проверенный научный факт. Не добавляй новые факты, числа или причинно-следственные утверждения. Не исправляй и не расширяй научное содержание. Напиши 3–4 коротких предложения, набирая нужную длину только простым перефразированием и повторным объяснением того же факта. Не добавляй новых сведений, формул или опасных инструкций.',
      `Категория должна быть ровно ${req.category}. Текст — примерно ${desiredWords} слов (обычно 35–60), 3–4 предложения, без заголовка внутри текста. Недавние темы, которые нельзя повторять: ${recentTopics.join('; ') || 'нет'}. Недавние идентификаторы: ${recentTopicIds.join(', ') || 'нет'}.`,
      ...(fact ? [`Единственный разрешённый исходный научный материал (не добавляй сведений): заголовок «${fact.title}». Текст факта: ${JSON.stringify(fact.text)}. Верни category="science".`] : []),
    ].join('\n\n');
    const deadline = createDeadline(req.signal, cfg.totalTimeoutMs);
    let release;
    try {
      release = await slots.acquire({ signal: deadline.signal });
      const pieces = [];
      let length = 0;
      for await (const piece of chatStream({
        baseUrl: cfg.baseUrl,
        model: cfg.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: 'Создай сценарий по заданным правилам.' }],
        format: 'json',
        options: { num_predict: cfg.numPredict, num_ctx: cfg.numCtx, temperature: 0.4 },
        keepAlive: cfg.keepAlive,
        signal: deadline.signal,
        idleTimeoutMs: cfg.idleTimeoutMs,
        totalTimeoutMs: cfg.totalTimeoutMs,
        fetchImpl,
      })) {
        length += piece.length;
        if (length > 4000) throw new OllamaError('bad_output', 'Ответ модели слишком длинный');
        pieces.push(piece);
      }
      if (deadline.timedOut) throw new OllamaError('timeout', 'Модель не ответила вовремя');
      if (req.signal?.aborted) throw abortError();
      return radioOutput(pieces.join(''), req.category, recentTopicIds, fact);
    } catch (err) {
      if (deadline.timedOut) throw new OllamaError('timeout', 'Модель не ответила вовремя');
      if (req.signal?.aborted) throw err;
      throw err;
    } finally {
      release?.();
      deadline.cleanup();
    }
  }

  /** Одна генерация: отдаёт токены после проверки начала, возвращает {answer, repeated}. */
  async function* generate(req, messages, temperature, guard, numPredict = cfg.numPredict) {
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
      options: { num_predict: numPredict, num_ctx: cfg.numCtx, temperature },
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
      if (guard.bufferAll) {
        if (held.length >= cfg.maxReplyChars) {
          held = held.slice(0, cfg.maxReplyChars);
          break;
        }
        continue;
      }
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

  const emptyMemory = () => ({ raw: null, topics: {}, turns: [], notes: [], exchanges: 0, lastSituation: null });

  // ── API для панели администратора (server/admin/routes.js) ────────────────────────────────

  /** Базовые персоны проекта (файлы personas/*.json). Повреждённый файл показывается как ошибка, а не скрывается. */
  function listPersonas() {
    const out = [];
    for (const file of readdirSync(cfg.personaDir).filter((f) => f.endsWith('.json')).sort()) {
      const id = file.slice(0, -5);
      if (!AGENT_ID_RE.test(id)) continue;
      try {
        out.push({ id, persona: loadPersonaFile(cfg.personaDir, id), error: null });
      } catch (err) {
        out.push({ id, persona: null, error: err.message });
      }
    }
    return out;
  }

  let ollamaCache = null;
  /** Состояние локальной Ollama: коротко кешируется, чтобы панель не опрашивала её каждую секунду. */
  async function ollamaStatus({ force = false } = {}) {
    const t = Date.now();
    if (!force && ollamaCache && t - ollamaCache.at < 5000) return ollamaCache.value;
    let value;
    if (!cfg.model) {
      value = { state: 'not_configured', model: '', baseUrl: cfg.baseUrl, message: 'Модель не задана (переменная OLLAMA_MODEL)' };
    } else {
      try {
        const res = await fetchImpl(`${cfg.baseUrl}/api/tags`, { signal: AbortSignal.timeout(1500) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const names = ((await res.json()).models ?? []).map((m) => m.name);
        const found = names.some((n) => n === cfg.model || n === `${cfg.model}:latest`);
        value = found
          ? { state: 'ready', model: cfg.model, baseUrl: cfg.baseUrl, message: 'Ollama доступна, модель найдена' }
          : { state: 'model_missing', model: cfg.model, baseUrl: cfg.baseUrl, message: `Ollama доступна, но модели «${cfg.model}» нет` };
      } catch (err) {
        value = { state: 'unavailable', model: cfg.model, baseUrl: cfg.baseUrl, message: 'Ollama недоступна на этом компьютере' };
      }
    }
    ollamaCache = { at: t, value };
    return value;
  }

  const view = (id) => {
    const o = overrides.get(id);
    return { settings: { ...SETTINGS_DEFAULTS, ...(o?.settings ?? {}) }, revision: o?.revision ?? 0, customized: Boolean(o), updatedAt: o?.updatedAt ?? null };
  };

  return {
    config: cfg,
    reply,
    generateRadioScript,
    probe,
    get busy() {
      return { active: slots.active, queued: slots.queued };
    },
    admin: {
      listPersonas,
      ollamaStatus,
      getSettings: view,
      /** Сохраняет настройки (уже проверенные validateSettings) и сразу применяет. */
      saveSettings(agentId, settings, now = Date.now()) {
        const revision = (overrides.get(agentId)?.revision ?? 0) + 1;
        db.saveAgentSettings(agentId, settings, revision, now);
        overrides.set(agentId, { settings, revision, updatedAt: now });
        return view(agentId);
      },
      resetSettings(agentId) {
        db.deleteAgentSettings(agentId);
        overrides.delete(agentId);
        return view(agentId);
      },
      /** Итоговая персона и промпт, собранные из текущих настроек (без вызова модели). */
      preview(agentId, settingsOverride) {
        const persona = getPersona(agentId);
        const eff = applySettings(persona, settingsOverride ?? settingsOf(agentId));
        const messages = buildMessages(persona, { context: {} }, '(реплика игрока)', null, emptyMemory(), false, eff);
        return {
          enabled: eff.enabled,
          name: eff.name,
          numPredict: eff.numPredict ?? cfg.numPredict,
          temperature: eff.temperature ?? cfg.temperature,
          systemPrompt: messages[0].content,
        };
      },
    },
  };
}



// Экземпляр, созданный registerAgents; reply() ниже — точка входа контракта shared/agent-api.md.
let current = null;

export function registerAgents(app, ctx) {
  const agents = createAgents({ db: ctx.db, config: ctx.config, log: ctx.log });
  current = agents;
  app.decorate('agents', agents);
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

/** Публичный метод генерации сценария Radio; не использует reply() или память NPC. */
export async function generateRadioScript(req) {
  if (!current) throw new OllamaError('not_configured', 'Модуль агентов не запущен');
  return current.generateRadioScript(req);
}

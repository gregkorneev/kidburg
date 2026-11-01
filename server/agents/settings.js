// Настройки поведения агентов, которые администратор может менять без перезапуска сервера.
// Приоритет при сборке промпта: 1) системные правила (personas/system.md) 2) базовая персона из JSON
// 3) эти настройки 4) контекст беседы. Настройки только уточняют поведение: они дописываются после
// персоны отдельным блоком и не заменяют системные правила, проверки прав и серверные ограничения.
// Каждое поле действительно влияет на промпт или параметры генерации (см. applySettings).

export const SETTINGS_LIMITS = Object.freeze({
  displayName: 40,
  personalityNotes: 500,
  speechStyle: 300,
  topicsMax: 8,
  topicChars: 80,
});

/** Поля, значения по умолчанию и пояснения. Используется и валидацией, и формой в админ-панели. */
export const SETTINGS_SCHEMA = Object.freeze([
  { key: 'enabled', kind: 'boolean', default: true, label: 'Агент доступен', help: 'Если выключить, NPC отвечает, что сейчас недоступен. Размещение в мире не меняется.' },
  { key: 'displayName', kind: 'text', max: SETTINGS_LIMITS.displayName, default: '', label: 'Имя в разговоре', help: 'Как персонаж представляется в разговоре. Подпись над NPC в мире не меняется. Пусто — имя из персоны.' },
  { key: 'personalityNotes', kind: 'longtext', max: SETTINGS_LIMITS.personalityNotes, default: '', label: 'Дополнение к личности', help: 'Добавляется к базовому описанию персоны, не заменяет его.' },
  { key: 'speechStyle', kind: 'longtext', max: SETTINGS_LIMITS.speechStyle, default: '', label: 'Манера речи (дополнение)', help: 'Например: «объясняй через короткие бытовые примеры».' },
  { key: 'topics', kind: 'list', max: SETTINGS_LIMITS.topicsMax, itemMax: SETTINGS_LIMITS.topicChars, default: null, label: 'Предпочитаемые темы', help: 'Пустой список: использовать темы базовой персоны.' },
  { key: 'topicMode', kind: 'enum', values: ['open', 'focused'], labels: { open: 'Свободно', focused: 'Только по темам и профессии' }, default: 'open', label: 'Разрешённые темы', help: 'В режиме «по темам» агент вежливо возвращает разговор к своим темам и профессии.' },
  { key: 'verbosity', kind: 'enum', values: ['brief', 'normal', 'detailed'], labels: { brief: 'Кратко', normal: 'Обычно', detailed: 'Подробнее' }, default: 'normal', label: 'Подробность ответов', help: 'Меняет требуемую длину ответа и лимит токенов генерации.' },
  { key: 'friendliness', kind: 'int', min: 1, max: 5, default: 3, label: 'Дружелюбие', help: '1 — сдержанный деловой тон, 5 — очень тёплый.' },
  { key: 'initiative', kind: 'int', min: 0, max: 3, default: 1, label: 'Инициативность', help: '0 — отвечает только на вопрос, 3 — сам предлагает следующий шаг.' },
  { key: 'temperature', kind: 'number', min: 0.1, max: 1, default: null, label: 'Свобода формулировок', help: 'Температура генерации. Пусто — значение по умолчанию сервера.' },
  { key: 'introduceSelf', kind: 'boolean', default: true, label: 'Представляться при первой встрече', help: 'Если выключить, агент не начинает с самопредставления.' },
  { key: 'reactToTaskProgress', kind: 'boolean', default: true, label: 'Реагировать на ход задания', help: 'Если выключить, агент не получает сведения о прогрессе игрока в задании.' },
]);

const BY_KEY = new Map(SETTINGS_SCHEMA.map((f) => [f.key, f]));

export const SETTINGS_DEFAULTS = Object.freeze(Object.fromEntries(SETTINGS_SCHEMA.map((f) => [f.key, f.default])));

/** Простейшая защита от явных попыток отменить правила игры. Эвристика, а не гарантия: главная защита — порядок блоков промпта. */
const OVERRIDE_PATTERNS = [
  /(игнорир|забуд|отмен|нарушь|обойд)\S*.{0,40}(правил|инструкц|ограничен)/i,
  /(ignore|forget|disregard|override).{0,40}(rules|instructions|system)/i,
  /(покажи|раскрой|выведи).{0,30}(системн|свои инструкц|промпт)/i,
];

const cleanLine = (value, max) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/**
 * Проверяет и нормализует настройки (частичные: отсутствующие поля берутся по умолчанию).
 * Неизвестные поля и значения вне допустимых границ — ошибка с текстом по полю.
 * @returns {{ok: true, settings: object} | {ok: false, errors: Record<string, string>}}
 */
export function validateSettings(input) {
  const errors = {};
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: { _: 'settings должен быть объектом' } };
  for (const key of Object.keys(input)) if (!BY_KEY.has(key)) errors[key] = 'Неизвестная настройка';
  const out = {};
  for (const field of SETTINGS_SCHEMA) {
    const has = Object.hasOwn(input, field.key) && input[field.key] !== undefined;
    const value = has ? input[field.key] : field.default;
    const fail = (message) => void (errors[field.key] = message);
    switch (field.kind) {
      case 'boolean':
        if (typeof value !== 'boolean') fail('Нужно значение да/нет');
        else out[field.key] = value;
        break;
      case 'text':
      case 'longtext': {
        if (typeof value !== 'string') return { ok: false, errors: { ...errors, [field.key]: 'Нужна строка' } };
        if (value.length > field.max) fail(`Не длиннее ${field.max} символов`);
        else if (OVERRIDE_PATTERNS.some((re) => re.test(value))) fail('Настройки не могут отменять правила игры или раскрывать инструкции');
        else out[field.key] = cleanLine(value, field.max);
        break;
      }
      case 'list': {
        if (value === null) {
          out[field.key] = null;
          break;
        }
        if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) fail('Нужен список строк');
        else if (value.length > field.max) fail(`Не больше ${field.max} тем`);
        else if (value.some((v) => v.length > field.itemMax)) fail(`Тема не длиннее ${field.itemMax} символов`);
        else if (value.some((v) => OVERRIDE_PATTERNS.some((re) => re.test(v)))) fail('Настройки не могут отменять правила игры');
        else {
          const topics = value.map((v) => cleanLine(v, field.itemMax)).filter(Boolean);
          out[field.key] = topics.length ? topics : null;
        }
        break;
      }
      case 'enum':
        if (!field.values.includes(value)) fail(`Допустимо: ${field.values.join(', ')}`);
        else out[field.key] = value;
        break;
      case 'int':
        if (!Number.isInteger(value) || value < field.min || value > field.max) fail(`Целое от ${field.min} до ${field.max}`);
        else out[field.key] = value;
        break;
      case 'number':
        if (value === null) out[field.key] = null;
        else if (typeof value !== 'number' || !Number.isFinite(value) || value < field.min || value > field.max) fail(`Число от ${field.min} до ${field.max}`);
        else out[field.key] = Math.round(value * 100) / 100;
        break;
      default:
        break;
    }
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, settings: out };
}

const FRIENDLY = {
  1: 'Тон сдержанный и деловой: без восклицаний и лишних комплиментов, вежливо и по делу.',
  2: 'Тон спокойный и вежливый, без излишней эмоциональности.',
  3: 'Тон дружелюбный и доброжелательный.',
  4: 'Тон тёплый и поддерживающий, можно похвалить игрока за вопрос или внимательность.',
  5: 'Тон очень тёплый, радостный и ободряющий; искренне хвали и подбадривай игрока.',
};
const INITIATIVE = {
  0: 'Отвечай только на заданный вопрос: не задавай встречных вопросов и не предлагай, что делать дальше.',
  1: 'Иногда, если это уместно, можно коротко предложить, о чём ещё можно спросить.',
  2: 'В конце ответа обычно задавай один короткий уточняющий вопрос игроку.',
  3: 'Проявляй инициативу: сам предлагай игроку следующий шаг в игре или тему для разговора.',
};
const VERBOSITY = {
  brief: { line: 'Длина ответа: одно-два коротких предложения, только самое главное.', numPredict: 110 },
  normal: { line: '', numPredict: null },
  detailed: { line: 'Длина ответа: три-четыре предложения, с одним простым примером из профессии (не больше четырёх предложений).', numPredict: 280 },
};

/**
 * Применяет настройки к базовой персоне.
 * @returns {{name: string, topics: string[]|undefined, directives: string[], enabled: boolean, numPredict: number|null,
 *   temperature: number|null, introduceSelf: boolean, reactToTaskProgress: boolean}}
 */
export function applySettings(persona, settings = SETTINGS_DEFAULTS) {
  const s = { ...SETTINGS_DEFAULTS, ...settings };
  const directives = [];
  if (s.personalityNotes) directives.push(`Дополнение к личности: ${s.personalityNotes}`);
  if (s.speechStyle) directives.push(`Дополнение к манере речи: ${s.speechStyle}`);
  if (s.friendliness !== 3) directives.push(FRIENDLY[s.friendliness]);
  if (s.initiative !== 1) directives.push(INITIATIVE[s.initiative]);
  const verbosity = VERBOSITY[s.verbosity] ?? VERBOSITY.normal;
  if (verbosity.line) directives.push(verbosity.line);
  if (s.topicMode === 'focused') {
    directives.push('Говори только о перечисленных темах и о своей профессии; на посторонние вопросы вежливо отвечай, что не знаешь, и возвращай разговор к своим темам.');
  }
  return {
    name: s.displayName || persona.name,
    topics: s.topics ?? persona.topics,
    directives,
    enabled: s.enabled,
    numPredict: verbosity.numPredict,
    temperature: s.temperature,
    introduceSelf: s.introduceSelf,
    reactToTaskProgress: s.reactToTaskProgress,
  };
}

/** Только отличия от значений по умолчанию (для журнала и компактного хранения). */
export function diffFromDefaults(settings) {
  const out = {};
  for (const [key, value] of Object.entries(settings)) {
    if (JSON.stringify(value) !== JSON.stringify(SETTINGS_DEFAULTS[key])) out[key] = value;
  }
  return out;
}

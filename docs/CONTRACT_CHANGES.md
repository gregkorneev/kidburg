# Изменения контрактов

Запросы на изменение `shared/*`, формата чанка, схемы БД и интерфейса агента.
Формат записи: дата, автор (роль), что меняем, зачем, на кого влияет, статус.

## Заметки

- **Radio MVP (дата: 2026-11-01; инициатор: Codex, роль 2; ветка `station/radio`).**
  - **Затронутый контракт:** `shared/agent-api.md` — публичный `generateRadioScript()` и асинхронный task handler через `task_answer/task_state`.
  - **Что меняется:** готовые сценарии Weather и Science, локальные fallback-сценарии, отдельный `radio_station_v1` progress; новый тип сетевого сообщения не добавляется.
  - **Зачем:** дать Radio автономную серверную генерацию без использования памяти NPC и без частичного потока клиенту.
  - **Затрагивает:** роли 2 (`server/net`, `shared`, `docs`, `tests`), 3 (`server/agents`) и 4 (`server/tasks`, `content`).
  - **Статус:** находится в незакоммиченной рабочей копии. Реализованы async task path с `AbortController` при disconnect, отдельные physical lock (`activeGenerations`) и актуальность запроса (`currentRevisions`), stale-generation guard, запрет второй генерации до завершения активного Promise, серверный Weather-дисклеймер, Science на локальных проверенных фактах, fallback и изоляция прогресса по `userId`. Смена категории инвалидирует revision, не освобождая физический lock; stale success не сохраняется, stale failure не вызывает fallback, lock освобождается в `finally`.

- **Русский стеммер (роль 3).** В S0 не установлен намеренно. Роль 3 выбирает библиотеку
  (или собственную реализацию) и согласует установку с тимлидом отдельным коммитом
  `deps: add <имя>`. В `package.json` JSON-комментариев нет, поэтому заметка здесь.
- **Мост NPC → локальная Ollama (роль 2, 2026-10-31, ветка `r2/server-integration`).** `shared/` не менялся.
  Реализован по прямому заданию Codex в `server/net/game.js` (`npc_talk`) и в `server/agents/` (`reply()`, клиент
  Ollama, файлы личности `server/agents/personas/`): роль 3 проверяет и при замене модуля сохраняет поведение
  (`reply()` из `shared/agent-api.md`; ошибки с `expose: true` показываются игроку как есть).
  Формат `agent_memory.turns`: `[{ role: 'user'|'assistant', text }]`, не более `historyMessages` (12) реплик;
  `toldCards`, `summary`, `topics` при записи сохраняются. Настройки: `OLLAMA_MODEL` (обязательна, в коде модели нет),
  `OLLAMA_URL` (только loopback), `AGENT_MAX_CONCURRENT`, `AGENT_MAX_QUEUE`, `AGENT_NUM_PREDICT`, `OLLAMA_NUM_CTX`,
  `OLLAMA_IDLE_TIMEOUT_MS`, `OLLAMA_TOTAL_TIMEOUT_MS`, `OLLAMA_KEEP_ALIVE`, `NPC_TALK_MAX_CHARS` (300), `NPC_TALK_PER_SEC` (1).
  Отказ по `npc_talk` всегда заканчивается `agent_error` с тем же `reqId`; для `too_far` и `rate_limit` дополнительно
  уходит `error` с кодом из `lead-spec.md`.
- **ИИ-диалоги Маруси: ход задания и память (роль 2, 2026-10-31, ветка `codex/station-ai-dialogue`).** `shared/` и
  схемы протокола не менялись. Дополнено только внутреннее: (1) `ReplyRequest.context.situation = {key, label, text}` —
  необязательное поле, которое `server/net/game.js` заполняет из `tasks.describeForAgent(userId, agentId)` по
  сохранённому на сервере состоянию игрока (клиент его не присылает); модуль агентов кладёт `text` в системный
  промпт, а `key`/`label` запоминает. (2) Память пары игрок-агент: сверх `turns` в `topics.dialogue` хранится
  `{notes (≤8 начал прошлых ответов по ≤110 символов), exchanges, lastSituation}`; `summary`, `toldCards` и прочие
  ключи `topics` не трогаются. (3) Задание станции получило действие `repeat` (только из `completed`, рядом с Марусей,
  начинает новую смену с `briefing`) и `describe(userId)`; `task_progress.done` при повторе снова `false`.
  Код в `server/agents/` и `server/tasks/` изменён по заданию Codex, роли 3 и 4 нужно проверить.
- **Control Center: динамический слой мира и телеметрия (2026-11-01, локальная работа, без коммита).** Затронут `shared/`:
  (1) `shared/protocol.js` — новые сообщения сервер → клиент `dyn_snapshot {cx, cz, objects[]}`, `dyn_upsert {object}`,
  `dyn_remove {id, rev}`; объект `{id, type, x, z, ry, scale, params, rev}`. Существующие сообщения не менялись, клиент без
  поддержки новых просто их игнорирует. (2) Новый файл `shared/world-objects.js` — разрешённые типы динамических объектов,
  лимиты и нормализация параметров (общий для сервера, клиента и админ-панели). Публичный HTTP-маршрут игры:
  `POST /api/telemetry` (токен игрока). Остальное — `/api/admin/*` под отдельной авторизацией, см.
  `docs/admin-control-center/architecture.md`. `cache_stats` не менялся, но размер чанка в зеркале кеша теперь включает
  динамические объекты (лимит 10% сохранён).

# Изменения контрактов

Запросы на изменение `shared/*`, формата чанка, схемы БД и интерфейса агента.
Формат записи: дата, автор (роль), что меняем, зачем, на кого влияет, статус.

## Заметки

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

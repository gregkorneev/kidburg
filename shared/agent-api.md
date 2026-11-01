# Интерфейс мозга агента и задач (v1)

Контракт между сервером (роль 2), модулем агентов (роль 3) и задачами (роль 4).
После S0 источник правды — этот файл. Изменения только через `docs/CONTRACT_CHANGES.md`.

## `server/agents/index.js` (роль 3)

```js
/**
 * @typedef {Object} ReplyRequest
 * @property {number} userId
 * @property {string} agentId
 * @property {string} text                          реплика игрока
 * @property {{district?:string, playerName?:string, nearbyPlayers?:number}} [context]
 * @property {(position:number)=>void} [onQueue]    вызывается, если запрос ждёт в очереди
 * @property {AbortSignal} [signal]
 */

/** Возвращает асинхронный итератор токенов ответа (строки). */
export async function* reply(req) {}

/**
 * @typedef {Object} RadioScriptRequest
 * @property {number} userId
 * @property {'weather'|'science'} category
 * @property {string[]} [recentTopicIds]
 * @property {string[]} [recentTopics]
 * @property {number} [desiredWords]
 * @property {{topicId:string, title:string, text:string}} [fact] обязательный для science, выбран сервером из локального каталога
 * @property {AbortSignal} [signal]
 */

/** @typedef {{category:'weather'|'science', topicId:string, title:string, text:string, source:'ollama'}} RadioScript */
/** @typedef {{category:'weather'|'science', topicId:string, title:string, text:string, source:'ollama'|'offline_fallback'}} RadioTaskScript */

/**
 * Возвращает полностью собранный и структурно проверенный ответ модели с source:'ollama', не поток токенов и не память NPC.
 * Для weather поле text — только содержимое вымышленного прогноза: Radio task handler обязан добавить
 * фиксированный серверный дисклеймер до сохранения и отправки клиенту. Локальный offline_fallback
 * также формируется task handler при ошибке этого метода.
 */
export async function generateRadioScript(req) {}

/** Регистрация маршрутов и инициализация модуля. ctx: { db, config, log } */
export function registerAgents(app, ctx) {}
```

Сервер превращает токены итератора в `agent_token`, завершение — в `agent_done`, исключение — в `agent_error`. Позицию в очереди модуль агентов шлёт сам через `onQueue` (сервер превращает её в `agent_queue`).

Память агента читается и сохраняется через `ctx.db`:
`getAgentMemory(userId, agentId)` и `saveAgentMemory(userId, agentId, data)` (модуль `server/db`, появляется в S1).

До готовности модуля роли 3 работает заглушка: `reply()` возвращает эхо по словам.

## `server/tasks/index.js` (роль 4)

```js
/**
 * @returns {object|Promise<object>}
 * Task handlers may be synchronous or asynchronous. The network layer awaits either form and sends
 * the final result as task_state. Long running handlers receive server context with an AbortSignal.
 */
export function handle(userId, taskId, payload, context) {}

/** ctx: { db, config, log } */
export function registerTasks(app, ctx) {}
```

Результат сервер отправляет клиенту как `task_state` и сохраняет в `task_progress`. Radio использует отдельный
`radio_station_v1` task progress; его генерация возвращает один готовый сценарий после завершения Ollama.

## `ctx`

| Поле | Содержимое |
|---|---|
| `db` | функции доступа из `server/db/index.js` (не сырое соединение) |
| `config` | настройки сервера (порт, пути) |
| `log` | логгер Fastify (`app.log`) |

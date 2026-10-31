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

/** Регистрация маршрутов и инициализация модуля. ctx: { db, config, log } */
export function registerAgents(app, ctx) {}
```

Сервер превращает токены итератора в `agent_token`, завершение — в `agent_done`, исключение — в `agent_error`. Позицию в очереди модуль агентов шлёт сам через `onQueue` (сервер превращает её в `agent_queue`).

Память агента читается и сохраняется через `ctx.db`:
`getAgentMemory(userId, agentId)` и `saveAgentMemory(userId, agentId, data)` (модуль `server/db`, появляется в S1).

До готовности модуля роли 3 работает заглушка: `reply()` возвращает эхо по словам.

## `server/tasks/index.js` (роль 4)

```js
/** @returns {Promise<{state:object, done:boolean, feedback?:string}>} */
export async function handle(userId, taskId, payload) {}

/** ctx: { db, config, log } */
export function registerTasks(app, ctx) {}
```

Результат сервер отправляет клиенту как `task_state` и сохраняет в `task_progress`.

## `ctx`

| Поле | Содержимое |
|---|---|
| `db` | функции доступа из `server/db/index.js` (не сырое соединение) |
| `config` | настройки сервера (порт, пути) |
| `log` | логгер Fastify (`app.log`) |

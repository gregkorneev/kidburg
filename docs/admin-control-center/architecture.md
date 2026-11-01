# Control Center: архитектура и контракты API

Панель администратора встроена в основной сервер (`npm start`), отдельного порта и процесса нет.
Страница: `/admin/` (Preact, `client/admin/`). API: `/api/admin/*`. Поток: SSE `/api/admin/stream`.

## Состав

| Часть | Файлы |
|---|---|
| Авторизация, CSRF, сессии | `server/admin/auth.js` |
| HTTP-маршруты, SSE, откат | `server/admin/routes.js` |
| Журнал действий | `server/admin/audit.js`, таблица `admin_audit_log` |
| Телеметрия клиентов | `server/telemetry/index.js`, `server/telemetry/routes.js` |
| Динамические объекты мира | `server/world/dynamic-objects.js`, `server/world/placement.js`, таблицы `world_objects`, `world_meta` |
| Типы объектов (общий контракт) | `shared/world-objects.js` |
| Настройки агентов | `server/agents/settings.js`, таблица `agent_settings`, API `app.agents.admin` |
| Протокол игры | `shared/protocol.js`: `dyn_snapshot`, `dyn_upsert`, `dyn_remove` |
| Клиент игры | `client/engine/telemetry.js`, `client/engine/dynamic-objects.js`, `client/engine/dynamic-types.js` |
| Интерфейс панели | `client/admin/` |

## Общие правила API

* Формат ошибок: `{ "error": "<код>", "message": "<текст для человека>" }` (+ `fields` для `invalid_settings`).
* Все ответы `Cache-Control: no-store`.
* Без `ADMIN_PASSWORD` (≥ 8 символов) все маршруты, кроме страницы, отвечают `503 admin_disabled`.
* С чужого компьютера: `403 admin_remote_disabled` (если не задано `ADMIN_ALLOW_REMOTE=1`).
* Сессия — cookie `carrierium_admin` (HttpOnly, SameSite=Strict). Нет сессии: `401 unauth`.
* Изменяющие запросы (`POST/PUT/PATCH/DELETE`): заголовок `X-CSRF-Token` (значение из `login` или `status`) и `Origin` этого же хоста,
  иначе `403 bad_csrf` / `403 bad_origin`. Лимит — 40 изменяющих запросов за 10 секунд на сессию (`429 rate_limit`).
* Тело JSON, `Content-Type: application/json`.

## Авторизация

| Метод и путь | Тело | Ответ |
|---|---|---|
| `GET /api/admin/status` | — | `{ enabled, authenticated, csrf\|null, remoteAllowed }` (публичный, без сессии) |
| `POST /api/admin/login` | `{ password }` | `{ authenticated: true, csrf }` + `Set-Cookie`; `401 bad_credentials`; `429 too_many` после 5 ошибок за 5 минут |
| `POST /api/admin/logout` | — | `{ authenticated: false }`, cookie сбрасывается |

## Обзор и клиенты

`GET /api/admin/overview`:

```json
{ "serverTime": 0, "startedAt": 0, "uptimeSec": 0, "playersWs": 0,
  "summary": { "sessionsOnline": 0, "sessionsInactive": 0, "sessionsOffline": 0, "playersOnline": 0,
               "fpsAvg": null, "fpsMin": null, "pingAvg": null, "pingMax": null,
               "chunksLoaded": 0, "chunksReporting": 0, "thresholds": { "lowFps": 30, "highPingMs": 150 } },
  "world": { "count": 0, "limit": 150, "revision": 0, "bytes": 0 },
  "agents": { "configured": 3, "placed": 1, "active": 1, "generating": 0, "queued": 0 },
  "ollama": { "state": "ready|unavailable|model_missing|not_configured", "model": "", "baseUrl": "", "message": "" },
  "telemetry": { "intervalMs": 3000, "sessions": 0 } }
```

`null` в метриках означает «нет данных» (никогда не подменяется нулём).

`GET /api/admin/clients` → `{ clients: Client[], summary, thresholds, intervalMs }` (с историей).

`Client`:

```json
{ "sid": "…", "userId": 1, "name": "Аня",
  "status": "online|inactive|offline", "state": "active|hidden|paused",
  "loc": "city|firefighter|florist|bakery|other", "quality": "low|medium|high|null",
  "fps": 60, "fpsAvg": 58.2, "frameMs": 16.7, "ping": 4, "pingAvg": 5.1, "pingKind": "http", "pingAt": 0,
  "wsConnected": true, "wsRttMs": 3,
  "render": { "calls": 0, "triangles": 0, "geometries": 0, "textures": 0 } ,
  "chunks": { "loaded": 9, "max": 14 }, "chunksSource": "server|client|null",
  "firstSeen": 0, "lastSeen": 0, "reports": 0,
  "history": [ { "t": 0, "fps": 60, "ping": 4 } ] }
```

* `status`: `online` — вкладка активна и присылает данные; `inactive` — вкладка скрыта/приостановлена (FPS = `null`);
  `offline` — данные не приходят (> 3 интервалов) или вкладка закрылась. Отключённые удаляются из списка через 2 минуты.
* `ping` — HTTP-время ответа `GET /health` (как в HUD игры), `wsRttMs` — ping/pong WebSocket на стороне сервера (раз в ~10 с).
* `history` приходит в `snapshot` потока и в `GET /clients`; в `tick` его нет — клиент добавляет точку `{ t: lastSeen, fps, ping }` сам.

### Поток `GET /api/admin/stream` (SSE)

Одно соединение на вкладку панели (не более 8 на сервер). События (`event:` + JSON в `data:`):

| Событие | Когда | Данные |
|---|---|---|
| `snapshot` | сразу после подключения | `overview` + `clients` (с историей) + `intervalMs` |
| `tick` | раз в секунду, пока есть подписчики | `overview` + `clients` (без истории) |
| `world` | любое изменение динамических объектов | `{ revision, count, ops: [{ op: "upsert", object, prev } \| { op: "remove", id, rev, cx, cz }] }` |
| `agents` | сохранение/сброс настроек агента | `{ id }` |
| `audit` | новая запись журнала | запись журнала |

`EventSource` переподключается сам (`retry: 3000`); после переподключения приходит новый `snapshot`.

## Мир

`GET /api/admin/world`:

```json
{ "revision": 12, "count": 3, "limits": { "total": 150, "perChunk": 30 },
  "types": [ { "id": "tree", "label": "Дерево", "radius": 0.8, "scale": [0.7, 1.6], "collider": [1,6,1],
               "params": [ { "key": "variant", "kind": "enum", "values": ["round","pine","birch"], "labels": {}, "default": "round", "label": "Вид" } ] } ],
  "objects": [ { "id": "o_ab12cd34ef", "type": "bench", "x": 441.5, "z": 430, "ry": 1.57, "scale": 1, "params": {}, "rev": 5, "createdAt": 0, "updatedAt": 0 } ],
  "zones": { "buildings": [ { "id", "label", "x", "z", "w", "d", "ry" } ], "circles": [ { "id", "label", "x", "z", "r" } ],
             "routes": [ { "id", "label", "ax", "az", "bx", "bz", "half" } ], "paths": [ { "id", "label", "x", "z", "w", "d", "ry" } ],
             "statics": [ { "x", "z", "r" } ], "margin": 4, "worldSize": { "x": 768, "z": 768 } },
  "cache": { "dynamicBytes": 0 } }
```

Координаты — мировые метры (`x` на восток, `z` на юг, 0..768). `ry` — поворот вокруг вертикали в радианах (0..2π), `scale` в пределах типа.
Параметры типов (`params`): `enum` (значение из `values`), `int` (`min`..`max`), `text` (до `max` символов).

| Метод и путь | Тело | Ответ |
|---|---|---|
| `POST /world/validate` | `{ type, x, z, ry?, scale?, params?, id? }` (`id` — двигаемый объект) | `{ ok: true }` или `{ ok: false, code, message }` (для предпросмотра на карте) |
| `POST /world/objects` | `{ type, x, z, ry?, scale?, params? }` | `201 { object, revision }` |
| `PATCH /world/objects/:id` | любые из `x, z, ry, scale, params` и `rev` (ожидаемая версия) | `{ object, revision }`; `409 conflict` при устаревшем `rev` |
| `DELETE /world/objects/:id?rev=N` | — | `{ removed, revision }` |
| `POST /world/clear` | `{ confirm: true }` | `{ removed, revision }` (откатывается через `undo`) |
| `POST /world/undo` | — | `{ undone: { id, action, entityId }, revision }`; `404 nothing_to_undo`; `409 conflict` |

Коды отказов размещения (`422`): `forbidden_zone`, `out_of_bounds`, `overlap`; `400`: `bad_type`, `bad_position`, `bad_rotation`, `bad_scale`, `bad_params`;
`409`: `limit_total`, `limit_chunk`, `cache_budget`, `conflict`, `exists`; `404 not_found`.

## Агенты

`GET /api/admin/agents` → `{ agents: Agent[], summary: { configured, placed, active, generating, queued }, schema: Field[], defaults, ollama }`.

`Agent`: `{ id, error, name, role, about, style, topics, placement: { status: "placed|not_placed", city: bool, station: string|null }, settings, revision, customized, updatedAt }`
(`placement` — реально ли персонаж размещён: в чанках города или в станции с заданием).

`Field` (схема формы): `{ key, kind: "boolean|text|longtext|list|enum|int|number", label, help, default, max?, min?, values?, labels?, itemMax? }`.

| Метод и путь | Тело | Ответ |
|---|---|---|
| `PUT /agents/:id` | `{ settings, revision? }` | `{ agent }`; `422 invalid_settings` с `fields: { ключ: сообщение }`; `409 conflict` |
| `DELETE /agents/:id/settings` | — | `{ agent }` (значения по умолчанию) |
| `POST /agents/:id/preview` | `{ settings? }` (черновик) | `{ preview: { enabled, name, numPredict, temperature, systemPrompt } }` — без вызова модели |
| `POST /agents/:id/test` | `{ text, settings? }` | `{ ok: true, text, durationMs, usedDraft }` или `{ ok: false, error: { code, message }, … }` (например `unavailable` — Ollama недоступна) |

Тест вызывает настоящую модель с памятью-«пустышкой»: реплика администратора не читает и не пишет память игроков.

## Журнал

`GET /api/admin/audit?limit=50&before=<id>` → `{ entries: Entry[], nextBefore: number|null }`.

`Entry`: `{ id, ts, sessionId, action, entityType, entityId, before, after, result: "ok|rejected|error", detail, undone }`.
Действия: `admin.login`, `admin.logout`, `world.create|update|delete|clear|undo`, `agent.update|reset|test`.

## Телеметрия игроков (не админский маршрут)

`POST /api/telemetry` с `Authorization: Bearer <токен игрока>`, тело ≤ 2 КБ:

```json
{ "sid": "<8–64 символа [A-Za-z0-9_-], случайный на загрузку страницы>", "loc": "city", "state": "active|hidden|paused",
  "quality": "medium", "fps": 59.8, "frameMs": 16.9, "ping": 4.2,
  "render": { "calls": 120, "triangles": 90000, "geometries": 80, "textures": 10 }, "chunks": { "loaded": 9, "max": 14 } }
```

`{ "sid": "…", "bye": true }` — вкладка закрылась. Ответ: `{ ok: true, intervalMs }` (сервер задаёт интервал отправки; по умолчанию 3000 мс, `TELEMETRY_INTERVAL_MS`).
Ограничения: не чаще раза в 400 мс на сессию, не более 8 вкладок на игрока, 200 сессий в памяти.

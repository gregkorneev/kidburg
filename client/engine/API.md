# API клиента для интерфейса (роль 4)

Движок (роль 1) вызывает `mountUI(api)` из `client/ui/index.js` один раз при старте страницы,
до `client.start()`. Экранные формы (вход, диалог, задача, чат) рисует роль 4; движок их не создаёт.

```js
export function mountUI(api) { /* ... */ }
```

## Сессия и вход

Сессия хранится только в `sessionStorage` окна (ключи `city.token`, `city.user`), в `localStorage` — никогда.
При старте движок сам проверяет сохранённую сессию (`GET /api/me`) и подключается.
Результат приходит событием `auth`: `{user}` — вход выполнен, `null` — нужен экран входа.

| Метод | Что делает |
|---|---|
| `await api.auth.join(name, room)` | `POST /api/join`: имя и код комнаты (четыре латинские буквы, показан в терминале сервера). Сохраняет сессию, подключает сокет. Возвращает `user` |
| `await api.auth.localRoom()` | Код комнаты, если страница открыта на компьютере сервера (`GET /api/local-room`), иначе `null`. Нигде не сохраняется; экран входа подставляет его в поле, пока игрок сам не правил поле |
| `api.auth.logout()` | Закрывает сокет, стирает сессию, событие `auth` с `null` |
| `api.auth.session()` | `{user}` или `null` — текущая сессия окна |

Ошибки — `ApiError` с полями `status` и `code`: `bad_name` (400), `bad_room` (400 — не четыре буквы, 403 — неверный код),
`name_taken` (409, имя занято играющим), `too_many` (429), `unauth` (401), `network` (status 0, сервер недоступен), `message` — текст на русском.
Пароля нет: имя на сервере принадлежит тому, кто вошёл с верным кодом. После перезапуска сервера код новый, старые токены не действуют (событие `auth` с `null`).

## Сеть

```js
api.net.send(msg)          // сообщение протокола C2S (shared/protocol.js); true, если ушло
api.net.on(type, handler)  // то же, что api.on; возвращает функцию отписки
api.net.off(type, handler)
api.net.status             // 'closed' | 'connecting' | 'open' | 'reconnecting' | 'denied'
api.net.connect()          // подключиться с текущей сессией (обычно не нужно)
api.net.disconnect()
```

`net.send` возвращает `false`, если сообщение не проходит `validate()` или сокет не открыт.
`hello` и `pos` отправляет движок, UI их не шлёт. `chat`, `npc_talk`, `task_answer` — через `api.net.send`.

Порядок подключения: `/api/ws-ticket` → WebSocket `/ws?ticket=…` по `location.host` → `hello {ticket, proto}`.
При обрыве движок переподключается сам (1 с, 2 с, 4 с, не дольше 5 с) и каждый раз берёт новый тикет.
Переподключения нет, если тот же пользователь вошёл в другом окне (событие `replaced`) или сессия недействительна (`denied`).
После каждого `welcome` сервер начинает зеркало кеша и список игроков заново, поэтому движок очищает мир.

## События (`api.on(type, handler)`, `api.off(type, handler)`)

Любое сообщение сервера приходит событием с тем же `t`, обработчик получает сообщение целиком:
`welcome`, `chat`, `agent_queue`, `agent_token`, `agent_done`, `agent_error`, `task_state`, `cache_stats`,
`error`, а также `player_join`, `player_leave`, `players`, `correct`, `chunk_load`, `chunk_unload`.

Локальные события движка:

| Событие | Данные |
|---|---|
| `npc_near` | `{agentId, name}` у ближайшего NPC в пределах `TALK_DISTANCE`, `null` — когда игрок отошёл |
| `auth` | `{user}` или `null` |
| `status` | `{status}` — статус соединения (см. `api.net.status`) |
| `replaced` | `{code}` — соединение вытеснено другим окном этого пользователя |
| `interact` | то же, что `api.state.npc`: игрок нажал `E` (вне полей ввода и пока UI не просил освободить мышь) |
| `chat_key` | `null` — игрок нажал `Enter` |

`name` у NPC берётся из `npc.name`, а если его нет — из `agentId`.

## Состояние (только чтение)

```js
api.state.me     // {id, name} после welcome, иначе null
api.state.cache  // последний cache_stats {loaded, max, worldTotal, bytes, bytesMax} или null
api.state.npc    // {agentId, name} ближайшего NPC или null
api.state.ping   // время ответа сервера, мс (измеряется запросом GET /health)
```

## Мышь

```js
api.ui.unlockPointer() // открыли панель: снять pointer lock и отключить управление (WASD, E, Enter)
api.ui.lockPointer()   // закрыли панель: вернуть управление и попробовать снова захватить мышь
```

`lockPointer()` браузер разрешает только после действия пользователя (клик, клавиша). Если захват не удался,
игрок вернёт его кликом по сцене. `Esc` браузер обрабатывает сам и снимает захват.

## Отладка

Страница с `?debug=1` кладёт `api` в `window.__city` (убирается при остановке клиента).

## Ограничения

- Модели CC0 в `assets/` пока нет: объекты, NPC и аватары — простые placeholder-фигуры (`prefabs.js`).
  Размеры коллайдеров и id префабов взяты из `tools/fixtures`, так как `world.json` клиенту не раздаётся.
- Пинг измеряется HTTP-запросом `GET /health`: в протоколе WebSocket сообщения ping нет.

Локальные preview-страницы могут вызвать `createClient({ container, networkOnly: true })`, чтобы использовать тот же вход и WebSocket без второго игрового рендерера. В этом режиме preview самостоятельно отправляет `pos` через `api.net.send()`.

## Пожарный preview в сети

Страница `/firefighter-preview.html` (`client/stations/firefighter/`) использует тот же вход (`mountUI`) и `createClient({ networkOnly: true })`.
Локальные координаты preview переводятся в мировые сдвигом `ORIGIN` из `network.js`: точка появления нового игрока `SPAWN` попадает в стартовую точку полигона.
Угол `ry` в `pos` — yaw основного клиента (0 смотрит вдоль −Z), поэтому игроки видят друг друга одинаково на обеих страницах.
Задания пожарной станции идут через `task_answer`/`task_state`: клиент отправляет только `payload.action`, прогресс хранит сервер (`tasks.js`, `layout.js`).

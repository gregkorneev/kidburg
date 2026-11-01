# Архитектура

```
страница станции ── createClient({networkOnly:true}) ── WebSocket ── server/net/game.js
   │                                                       │
   ├ station-link.js   station_enter / station_pos         ├ сессия станции (player.station)
   ├ station-progress  task_answer ⇄ task_state            ├ tasks/station_tasks.js (SQLite task_progress)
   └ npc-chat (общая панель)  npc_talk ⇄ agent_*           └ agents.reply() → общая Ollama (очередь 2+8)
```

## Поток разговора

1. Страница после `welcome` отправляет `station_enter {stationId}`. Сервер проверяет, что его **собственная** последняя мировая позиция игрока лежит у двери станции (радиус входа + `ENTRANCE_SLACK`), создаёт сессию и отвечает `station_state {ok}`.
2. Локальную позицию страница шлёт как `station_pos {x,z}` (раз в 100 мс при движении, раз в секунду как heartbeat). Сервер зажимает её границами станции и проверяет скорость.
3. E у наставника открывает общую панель, только если `link.ready` (сессия подтверждена). Иначе остаётся прежнее поведение E.
4. `npc_talk` обрабатывается так же, как у Маруси, но внутри станции NPC берётся из реестра, расстояние — по `station_pos`, а ситуация (`context.situation`) строится сервером из SQLite.
5. Ответ идёт токенами (`agent_token`), память хранится в `agent_memory` по паре (игрок, агент).

## Что остаётся серверным

Станция, позиция, расстояние до NPC и до рабочих объектов, этап и результат шага. Модель получает только подтверждённые факты и **никогда не решает**, засчитан ли шаг.

## Что остаётся клиентским

Рисование сцены, ввод, локальное зеркало прогресса (для работы без сервера), панель разговора. Расхождение зеркала и сервера разрешает `station-progress.js` в пользу сервера.

## Изменения по файлам

- Новые: `shared/station-npcs.js`, `server/tasks/station_tasks.js`, `server/agents/personas/{baker,lilia,maestro}.json`, `client/engine/station-{link,link-browser,progress,chat-flow}.js`, `client/stations/{bakery,florist,pianist}/chat-flow.js`.
- Изменены: `shared/protocol.js` (4 сообщения), `server/net/game.js`, `server/tasks/index.js`, `server/agents/index.js` (персона с `gender:'m'`), `server/admin/routes.js`, `client/admin/*`, `scene.js` и `preview.js` трёх станций, `florist/targets.js`.

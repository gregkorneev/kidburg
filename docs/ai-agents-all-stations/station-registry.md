# Реестр станций (`shared/station-npcs.js`)

Единственный источник правды для сервера, клиента и Control Center.

## Станции с локальными координатами

| id | Страница | Вход (из `client/engine/city-entrance.js`) | Границы пола | Спавн | Задание |
|---|---|---|---|---|---|
| `bakery` | `/bakery-preview.html` | `BAKERY_ENTRANCE` | x ±8.5, z ±6.5 | (0; 4.25) | `bakery_station_v1` |
| `florist` | `/florist-preview.html` | `FLORIST_ENTRANCE` | 0..20 × 0..15 | (6; 4) | `florist_station_v1` |
| `pianist` | `/musician-preview.html` | `MUSIC_SCHOOL_ENTRANCE` | 0..20 × 0..15 | (10; 4.2) | `pianist_station_v1` |

## NPC

| agentId | Станция | Точка | Радиус E (клиент) | Сервер принимает до |
|---|---|---|---|---|
| `baker` | bakery | (−6; 4.15) | 2.6 | 2.6 + `TALK_SLACK` (1.5) |
| `lilia` | florist | (10; 3.45) — точка у стойки | 1.8 | 1.8 + 1.5 |
| `maestro` | pianist | (6.2; 3.2) | 1.9 | 1.9 + 1.5 |

`ENTRANCE_SLACK = 4`: сохранённая позиция и пакеты `pos` запаздывают.

## Вне реестра диалогов

- **Маруся** лежит в `world.npcs` (пожарная часть стоит в городе) и работает по прежнему пути с `TALK_DISTANCE`.
- **ИИ-редактор радио** — запись в `AI_SERVICES` (`kind: 'script_editor'`), не NPC. Файла `radio_host.json` нет.

## Протокол

| Сообщение | Направление | Поля |
|---|---|---|
| `station_enter` | клиент → сервер | `stationId` |
| `station_pos` | клиент → сервер | `x`, `z` |
| `station_leave` | клиент → сервер | — |
| `station_state` | сервер → клиент | `stationId` (строка или `null`), `ok`, `message` |

Любая мировая позиция (`pos`) сбрасывает сессию станции. `npc_talk` станционного NPC без сессии получает `agent_error` «ждёт вас в своей станции».

# ИИ-наставники во всех станциях

Статус: ветка `local/ai-agents-all-stations` (`e3fcccc`, исходная база `e0be8b8`) объединена с `main` на базе `2b053f7`. История исходной ветки сохранена. Звук на слух и длительная нагрузка остаются непроверенными.

В каждой существующей станции-профессии теперь есть собеседник на общей локальной Ollama. Прохождение игры от ИИ не зависит.

| Станция | NPC / ИИ-сервис | Доступен в игре | Ollama или fallback | Контекст задания | Тест |
|---|---|---|---|---|---|
| Пекарня | Мастер-пекарь (`baker`) | да, клавиша E у пекаря | Ollama; без неё честная ошибка в панели, игра идёт | `bakery_station_v1`, подтверждён сервером | `tests/station-talk.test.js`, `tests/station-tasks.test.js`, `client/stations/bakery/talk.test.js` |
| Цветочная лавка | Лилия (`lilia`) | да, E у Лилии на любом этапе | то же | `florist_station_v1` | те же |
| Музыкальная школа | Маэстро Артём (`maestro`) | да, E у Маэстро (в режиме пианино чат не открывается) | то же | `pianist_station_v1` | те же |
| Пожарная часть | Маруся (`marusya`) | да, в городе, без изменений | то же | `firefighter_station_v1` (прежний) | `tests/firefighter.test.js`, `server/tasks/firefighter_station_v1.test.js` |
| Радиостанция | ИИ-редактор `radio_editor` (не собеседник) | да, отдельный сервис | Ollama или локальный сценарий | `radio_station_v1` | `tests/radio.test.js` |
| Больница, ферма | — | **станций нет**, не реализованы | — | — | — |

`nurse` и `therapist` остаются в Control Center как «не размещён в мире».

## Что проверено

- Проверка объединённого кода 2026-11-01: `env -u ADMIN_PASSWORD npm run verify` — 787/787 и `/health ok`, сборка и `check:offline` успешны. Детали и ограничения — в [testing.md](testing.md).
- Живая Ollama (`qwen3.5:2b`): три наставника ответили; Лилия встала в очередь за двумя слотами; уточняющий вопрос пекаря учёл серверный этап. Скрипт — в черновиках сессии, в репозиторий не входит.
- Частичный браузерный проход, выполненный до последнего изменения защиты: два игрока, станции, кнопки действий, перезагрузка, Esc и L, режим без Ollama и Control Center. Позднее браузер стал доступен: упражнение, репетиция и концерт сыграны обычными клавишами, проверены reload и итоговый разговор. После слияния отдельный браузерный проход не выполнялся. После изменения защиты ответ наставника буферизуется и показывается после проверки целиком, без прежнего пословного потока.
- Радио и Маруся проверены регрессионно (см. [radio-regression.md](radio-regression.md)). В бою Радио не менялось.

## Документы

[audit.md](audit.md) · [architecture.md](architecture.md) · [station-registry.md](station-registry.md) · [personas.md](personas.md) · [station-progress.md](station-progress.md) · [radio-regression.md](radio-regression.md) · [control-center.md](control-center.md) · [testing.md](testing.md) · [offline.md](offline.md) · [handoff.md](handoff.md)

Изменения контракта: запись «ИИ-наставники станций» в [../CONTRACT_CHANGES.md](../CONTRACT_CHANGES.md).

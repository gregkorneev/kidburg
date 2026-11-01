# Интерактивный мир 1.0

Живые объекты города и учебной пожарной части: двери с анимацией, шкафы и ящики, футбольные мячи с серверной физикой и переносимые предметы. Всё работает офлайн, без новых зависимостей, поверх существующих механизмов (`mech_*`, чанки, SQLite, Control Center).

| Возможность | Где живёт | Документ |
|---|---|---|
| Двери зданий (6 шт.) | `shared/doors.js`, `client/engine/mechanisms/door.js` | [doors.md](doors.md) |
| Шкафы и тумба с ящиками в пожарной части | `client/engine/mechanisms/furniture.js`, `client/stations/firefighter/` | [fire-station.md](fire-station.md) |
| Футбольные мячи (3 шт.) | `server/world/ball-physics.js`, `client/engine/interactions/physics-renderer.js` | [football.md](football.md) |
| Переносимые предметы (11 шт.) | `server/world/interactive-state.js`, `client/engine/interactions/carry-system.js` | [carry-system.md](carry-system.md) |
| Сетевой протокол | `shared/protocol.js`, `shared/interaction-contracts.js` | [network.md](network.md) |
| Единая клавиша E | `client/engine/interactions/interaction-manager.js` | [architecture.md](architecture.md) |

Документы: [architecture.md](architecture.md), [testing.md](testing.md), [handoff.md](handoff.md).

## Быстрый старт

```bash
ADMIN_PASSWORD=... npm start      # сервер; для проверок — DB_PATH=<временная база>
npm test && npm run build && npm run verify && npm run check:offline
```

Для ручных проверок не используйте настоящую `data/city.db`: запускайте сервер с `DB_PATH` во временной папке.

## Управление

E — единственная клавиша действия: войти/открыть дверь, пнуть мяч, взять / поставить предмет, открыть шкаф или ящик, поговорить. Подсказка у нижней кромки экрана показывает выбранное действие.

# Журнал графического overhaul

- **Задача:** переработка графики Kidburg («Premium Stylized Low-Poly»), полностью локально.
- **Цель:** единый стиль для пожарной части и города: свет, материалы, персонажи, UI, качество.
- **Контекст:** изменения разработаны в `codex/firefighter-equipment-sync` и слиты в `main` merge-коммитом `2e4d390` с сохранением исходной истории. Незакоммиченные файлы-копии с суффиксом `2` не включались.
- **Реализация:** слой `client/engine/art/` (palette, quality, materials, lighting, labels, character); пересобраны `client/stations/firefighter/{scene,scenery,station-art,yard-plan}.js`; обновлены `ui.js`, `style.css`, `preview.js`, `network.js` (4-й аргумент `addRemotePlayer`); город: `app.js`, `remote.js`, `chunks.js`.
- **Решения:** внешность строится детерминированно из id; событие `player_appearance` передаёт подтверждённое состояние экипировки; тени в городе выключены; текстуры процедурные и локальные; отладочные хуки доступны только по `?debug=1`.
- **Изменённые компоненты:** `client/engine/*`, `client/stations/firefighter/*`, `server/net/game.js`, `shared/protocol.js`, `tests/*`, `docs/graphics-overhaul/*`. Схема БД не менялась.
- **Проверки:** после merge `npm run verify` — 335/335 и `/health` ok. Скриншоты до/после находятся в `docs/graphics-overhaul/screenshots/`. Сборка и автоматическая проверка внешних URL в ходе merge не запускались.
- **Проблемы:** `check:offline` объявлен в `package.json`, но скрипт отсутствует; Маруси нет в чанках города; производительность на слабом школьном ноутбуке не проверена.
- **Результат:** ветка слита в `main` и отправлена в `origin/main`.
- **Коммиты:** `c645a9f`, `b2ae93e`, `d98e667`, `18dc188`, `133a662`, `09f9fca`; merge-коммит `2e4d390`.
- **Следующие действия:** визуально принять стиль и проверить производительность на слабом ноутбуке; при необходимости оптимизировать число draw calls и треугольников.

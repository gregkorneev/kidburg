# Формат чанка и индекс мира (v1)

Источник правды для ролей 1 (`tools/build-world`) и 2 (`tools/fixtures`, сервер).
Файлы лежат в `generated/` и не коммитятся.

## Чанк: `generated/chunks/{cx}_{cz}.bin`

Один объект MessagePack:

```
{ v: 1, cx, cz, zone: 'hospital' | 'park' | 'plain',
  heights: Float32Array(17*17),             // карта высот, 16×16 ячеек по 4 м
  instances: [[prefabId, x, y, z, ry, scale], ...],
  npcs: [{ id, agentId, x, y, z, ry }] }
```

- Чанк `(cx, cz)` покрывает `x ∈ [cx·64, (cx+1)·64)`, `z ∈ [cz·64, (cz+1)·64)`.
- `heights` хранится построчно: индекс `iz * 17 + ix`, узлы сетки через 4 м от угла чанка.
- Координаты `x, y, z` инстансов и NPC мировые (в метрах), не локальные.
- Система координат: правая, Y вверх, `ry` в радианах.

## Индекс: `generated/world.json`

```
{ v: 1, chunkSize, chunksX, chunksZ, totalBytes,
  bytes: { "cx_cz": n },
  prefabs: [{ id, name, model, collider }],
  districts: [{ id, name, chunks: [[cx, cz], ...] }],
  npcs: [...] }
```

- `totalBytes` — сумма размеров всех файлов чанков. От него считается лимит кеша клиента: `0.1 · totalBytes`.
- `bytes` — размер каждого чанка, нужен серверу, чтобы вести зеркало кеша без чтения файлов.
- `collider` в префабе: описание коллайдера для AABB-коллизий клиента (формат уточняют роли 1 и 4).

## Правила передачи

Чанки идут по WebSocket сообщением `chunk_load {cx, cz, data}`, где `data` — байты файла как есть. Клиент не кеширует их в HTTP-кеше, IndexedDB или Service Worker.

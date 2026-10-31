// Общие геометрии и материалы со счётчиком ссылок: освобождаются, когда их отпустил последний чанк.

export function createPool() {
  /** @type {Map<string, {value: {dispose: Function}, count: number}>} */
  const items = new Map();

  return {
    /** Возвращает общий ресурс по ключу, создавая его через factory при первом обращении. */
    acquire(key, factory) {
      let item = items.get(key);
      if (!item) {
        item = { value: factory(), count: 0 };
        items.set(key, item);
      }
      item.count += 1;
      return item.value;
    },
    release(key) {
      const item = items.get(key);
      if (!item) return;
      item.count -= 1;
      if (item.count <= 0) {
        item.value.dispose();
        items.delete(key);
      }
    },
    /** Сколько ресурсов сейчас живо (для тестов и отладки). */
    get size() {
      return items.size;
    },
    disposeAll() {
      for (const item of items.values()) item.value.dispose();
      items.clear();
    },
  };
}

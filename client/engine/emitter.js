// Маленькая шина событий. Один и тот же обработчик на одно событие регистрируется один раз,
// ошибка в обработчике не мешает остальным.

export function createEmitter(onError = (err) => console.error(err)) {
  /** @type {Map<string, Set<Function>>} */
  const handlers = new Map();

  return {
    /** Возвращает функцию отписки. */
    on(type, handler) {
      let set = handlers.get(type);
      if (!set) handlers.set(type, (set = new Set()));
      set.add(handler);
      return () => this.off(type, handler);
    },
    off(type, handler) {
      handlers.get(type)?.delete(handler);
    },
    emit(type, payload) {
      for (const handler of [...(handlers.get(type) ?? [])]) {
        try {
          handler(payload);
        } catch (err) {
          onError(err);
        }
      }
    },
    clear() {
      handlers.clear();
    },
  };
}

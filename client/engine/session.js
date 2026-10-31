// Сессия в sessionStorage (не localStorage: два окна могут быть разными пользователями).

const TOKEN_KEY = 'city.token';
const USER_KEY = 'city.user';

/** @param {Storage} [storage] по умолчанию sessionStorage окна */
export function createSession(storage = globalThis.sessionStorage) {
  const read = (key) => {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const write = (key, value) => {
    try {
      if (value === null) storage?.removeItem(key);
      else storage?.setItem(key, value);
    } catch {
      // хранилище может быть недоступно (приватный режим): сессия живёт до перезагрузки
    }
  };

  let memoryToken = null;
  let memoryUser = null;

  return {
    token: () => read(TOKEN_KEY) ?? memoryToken,
    user() {
      const raw = read(USER_KEY);
      if (raw) {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }
      return memoryUser;
    },
    save(token, user) {
      memoryToken = token;
      memoryUser = user;
      write(TOKEN_KEY, token);
      write(USER_KEY, JSON.stringify(user));
    },
    clear() {
      memoryToken = null;
      memoryUser = null;
      write(TOKEN_KEY, null);
      write(USER_KEY, null);
    },
  };
}

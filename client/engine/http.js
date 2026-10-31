// HTTP API сервера. Адреса относительные (/api/...), хост задаёт страница.

export class ApiError extends Error {
  /**
   * @param {number} status HTTP-статус; 0 — сервер недоступен
   * @param {string} code код из ответа сервера (bad_name, bad_room, name_taken, too_many, unauth, network ...)
   */
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** @param {{fetch?: typeof fetch, baseUrl?: string}} [options] baseUrl нужен только тестам */
export function createHttp({ fetch: fetchImpl = globalThis.fetch?.bind(globalThis), baseUrl = '' } = {}) {
  async function request(method, path, { body, token } = {}) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
      });
    } catch {
      throw new ApiError(0, 'network', 'Сервер недоступен');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.error ?? 'http_error', data.message ?? `Ошибка ${res.status}`);
    return data;
  }

  return {
    /** @returns {Promise<{token: string, user: {id: number, name: string, appearance: object}}>} */
    join: (name, room) => request('POST', '/api/join', { body: { name, room } }),
    /** Код комнаты для экрана владельца сервера; чужому компьютеру сервер отвечает 404. @returns {Promise<{room: string}>} */
    localRoom: () => request('GET', '/api/local-room'),
    me: (token) => request('GET', '/api/me', { token }),
    /** @returns {Promise<{ticket: string, expiresIn: number}>} */
    wsTicket: (token) => request('POST', '/api/ws-ticket', { token }),
    /** Время ответа сервера в мс (в протоколе нет ping-сообщения, меряем GET /health). */
    async ping(now = () => performance.now()) {
      const start = now();
      await request('GET', '/health');
      return now() - start;
    },
  };
}

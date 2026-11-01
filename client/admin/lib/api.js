// Клиент HTTP API панели. CSRF-токен хранится только в памяти (не в storage), cookie идёт автоматически.

export class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = extra.fields ?? null;
    this.data = extra.data ?? null;
  }
}

const BASE = '/api/admin';

/**
 * @param {{fetchImpl?: typeof fetch, onUnauth?: () => void}} [opts]
 */
export function createApi({ fetchImpl, onUnauth = () => {} } = {}) {
  let csrf = null;
  let unauthHandler = onUnauth;

  async function request(method, path, { body, query, signal } = {}) {
    const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
    const headers = { Accept: 'application/json' };
    const mutating = method !== 'GET';
    if (mutating && csrf) headers['X-CSRF-Token'] = csrf;
    let payload;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const qs = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null)).toString()}` : '';
    let res;
    try {
      res = await doFetch(`${BASE}${path}${qs}`, { method, headers, body: payload, credentials: 'same-origin', cache: 'no-store', signal });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      throw new ApiError(0, 'network', 'Нет связи с сервером');
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      const code = data?.error ?? `http_${res.status}`;
      if (res.status === 401 && path !== '/login') unauthHandler();
      throw new ApiError(res.status, code, data?.message ?? `Ошибка сервера (${res.status})`, { fields: data?.fields, data });
    }
    return data;
  }

  return {
    setCsrf: (token) => void (csrf = token ?? null),
    hasCsrf: () => csrf !== null,
    setUnauthHandler: (fn) => void (unauthHandler = fn),
    get: (path, opts) => request('GET', path, opts),
    post: (path, body, opts) => request('POST', path, { ...opts, body: body ?? undefined }),
    put: (path, body, opts) => request('PUT', path, { ...opts, body }),
    patch: (path, body, opts) => request('PATCH', path, { ...opts, body }),
    del: (path, opts) => request('DELETE', path, opts),
  };
}

export const api = createApi();

/** Человекочитаемый текст ошибки. */
export function errorText(err) {
  if (!err) return '';
  if (err.code === 'network') return 'Нет связи с сервером. Проверьте, что он запущен.';
  if (err.code === 'rate_limit') return 'Слишком много действий подряд, подождите несколько секунд.';
  return err.message || 'Неизвестная ошибка';
}

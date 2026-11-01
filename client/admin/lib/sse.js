// Один поток SSE на приложение. EventSource переподключается сам, но если сервер закрыл поток
// окончательно (readyState CLOSED, например после ответа 401/429), подключаемся заново с паузой.

export const STREAM_EVENTS = ['snapshot', 'tick', 'world', 'agents', 'audit'];

/**
 * @param {{url: string, handlers: Record<string,(data:any)=>void>, onState?: (s:'connecting'|'online'|'reconnecting')=>void,
 *   onClosed?: () => void, retryMs?: number, EventSourceImpl?: any, setTimeoutImpl?: typeof setTimeout, clearTimeoutImpl?: typeof clearTimeout}} opts
 * @returns {{close: () => void}}
 */
export function openStream({ url, handlers, onState = () => {}, onClosed = () => {}, retryMs = 3000, EventSourceImpl, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout }) {
  const ES = EventSourceImpl ?? globalThis.EventSource;
  let es = null;
  let timer = null;
  let stopped = false;
  let everOpened = false;

  function connect() {
    if (stopped) return;
    onState(everOpened ? 'reconnecting' : 'connecting');
    es = new ES(url, { withCredentials: true });
    es.onopen = () => {
      everOpened = true;
      onState('online');
    };
    for (const name of STREAM_EVENTS) {
      es.addEventListener(name, (ev) => {
        let data;
        try {
          data = JSON.parse(ev.data);
        } catch {
          return; // повреждённое событие пропускаем
        }
        handlers[name]?.(data);
      });
    }
    es.onerror = () => {
      if (stopped) return;
      onState('reconnecting');
      if (es.readyState === 2 /* CLOSED */) {
        es.close();
        es = null;
        onClosed();
        timer = setTimeoutImpl(connect, retryMs);
      }
    };
  }

  connect();
  return {
    close() {
      stopped = true;
      if (timer !== null) clearTimeoutImpl(timer);
      if (es) {
        es.onopen = es.onerror = null;
        es.close();
        es = null;
      }
    },
  };
}

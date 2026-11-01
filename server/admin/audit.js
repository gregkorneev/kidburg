// Журнал административных действий (таблица admin_audit_log). Пишутся состояния сущностей до и после правки —
// этого достаточно для отката объектов мира. Пароли, токены, cookie и CSRF в журнал не попадают:
// записи проходят через redact(), а сами эти значения сюда никогда не передаются.

const SECRET_KEY = /pass(word)?|token|secret|cookie|csrf|authorization|ticket/i;

/** Копия значения без секретных полей и с ограничением размера строк. */
export function redact(value, depth = 0) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  if (typeof value !== 'object') return value;
  if (depth > 6) return null;
  if (Array.isArray(value)) return value.slice(0, 400).map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY.test(k)) continue;
    out[k] = redact(v, depth + 1);
  }
  return out;
}

export function createAudit({ db, now = Date.now }) {
  const listeners = new Set();
  return {
    /**
     * @param {{sessionId: string, action: string, entityType: string, entityId?: string, before?: any, after?: any,
     *   result?: 'ok'|'rejected'|'error', detail?: string}} entry
     */
    record(entry) {
      const saved = db.addAudit({
        ts: now(),
        sessionId: entry.sessionId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: redact(entry.before),
        after: redact(entry.after),
        result: entry.result ?? 'ok',
        detail: entry.detail ? String(entry.detail).slice(0, 300) : null,
      });
      for (const fn of listeners) {
        try {
          fn(saved);
        } catch {
          // подписчик журнала не должен ломать операцию
        }
      }
      return saved;
    },
    list: (options) => db.listAudit(options),
    get: (id) => db.getAudit(id),
    markUndone: (id) => db.markAuditUndone(id),
    rebaseRev: (id, rev) => db.rebaseAuditRev(id, rev),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

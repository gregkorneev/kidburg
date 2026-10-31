// Одноразовые тикеты для подключения к WebSocket. Хранятся только в памяти.

import { randomBytes } from 'node:crypto';

export const TICKET_TTL_MS = 30_000;

export function createTicketStore({ ttlMs = TICKET_TTL_MS, now = Date.now } = {}) {
  /** @type {Map<string, {userId: number, expiresAt: number}>} */
  const tickets = new Map();

  function purge() {
    const t = now();
    for (const [ticket, rec] of tickets) if (rec.expiresAt <= t) tickets.delete(ticket);
  }

  return {
    ttlMs,
    issue(userId) {
      purge();
      const ticket = randomBytes(24).toString('base64url');
      tickets.set(ticket, { userId, expiresAt: now() + ttlMs });
      return ticket;
    },
    /** Возвращает userId и сразу гасит тикет; неверный, использованный или просроченный — null. */
    consume(ticket) {
      const rec = tickets.get(ticket);
      if (!rec) return null;
      tickets.delete(ticket);
      return rec.expiresAt > now() ? rec.userId : null;
    },
    get size() {
      return tickets.size;
    },
  };
}

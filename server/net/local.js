// Определяет, что запрос пришёл от владельца сервера, то есть с самого компьютера, на котором он запущен.
// Нужно только для показа кода комнаты на экране сервера; на /api/join это не влияет: код проверяется всегда.

import { networkInterfaces } from 'node:os';

const LOOPBACK = new Set(['127.0.0.1', '::1']);

/** '::ffff:192.168.0.5' → '192.168.0.5'; регистр и зона ('fe80::1%en0') не важны. */
function normalizeAddress(address) {
  if (typeof address !== 'string') return '';
  let value = address.toLowerCase().split('%')[0];
  if (value.startsWith('::ffff:') && value.includes('.')) value = value.slice(7);
  return value;
}

/** Адреса сетевых интерфейсов этого компьютера. */
export function ownAddresses() {
  const list = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) list.push(entry.address);
  }
  return list;
}

/** Адрес — loopback (127.0.0.0/8, ::1) или один из адресов этого компьютера. */
export function isOwnAddress(address, addresses = ownAddresses) {
  const value = normalizeAddress(address);
  if (!value) return false;
  if (LOOPBACK.has(value) || value.startsWith('127.')) return true;
  return addresses().some((own) => normalizeAddress(own) === value);
}

/** Host-заголовок: имя localhost или адрес-число (хост, подконтрольный чужому DNS, отбрасывается). */
function isLiteralHost(host) {
  if (typeof host !== 'string' || host === '') return false;
  const name = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.replace(/:\d+$/, '');
  return name.toLowerCase() === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(name) || (host.startsWith('[') && name.includes(':'));
}

/**
 * Запрос от владельца сервера?
 *
 * Берётся адрес TCP-соединения (`req.socket.remoteAddress`), а не `req.ip` и не X-Forwarded-For:
 * заголовок подделывается, адрес соединения — нет. Игрок на компьютере сервера приходит либо с loopback
 * (http://localhost:…), либо со своего же LAN-адреса (http://192.168.…:…): у такого соединения адрес клиента
 * совпадает с адресом интерфейса самого сервера, а по сети чужой компьютер так подключиться не может.
 * Дополнительно (от DNS rebinding и чужих страниц в браузере владельца): Host — localhost или число,
 * запрос не из чужой страницы (Sec-Fetch-Site), а Origin, если он есть, совпадает с Host.
 *
 * @param {import('fastify').FastifyRequest} req
 * @param {() => string[]} [addresses] адреса этого компьютера (подменяются в тестах)
 */
export function isServerOwner(req, addresses = ownAddresses) {
  if (!isOwnAddress(req.socket?.remoteAddress, addresses)) return false;
  const { host, origin } = req.headers;
  if (!isLiteralHost(host)) return false;
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return false;
  if (origin !== undefined) {
    try {
      if (new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

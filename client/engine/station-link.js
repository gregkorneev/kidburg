// Общий сетевой адаптер станции с локальными координатами: пекарня, цветочная лавка, музыкальная школа.
//
// Одна авторизованная WebSocket-связь на страницу (createClient({ networkOnly: true }), без второго рендерера).
// После welcome страница просит у сервера сессию станции (station_enter): сервер сам проверяет, что игрок вошёл
// через дверь города, и дальше принимает его локальную позицию (station_pos) для проверки расстояния до наставника.
// Пока сессии нет (нет входа, сервер недоступен, игрок далеко от входа), `ready` ложно и станция
// работает как раньше — полностью локально, без разговоров с ИИ.

import { stationById, stationNpcs } from '../../shared/station-npcs.js';

export const POS_INTERVAL_MS = 100;
export const POS_HEARTBEAT_MS = 1000;

/**
 * @param {object} deps
 * @param {string} deps.stationId ключ из shared/station-npcs.js
 * @param {() => ({x: number, z: number}|null|undefined)} deps.getPosition локальная позиция игрока в станции
 * @param {(position: {x: number, z: number}) => void} [deps.setPosition] применить подтверждённую сервером стартовую позицию
 * @param {() => void} [deps.onChange] изменился статус сессии
 * @param {{api: object, start: Function, stop: Function}} deps.client клиент сети (createClient({ networkOnly: true }))
 * @param {(api: object) => object} deps.mountChat панель разговора (mountNpcChat)
 * @param {{setInterval: Function, clearInterval: Function}} [deps.timers]
 * @param {() => number} [deps.now]
 */
export function createStationLink({
  stationId,
  getPosition,
  setPosition = () => {},
  onChange = () => {},
  client,
  mountChat,
  timers = globalThis,
  now = () => performance.now(),
}) {
  const station = stationById(stationId);
  if (!station) throw new Error(`Неизвестная станция ${stationId}`);
  const { api } = client;
  const chat = mountChat(api);
  let welcomed = false;
  let granted = false; // сервер подтвердил сессию станции
  let message = '';
  let last = null;
  let lastAt = 0;

  const set = (next) => {
    if (next.granted !== undefined) granted = next.granted;
    if (next.message !== undefined) message = next.message;
    onChange();
  };
  const open = () => api.net.status === 'open' && welcomed;

  function sendPosition({ force = false } = {}) {
    if (!granted || !open()) return false;
    const p = getPosition();
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return false;
    const t = now();
    const changed = !last || last.x !== p.x || last.z !== p.z;
    if (!force && (!changed ? t - lastAt < POS_HEARTBEAT_MS : t - lastAt < POS_INTERVAL_MS)) return false;
    if (!api.net.send({ t: 'station_pos', x: p.x, z: p.z })) return false;
    last = { x: p.x, z: p.z };
    lastAt = t;
    return true;
  }

  const offs = [
    api.on('welcome', () => {
      welcomed = true;
      last = null;
      set({ granted: false, message: '' });
      api.net.send({ t: 'station_enter', stationId });
    }),
    api.on('station_state', (msg) => {
      if (msg.stationId !== stationId) return;
      set({ granted: msg.ok === true, message: msg.ok ? '' : msg.message });
      if (msg.ok) {
        // Новая серверная сессия начинается на spawn. После reload локальная сцена могла остаться в старой точке;
        // выравниваем клиента до первой station_pos, не ослабляя серверную проверку скорости.
        setPosition(station.spawn);
        last = null;
        sendPosition({ force: true });
      }
    }),
    api.on('status', ({ status }) => {
      if (status === 'open') return;
      welcomed = false;
      set({ granted: false });
    }),
    api.on('auth', (info) => {
      if (info) return;
      welcomed = false;
      set({ granted: false, message: '' });
    }),
  ];
  const timer = timers.setInterval(() => sendPosition(), POS_INTERVAL_MS);

  return {
    station,
    npcs: stationNpcs(stationId),
    client,
    api,
    chat,
    /** Есть ли подтверждённая сервером сессия станции: тогда E у наставника открывает разговор. */
    get ready() {
      return granted && open();
    },
    get message() {
      return message;
    },
    /** Отправляет позицию перед действием: сервер проверяет расстояние по последней принятой. */
    syncPosition: () => sendPosition({ force: true }),
    start: () => client.start(),
    dispose() {
      timers.clearInterval(timer);
      for (const off of offs) off();
      if (granted && open()) api.net.send({ t: 'station_leave' });
      granted = false;
      chat.dispose();
      client.stop();
    },
  };
}

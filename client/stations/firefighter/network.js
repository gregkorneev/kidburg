// Сетевой слой пожарного preview: позиции игроков через api клиента (client/engine/API.md).
//
// Координаты. Сервер хранит мировые координаты (мир 768×768 м), preview — локальные, с началом
// на полигоне; преобразование и точки станции описаны в layout.js. Угол `ry` в протоколе — yaw
// основного клиента (0 смотрит вдоль −Z), у модели preview поворот на π больше: модель с rotation.y = 0 смотрит вдоль +Z.

import { FIRE_ORIGIN, START, toLocal, toWorld } from './layout.js';

export { START, toLocal };
export const ORIGIN = FIRE_ORIGIN;
export const toServer = toWorld;

const POS_INTERVAL_MS = 1000 / 15;
const POS_HEARTBEAT_MS = 1000;
const DEFAULT_HEADING = Math.PI;

export const headingFromYaw = (ry) => ry + Math.PI;
export const yawFromHeading = (heading) => heading - Math.PI;

/** Стартовая точка из серверного состояния; вне площадки или внутри препятствия — стартовая точка preview. */
export function resolveStart(state, isWalkable) {
  const local = toLocal(state?.x, state?.z);
  const ok = Number.isFinite(local.x) && Number.isFinite(local.z) && isWalkable(local.x, local.z);
  if (!ok) return { x: START.x, z: START.z, heading: DEFAULT_HEADING };
  const heading = Number.isFinite(state.ry) ? headingFromYaw(state.ry) : DEFAULT_HEADING;
  return { x: local.x, z: local.z, heading };
}

/**
 * @param {object} deps
 * @param {{on(type: string, handler: Function): () => void, net: {send(msg: object): boolean}}} deps.api
 * @param {ReturnType<import('./scene.js').createFirefighterScene>} deps.world
 * @param {(online: boolean) => void} [deps.onSession] true после welcome, false после выхода
 * @param {() => number} [deps.now]
 */
export function connectFireNetwork({ api, world, onSession = () => {}, now = () => performance.now() }) {
  let joined = false; // welcome получен после входа: можно играть
  let open = false; // сокет открыт и welcome получен на нём: можно слать pos
  let seq = 0;
  let baseY = 0;
  let last = null;
  let lastAt = 0;

  function reset() {
    world.clearRemotePlayers();
    last = null;
  }

  const offs = [
    api.on('welcome', (msg) => {
      reset(); // после (пере)подключения сервер заново шлёт игроков вокруг
      baseY = Number.isFinite(msg.state?.y) ? msg.state.y : 0;
      world.setLocalPosition(resolveStart(msg.state, world.isWalkable));
      open = true;
      if (!joined) {
        joined = true;
        onSession(true);
      }
    }),
    api.on('player_join', (msg) => world.addRemotePlayer(msg.id, msg.name, msg.appearance?.firefighterEquipped === true, msg.appearance?.color)),
    api.on('player_appearance', (msg) => world.setRemotePlayerEquipment(msg.id, msg.appearance?.firefighterEquipped)),
    api.on('player_leave', (msg) => world.removeRemotePlayer(msg.id)),
    api.on('players', (msg) => {
      world.updateRemotePlayers(
        msg.list.map(([id, x, , z, ry, anim]) => ({
          id,
          ...toLocal(x, z),
          heading: headingFromYaw(ry),
          moving: anim > 0,
        })),
      );
    }),
    api.on('correct', (msg) => {
      baseY = Number.isFinite(msg.y) ? msg.y : baseY;
      const { heading } = world.localPosition();
      world.setLocalPosition({ ...toLocal(msg.x, msg.z), heading });
      last = null;
    }),
    api.on('status', ({ status }) => {
      if (status === 'open') return;
      open = false; // позиции в закрытый сокет не шлём; игроки появятся заново после welcome
      world.clearRemotePlayers();
    }),
    api.on('auth', (info) => {
      if (info) return;
      open = false;
      reset();
      if (joined) {
        joined = false;
        onSession(false);
      }
    }),
  ];

  return {
    /**
     * Вызывается каждый кадр с world.localPosition(): отправляет pos не чаще 15 раз в секунду.
     * `force` отправляет изменившуюся позицию сразу: перед действием сервер должен знать, где игрок и куда смотрит.
     */
    sendPosition({ x, z, heading, anim }, { force = false } = {}) {
      if (!open) return;
      const t = now();
      if (!force && last && t - lastAt < POS_INTERVAL_MS) return;
      const server = toServer(x, z);
      const ry = yawFromHeading(heading);
      const changed =
        !last || last.x !== server.x || last.z !== server.z || last.ry !== ry || last.anim !== anim;
      if (!changed && (force || t - lastAt < POS_HEARTBEAT_MS)) return;
      seq += 1;
      if (api.net.send({ t: 'pos', x: server.x, y: baseY, z: server.z, ry, anim, seq })) {
        last = { x: server.x, z: server.z, ry, anim };
        lastAt = t;
      }
    },
    dispose() {
      for (const off of offs) off();
      open = false;
      joined = false;
    },
  };
}

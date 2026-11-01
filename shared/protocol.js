// Протокол WebSocket v1: MessagePack, бинарные кадры, поле `t` — тип сообщения.

import { encode as mpEncode, decode as mpDecode } from '@msgpack/msgpack';
import { PROTO_VERSION } from './constants.js';
import { INTERACT_LIMITS, PROP_STATES, isInteractAction } from './interaction-contracts.js';

export const PROTO = PROTO_VERSION;

export const C2S = Object.freeze({
  HELLO: 'hello',
  POS: 'pos',
  CHAT: 'chat',
  NPC_TALK: 'npc_talk',
  TASK_ANSWER: 'task_answer',
  // Игрок просит выставить состояние механизма (ворота, лестница): shared/mechanisms.js.
  MECH_SET: 'mech_set',
  // Игровое действие над предметом или мячом: взять, поставить, бросить, пнуть (shared/interaction-contracts.js).
  INTERACT: 'interact',
});

export const S2C = Object.freeze({
  WELCOME: 'welcome',
  PLAYER_JOIN: 'player_join',
  PLAYER_LEAVE: 'player_leave',
  PLAYER_APPEARANCE: 'player_appearance',
  PLAYERS: 'players',
  CORRECT: 'correct',
  CHAT: 'chat',
  CHUNK_LOAD: 'chunk_load',
  CHUNK_UNLOAD: 'chunk_unload',
  CACHE_STATS: 'cache_stats',
  AGENT_QUEUE: 'agent_queue',
  AGENT_TOKEN: 'agent_token',
  AGENT_DONE: 'agent_done',
  AGENT_ERROR: 'agent_error',
  TASK_STATE: 'task_state',
  // Динамические объекты мира (редактор Control Center): снимок чанка, создание/изменение, удаление.
  DYN_SNAPSHOT: 'dyn_snapshot',
  DYN_UPSERT: 'dyn_upsert',
  DYN_REMOVE: 'dyn_remove',
  MECH_SNAPSHOT: 'mech_snapshot',
  MECH_STATE: 'mech_state',
  PROP_SNAPSHOT: 'prop_snapshot',
  PROP_STATE: 'prop_state',
  BALL_SNAPSHOT: 'ball_snapshot',
  BALL_EVENT: 'ball_event',
  INTERACT_RESULT: 'interact_result',
  ERROR: 'error',
});

export const ERROR_CODES = Object.freeze({
  BAD_MSG: 'bad_msg',
  TOO_FAR: 'too_far',
  RATE_LIMIT: 'rate_limit',
  UNAUTH: 'unauth',
});

export const LIMITS = Object.freeze({
  CHAT_MAX_CHARS: 200,
  POS_PER_SEC: 30,
  CHAT_PER_SEC: 5,
  NPC_TALK_PER_SEC: 1,
});

const str = (v) => typeof v === 'string';
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const int = (v) => Number.isInteger(v);
const obj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const bytes = (v) => v instanceof Uint8Array;

const dynObject = (o) =>
  obj(o) && str(o.id) && str(o.type) && num(o.x) && num(o.z) && num(o.ry) && num(o.scale) && obj(o.params) && int(o.rev);

// Схема: тип -> { поле: проверка }. Лишние поля допускаются.
const SCHEMAS = {
  // клиент -> сервер
  hello: { ticket: str, proto: int },
  pos: { x: num, y: num, z: num, ry: num, anim: (v) => v === 0 || v === 1 || v === 2, seq: int },
  chat: { text: (v) => str(v) && v.length > 0 && v.length <= LIMITS.CHAT_MAX_CHARS },
  npc_talk: { agentId: str, text: (v) => str(v) && v.length > 0, reqId: (v) => str(v) || int(v) },
  task_answer: { taskId: str, payload: (v) => v !== undefined },
  mech_set: { id: str, active: (v) => typeof v === 'boolean' },
  interact: { id: (v) => str(v) && v.length > 0 && v.length <= INTERACT_LIMITS.MAX_ID_CHARS, action: isInteractAction, seq: int },
  // сервер -> клиент
  welcome: { proto: int, playerId: int, name: str, state: obj, consts: obj },
  player_join: { id: int, name: str, appearance: obj },
  player_leave: { id: int },
  player_appearance: { id: int, appearance: obj },
  players: { tick: int, list: (v) => Array.isArray(v) && v.every((r) => Array.isArray(r) && r.length === 6) },
  correct: { x: num, y: num, z: num },
  chunk_load: { cx: int, cz: int, data: bytes },
  chunk_unload: { cx: int, cz: int },
  cache_stats: { loaded: int, max: int, worldTotal: int, bytes: num, bytesMax: num },
  agent_queue: { agentId: str, reqId: (v) => str(v) || int(v), position: int },
  agent_token: { agentId: str, reqId: (v) => str(v) || int(v), token: str },
  agent_done: { agentId: str, reqId: (v) => str(v) || int(v) },
  agent_error: { agentId: str, reqId: (v) => str(v) || int(v), message: str },
  task_state: { taskId: str, state: (v) => v !== undefined },
  dyn_snapshot: { cx: int, cz: int, objects: (v) => Array.isArray(v) && v.every(dynObject) },
  dyn_upsert: { object: dynObject },
  dyn_remove: { id: str, rev: int },
  mech_snapshot: { list: (v) => Array.isArray(v) },
  mech_state: { id: str, active: (v) => typeof v === 'boolean', ageMs: num, progress: num },
  prop_snapshot: { list: (v) => Array.isArray(v) },
  prop_state: { prop: obj },
  ball_snapshot: { tick: int, ts: num, list: (v) => Array.isArray(v) },
  ball_event: { kind: str },
  interact_result: { seq: int, id: str, action: str, ok: (v) => typeof v === 'boolean', code: str, message: str },
  error: { code: (v) => Object.values(ERROR_CODES).includes(v), message: str },
};

// `chat` имеет разные поля в двух направлениях.
const CHAT_S2C = { from: (v) => str(v) || int(v), text: str, ts: num };

export function encode(msg) {
  return mpEncode(msg);
}

export function decode(buf) {
  return mpDecode(buf);
}

/**
 * Проверяет обязательные поля и их типы.
 * @param {unknown} msg
 * @param {'c2s'|'s2c'} [dir] нужно только для `chat`, у которого разные поля
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function validate(msg, dir = 'c2s') {
  if (!obj(msg) || !str(msg.t)) return { ok: false, error: 'нет поля t' };
  const schema = msg.t === 'chat' && dir === 's2c' ? CHAT_S2C : SCHEMAS[msg.t];
  if (!schema) return { ok: false, error: `неизвестный тип: ${msg.t}` };
  for (const [field, check] of Object.entries(schema)) {
    if (!check(msg[field])) return { ok: false, error: `неверное поле ${field} в ${msg.t}` };
  }
  return { ok: true };
}

// Слой доступа к SQLite (better-sqlite3). Наружу выходят только функции с
// подготовленными запросами, сырое соединение не экспортируется.
// Время везде в миллисекундах Unix (created_at, expires_at, updated_at).

import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Database from 'better-sqlite3';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_FILE = path.join(HERE, 'schema.sql');

export const DEFAULT_DB_FILE = path.resolve(HERE, '..', '..', 'data', 'city.db');

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

const toUser = (row) =>
  row && { id: row.id, name: row.name, appearance: parseJson(row.appearance, {}), createdAt: row.created_at };

/**
 * Открывает базу и применяет схему (идемпотентно).
 * @param {string} [file] путь к файлу или ':memory:'
 */
export function openDb(file = DEFAULT_DB_FILE) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const handle = new Database(file);
  handle.exec(readFileSync(SCHEMA_FILE, 'utf8'));
  handle.pragma('foreign_keys = ON');

  const q = {
    insertUser: handle.prepare(
      'INSERT INTO users (name, pass_hash, salt, appearance, created_at) VALUES (?, ?, ?, ?, ?)',
    ),
    userById: handle.prepare('SELECT * FROM users WHERE id = ?'),
    userByName: handle.prepare('SELECT * FROM users WHERE name = ?'),
    updatePasswordHash: handle.prepare('UPDATE users SET pass_hash = ?, salt = ? WHERE id = ?'),
    allUsers: handle.prepare('SELECT * FROM users'),
    insertSession: handle.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    sessionByHash: handle.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ? AND expires_at > ?'),
    deleteSession: handle.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    purgeSessions: handle.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    clearSessions: handle.prepare('DELETE FROM sessions'),
    stateByUser: handle.prepare('SELECT x, y, z, ry, updated_at FROM player_state WHERE user_id = ?'),
    upsertState: handle.prepare(
      `INSERT INTO player_state (user_id, x, y, z, ry, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET x = excluded.x, y = excluded.y, z = excluded.z,
         ry = excluded.ry, updated_at = excluded.updated_at`,
    ),
    memoryByKey: handle.prepare('SELECT * FROM agent_memory WHERE user_id = ? AND agent_id = ?'),
    upsertMemory: handle.prepare(
      `INSERT INTO agent_memory (user_id, agent_id, told_cards, summary, turns, topics, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, agent_id) DO UPDATE SET told_cards = excluded.told_cards,
         summary = excluded.summary, turns = excluded.turns, topics = excluded.topics,
         updated_at = excluded.updated_at`,
    ),
    taskByKey: handle.prepare('SELECT * FROM task_progress WHERE user_id = ? AND task_id = ?'),
    tasksByUser: handle.prepare('SELECT * FROM task_progress WHERE user_id = ? ORDER BY task_id'),
    upsertTask: handle.prepare(
      `INSERT INTO task_progress (user_id, task_id, state, done, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, task_id) DO UPDATE SET state = excluded.state, done = excluded.done,
         updated_at = excluded.updated_at`,
    ),
  };

  const saveStates = handle.transaction((rows) => {
    for (const r of rows) q.upsertState.run(r.userId, r.x, r.y, r.z, r.ry ?? 0, r.updatedAt);
  });

  const toMemory = (row) =>
    row && {
      userId: row.user_id,
      agentId: row.agent_id,
      toldCards: parseJson(row.told_cards, []),
      summary: row.summary,
      turns: parseJson(row.turns, []),
      topics: parseJson(row.topics, {}),
      updatedAt: row.updated_at,
    };

  const toTask = (row) =>
    row && {
      userId: row.user_id,
      taskId: row.task_id,
      state: parseJson(row.state, {}),
      done: row.done === 1,
      updatedAt: row.updated_at,
    };

  return {
    // Пользователи. findUserByName возвращает ещё passHash и salt (нужны только для входа).
    /** @returns {object|null} null, если имя занято (без учёта регистра) */
    createUser({ name, passHash, salt, appearance = {}, now = Date.now() }) {
      try {
        const info = q.insertUser.run(name, passHash, salt, JSON.stringify(appearance), now);
        return toUser(q.userById.get(info.lastInsertRowid));
      } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return null;
        throw err;
      }
    },
    getUser: (id) => toUser(q.userById.get(id)) ?? null,
    findUserByName(name) {
      const row = q.userByName.get(name);
      return row ? { ...toUser(row), passHash: row.pass_hash, salt: row.salt } : null;
    },
    /** Обновляет парольный хеш после успешного входа со старой схемой. */
    updatePasswordHash(userId, passHash, salt = '') {
      return q.updatePasswordHash.run(passHash, salt, userId).changes === 1;
    },
    /**
     * Как findUserByName, но регистр не важен для любого алфавита: уникальный индекс SQLite
     * сравнивает без учёта регистра только латиницу, а «аня» не должна быть вторым игроком «Аня».
     */
    findUserByNameAnyCase(name) {
      const exact = this.findUserByName(name);
      if (exact) return exact;
      const folded = name.toLowerCase();
      for (const row of q.allUsers.iterate()) {
        if (row.name.toLowerCase() === folded) return { ...toUser(row), passHash: row.pass_hash, salt: row.salt };
      }
      return null;
    },

    // Сессии: хранится только HMAC-SHA-256 токена с секретом сервера.
    createSession: (tokenHash, userId, expiresAt) => void q.insertSession.run(tokenHash, userId, expiresAt),
    /** Действующая сессия или null, если токена нет или срок вышел. */
    findSession(tokenHash, now = Date.now()) {
      const row = q.sessionByHash.get(tokenHash, now);
      return row ? { userId: row.user_id, expiresAt: row.expires_at } : null;
    },
    deleteSession: (tokenHash) => void q.deleteSession.run(tokenHash),
    purgeExpiredSessions: (now = Date.now()) => q.purgeSessions.run(now).changes,
    /** Удаляет все сессии (при старте сервера: токены прошлого запуска не должны действовать). */
    clearSessions: () => q.clearSessions.run().changes,

    // Позиция игрока.
    getPlayerState(userId) {
      const row = q.stateByUser.get(userId);
      return row ? { x: row.x, y: row.y, z: row.z, ry: row.ry, updatedAt: row.updated_at } : null;
    },
    savePlayerState: ({ userId, x, y, z, ry = 0, updatedAt = Date.now() }) =>
      void q.upsertState.run(userId, x, y, z, ry, updatedAt),
    /** Пачка в одной транзакции: либо записаны все, либо ни одной. */
    savePlayerStates: (rows) => void saveStates(rows),

    // Память агента.
    getAgentMemory: (userId, agentId) => toMemory(q.memoryByKey.get(userId, agentId)) ?? null,
    saveAgentMemory(userId, agentId, { toldCards = [], summary = '', turns = [], topics = {} }, now = Date.now()) {
      q.upsertMemory.run(
        userId,
        agentId,
        JSON.stringify(toldCards),
        summary,
        JSON.stringify(turns),
        JSON.stringify(topics),
        now,
      );
    },

    // Прогресс задач.
    getTaskProgress: (userId, taskId) => toTask(q.taskByKey.get(userId, taskId)) ?? null,
    listTaskProgress: (userId) => q.tasksByUser.all(userId).map(toTask),
    saveTaskProgress(userId, taskId, { state = {}, done = false }, now = Date.now()) {
      q.upsertTask.run(userId, taskId, JSON.stringify(state), done ? 1 : 0, now);
    },

    close: () => handle.close(),
  };
}

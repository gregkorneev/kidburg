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
    interactiveProps: handle.prepare('SELECT id, type, x, z, ry, state, updated_at FROM interactive_props ORDER BY id'),
    upsertInteractiveProp: handle.prepare(
      `INSERT INTO interactive_props (id, type, x, z, ry, state, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET type = excluded.type, x = excluded.x, z = excluded.z,
         ry = excluded.ry, state = excluded.state, updated_at = excluded.updated_at`,
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
    // Control Center.
    worldObjects: handle.prepare('SELECT * FROM world_objects ORDER BY created_at, id'),
    insertWorldObject: handle.prepare(
      `INSERT INTO world_objects (id, type, x, z, ry, scale, params, revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    updateWorldObject: handle.prepare(
      'UPDATE world_objects SET x = ?, z = ?, ry = ?, scale = ?, params = ?, revision = ?, updated_at = ? WHERE id = ?',
    ),
    deleteWorldObject: handle.prepare('DELETE FROM world_objects WHERE id = ?'),
    clearWorldObjects: handle.prepare('DELETE FROM world_objects'),
    metaGet: handle.prepare('SELECT value FROM world_meta WHERE key = ?'),
    metaSet: handle.prepare(
      'INSERT INTO world_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ),
    agentSettingsOne: handle.prepare('SELECT * FROM agent_settings WHERE agent_id = ?'),
    agentSettingsAll: handle.prepare('SELECT * FROM agent_settings ORDER BY agent_id'),
    upsertAgentSettings: handle.prepare(
      `INSERT INTO agent_settings (agent_id, settings, revision, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(agent_id) DO UPDATE SET settings = excluded.settings, revision = excluded.revision,
         updated_at = excluded.updated_at`,
    ),
    deleteAgentSettings: handle.prepare('DELETE FROM agent_settings WHERE agent_id = ?'),
    insertAudit: handle.prepare(
      `INSERT INTO admin_audit_log (ts, session_id, action, entity_type, entity_id, before_state, after_state, result, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    auditOne: handle.prepare('SELECT * FROM admin_audit_log WHERE id = ?'),
    auditPage: handle.prepare('SELECT * FROM admin_audit_log WHERE id < ? ORDER BY id DESC LIMIT ?'),
    markUndone: handle.prepare('UPDATE admin_audit_log SET undone = 1 WHERE id = ? AND undone = 0'),
    setAuditAfter: handle.prepare('UPDATE admin_audit_log SET after_state = ? WHERE id = ?'),
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

  const toWorldObject = (row) => ({
    id: row.id,
    type: row.type,
    x: row.x,
    z: row.z,
    ry: row.ry,
    scale: row.scale,
    params: parseJson(row.params, {}),
    rev: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  const toAgentSettings = (row) =>
    row && { agentId: row.agent_id, settings: parseJson(row.settings, {}), revision: row.revision, updatedAt: row.updated_at };
  const toAudit = (row) =>
    row && {
      id: row.id,
      ts: row.ts,
      sessionId: row.session_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      before: row.before_state === null ? null : parseJson(row.before_state, null),
      after: row.after_state === null ? null : parseJson(row.after_state, null),
      result: row.result,
      detail: row.detail,
      undone: row.undone === 1,
    };
  const json = (v) => (v === undefined || v === null ? null : JSON.stringify(v));
  const writeWorld = handle.transaction((fn) => fn());

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
    /** Удаляет все сессии. */
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

    // Переносимые предметы города: сохраняется только безопасное положение, предмет в руках не закрепляется.
    listInteractiveProps: () => q.interactiveProps.all().map((row) => ({
      id: row.id, type: row.type, x: row.x, z: row.z, ry: row.ry, state: row.state, updatedAt: row.updated_at,
    })),
    saveInteractiveProp: ({ id, type, x, z, ry = 0, state = 'available' }, updatedAt = Date.now()) =>
      void q.upsertInteractiveProp.run(id, type, x, z, ry, state, updatedAt),

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

    // Динамические объекты мира. Мутации идут через world(): объекты и счётчик ревизии пишутся атомарно.
    listWorldObjects: () => q.worldObjects.all().map(toWorldObject),
    getWorldRevision: () => q.metaGet.get('world_rev')?.value ?? 0,
    /** Атомарно выполняет {insert, update, remove, clear, setRevision}-операции одной правки мира. */
    world(fn) {
      writeWorld(() =>
        fn({
          insert: (o, at = Date.now()) =>
            void q.insertWorldObject.run(o.id, o.type, o.x, o.z, o.ry, o.scale, JSON.stringify(o.params ?? {}), o.rev, o.createdAt ?? at, at),
          update: (o, at = Date.now()) =>
            void q.updateWorldObject.run(o.x, o.z, o.ry, o.scale, JSON.stringify(o.params ?? {}), o.rev, at, o.id),
          remove: (id) => void q.deleteWorldObject.run(id),
          clear: () => void q.clearWorldObjects.run(),
          setRevision: (rev) => void q.metaSet.run('world_rev', rev),
        }),
      );
    },

    // Переопределения настроек агентов (поверх базовых персон из JSON).
    getAgentSettings: (agentId) => toAgentSettings(q.agentSettingsOne.get(agentId)) ?? null,
    listAgentSettings: () => q.agentSettingsAll.all().map(toAgentSettings),
    saveAgentSettings(agentId, settings, revision, now = Date.now()) {
      q.upsertAgentSettings.run(agentId, JSON.stringify(settings), revision, now);
    },
    deleteAgentSettings: (agentId) => q.deleteAgentSettings.run(agentId).changes === 1,

    // Журнал действий администратора (секреты в него не попадают: пишутся только состояния сущностей).
    addAudit({ ts = Date.now(), sessionId, action, entityType, entityId = null, before, after, result = 'ok', detail = null }) {
      const info = q.insertAudit.run(ts, sessionId, action, entityType, entityId, json(before), json(after), result, detail);
      return toAudit(q.auditOne.get(info.lastInsertRowid));
    },
    getAudit: (id) => toAudit(q.auditOne.get(id)) ?? null,
    listAudit: ({ limit = 50, beforeId = Number.MAX_SAFE_INTEGER } = {}) =>
      q.auditPage.all(beforeId, Math.min(Math.max(1, limit), 200)).map(toAudit),
    markAuditUndone: (id) => q.markUndone.run(id).changes === 1,
    /** Обновляет ревизию в состоянии «после» записи журнала (после отката ревизия объекта выросла, а цепочка отмен должна работать). */
    rebaseAuditRev(id, rev) {
      const row = q.auditOne.get(id);
      const after = row && parseJson(row.after_state, null);
      if (after && typeof after === 'object' && !Array.isArray(after)) q.setAuditAfter.run(JSON.stringify({ ...after, rev }), id);
    },

    close: () => handle.close(),
  };
}

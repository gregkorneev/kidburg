PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  appearance TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS player_state (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL, ry REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_memory (
  user_id INTEGER NOT NULL REFERENCES users(id),
  agent_id TEXT NOT NULL,
  told_cards TEXT NOT NULL DEFAULT '[]',   -- JSON-массив id карточек
  summary TEXT NOT NULL DEFAULT '',
  turns TEXT NOT NULL DEFAULT '[]',        -- последние реплики
  topics TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, agent_id)
);

CREATE TABLE IF NOT EXISTS task_progress (
  user_id INTEGER NOT NULL REFERENCES users(id),
  task_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT '{}',
  done INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, task_id)
);

-- Control Center: динамические объекты мира, настройки агентов, журнал действий администратора.
-- Таблицы добавляются поверх существующих (IF NOT EXISTS), игровые данные не затрагиваются.
CREATE TABLE IF NOT EXISTS world_objects (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  x REAL NOT NULL, z REAL NOT NULL, ry REAL NOT NULL DEFAULT 0, scale REAL NOT NULL DEFAULT 1,
  params TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS world_meta (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_settings (
  agent_id TEXT PRIMARY KEY,
  settings TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_state TEXT,
  after_state TEXT,
  result TEXT NOT NULL,
  detail TEXT,
  undone INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS admin_audit_ts ON admin_audit_log (ts);

-- Переносимые игровые предметы (ящики, конусы, горшки): только последнее безопасное положение.
-- Предмет в руках в базе не хранится: после сбоя или перезапуска он стоит там, откуда его взяли.
CREATE TABLE IF NOT EXISTS interactive_props (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  x REAL NOT NULL, z REAL NOT NULL, ry REAL NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'available',
  updated_at INTEGER NOT NULL
);

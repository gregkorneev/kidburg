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

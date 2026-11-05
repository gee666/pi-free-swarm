CREATE TABLE watcher_chat_sessions (
  id TEXT PRIMARY KEY,
  swarm_id INTEGER NOT NULL REFERENCES swarms(id),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle', 'working', 'error')),
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX watcher_chat_active ON watcher_chat_sessions(swarm_id) WHERE active = 1;
CREATE TABLE watcher_chat_messages (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL REFERENCES watcher_chat_sessions(id),
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX watcher_chat_history ON watcher_chat_messages(session_id, sequence);

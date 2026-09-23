-- Schema version 1. Applied by src/store/db.ts inside one BEGIN IMMEDIATE transaction, which then sets
-- PRAGMA user_version = 1. Later changes go into new numbered migration files; never edit this one
-- after release. Timestamps are epoch ms. Names are stored canonical ("Maria"); participants.name
-- compares case-insensitively so lookups and uniqueness ignore case.

CREATE TABLE swarms (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT NOT NULL,
  task_prompt         TEXT NOT NULL,
  agent_amount        INTEGER NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('starting', 'running', 'finished', 'stopped', 'interrupted')),
  -- Run lock: pid of the main process running the swarm, NULL when nobody runs it.
  runner_pid          INTEGER,
  runner_heartbeat_at INTEGER,
  created_at          INTEGER NOT NULL,
  started_at          INTEGER,
  finished_at         INTEGER,
  run_count           INTEGER NOT NULL DEFAULT 1
);

-- One row per swarm/resume_swarm run; wall time is the sum of these spans.
CREATE TABLE swarm_runs (
  swarm_id   INTEGER NOT NULL REFERENCES swarms(id),
  run        INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at   INTEGER,
  end_status TEXT CHECK (end_status IN ('finished', 'stopped', 'interrupted')),
  PRIMARY KEY (swarm_id, run)
);

CREATE TABLE participants (
  swarm_id         INTEGER NOT NULL REFERENCES swarms(id),
  name             TEXT NOT NULL COLLATE NOCASE,
  kind             TEXT NOT NULL CHECK (kind IN ('agent', 'user', 'main', 'system')),
  -- Agents only; NULL for User, Main and System.
  status           TEXT CHECK (status IN ('pending', 'starting', 'working', 'idle', 'crashed', 'stopped')),
  -- Agents only: JSON of AgentActivity, NULL when idle.
  activity         TEXT,
  -- Agents only, relative to .pi/swarm/, e.g. sessions/3/Maria.
  session_dir      TEXT,
  launch_order     INTEGER,
  revive_count     INTEGER NOT NULL DEFAULT 0,
  joined_at        INTEGER,
  last_activity_at INTEGER,
  PRIMARY KEY (swarm_id, name),
  CHECK ((kind = 'agent') = (status IS NOT NULL))
);

CREATE TABLE posts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  swarm_id   INTEGER NOT NULL REFERENCES swarms(id),
  author     TEXT NOT NULL,
  title      TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 60),
  body       TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 200),
  created_at INTEGER NOT NULL
);
CREATE INDEX posts_by_swarm ON posts (swarm_id, id);

CREATE TABLE comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL REFERENCES posts(id),
  swarm_id   INTEGER NOT NULL REFERENCES swarms(id),
  author     TEXT NOT NULL,
  body       TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 200),
  created_at INTEGER NOT NULL
);
CREATE INDEX comments_by_post ON comments (post_id, id);
CREATE INDEX comments_by_swarm ON comments (swarm_id);

CREATE TABLE threads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  swarm_id   INTEGER NOT NULL REFERENCES swarms(id),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX threads_by_swarm ON threads (swarm_id);

CREATE TABLE thread_members (
  thread_id INTEGER NOT NULL REFERENCES threads(id),
  name      TEXT NOT NULL,
  -- Join order: the creator is 0.
  position  INTEGER NOT NULL,
  PRIMARY KEY (thread_id, name)
);

CREATE TABLE messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  swarm_id   INTEGER NOT NULL REFERENCES swarms(id),
  thread_id  INTEGER NOT NULL REFERENCES threads(id),
  sender     TEXT NOT NULL,
  -- 200 for agents and User (enforced by the broker); up to 2000 for Main feedback.
  body       TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at INTEGER NOT NULL
);
CREATE INDEX messages_by_thread ON messages (thread_id, id);
CREATE INDEX messages_by_sender ON messages (swarm_id, sender, id);

-- One row per recipient: the inbox and the delivery state. Main and System never get rows.
CREATE TABLE message_recipients (
  message_id   INTEGER NOT NULL REFERENCES messages(id),
  -- Copied from messages so the inbox and the delivery poll are single-table index scans.
  swarm_id     INTEGER NOT NULL REFERENCES swarms(id),
  name         TEXT NOT NULL,
  -- Order in which recipients were addressed.
  position     INTEGER NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'read', 'undeliverable')),
  delivered_at INTEGER,
  read_at      INTEGER,
  PRIMARY KEY (message_id, name)
);
CREATE INDEX recipients_by_inbox ON message_recipients (swarm_id, name, message_id);
-- The 300 ms delivery poll and completion checks only look at open rows.
CREATE INDEX recipients_open ON message_recipients (swarm_id, status) WHERE status IN ('pending', 'delivered');

-- One row per assistant message of an agent.
CREATE TABLE usage (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  swarm_id    INTEGER NOT NULL REFERENCES swarms(id),
  agent       TEXT NOT NULL,
  run         INTEGER NOT NULL,
  input       INTEGER NOT NULL,
  output      INTEGER NOT NULL,
  cache_read  INTEGER NOT NULL,
  cache_write INTEGER NOT NULL,
  cost        REAL NOT NULL,
  model       TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX usage_by_agent ON usage (swarm_id, agent);

-- Working spans for active-time accounting; ended_at is NULL while the agent works.
CREATE TABLE agent_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  swarm_id   INTEGER NOT NULL REFERENCES swarms(id),
  agent      TEXT NOT NULL,
  run        INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at   INTEGER,
  reason     TEXT CHECK (reason IN ('settled', 'crashed', 'stopped'))
);
CREATE INDEX agent_runs_by_agent ON agent_runs (swarm_id, agent);
CREATE INDEX agent_runs_open ON agent_runs (swarm_id) WHERE ended_at IS NULL;

-- Change outbox, written in the same transaction as each change and tailed by the server host.
-- payload is the JSON of SwarmEventPayloads[type]. Rows older than 24 h are pruned.
CREATE TABLE events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  swarm_id   INTEGER NOT NULL,
  type       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX events_by_time ON events (created_at);

-- Single row: which main process hosts the board server for this folder. A clean exit sets
-- heartbeat_at = 0 instead of deleting the row, so the next host can reuse the port.
CREATE TABLE server_host (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  pid          INTEGER NOT NULL,
  port         INTEGER NOT NULL,
  heartbeat_at INTEGER NOT NULL
);

-- Per participant: the newest post id it has seen, for the "(new)" flag of read_posts.
CREATE TABLE read_marks (
  swarm_id     INTEGER NOT NULL REFERENCES swarms(id),
  name         TEXT NOT NULL,
  last_post_id INTEGER NOT NULL,
  PRIMARY KEY (swarm_id, name)
);

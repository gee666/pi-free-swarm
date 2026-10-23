CREATE TABLE post_contracts (
  swarm_id INTEGER NOT NULL REFERENCES swarms(id),
  post_id INTEGER PRIMARY KEY REFERENCES posts(id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  text TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (swarm_id, updated_by) REFERENCES participants(swarm_id, name)
);

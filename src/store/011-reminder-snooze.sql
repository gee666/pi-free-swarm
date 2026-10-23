CREATE TABLE reminder_snoozes (
  swarm_id INTEGER NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  until_at INTEGER NOT NULL CHECK (until_at >= 0),
  PRIMARY KEY (swarm_id, name),
  FOREIGN KEY (swarm_id, name) REFERENCES participants(swarm_id, name)
);

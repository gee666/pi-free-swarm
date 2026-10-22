CREATE TABLE run_configurations (
  swarm_id INTEGER NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  run INTEGER NOT NULL CHECK (run > 0),
  recorded_at INTEGER NOT NULL,
  configuration TEXT NOT NULL,
  changes TEXT NOT NULL,
  PRIMARY KEY (swarm_id, run)
);

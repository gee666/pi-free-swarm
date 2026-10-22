CREATE TABLE budget_stops (
  swarm_id INTEGER NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  run INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('money', 'time')),
  cost_usd REAL NOT NULL,
  active_time_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (swarm_id, run)
);

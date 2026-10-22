CREATE TABLE budget_accounting_gaps (
  swarm_id INTEGER NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  agent TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (swarm_id, agent, reason)
);

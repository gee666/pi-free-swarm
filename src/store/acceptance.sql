-- Append to the numbered migration list after the communication migration.
CREATE TABLE acceptance (
  swarm_id INTEGER PRIMARY KEY REFERENCES swarms(id),
  revision INTEGER NOT NULL DEFAULT 0,
  verdict TEXT NOT NULL DEFAULT 'unchecked' CHECK (verdict IN ('unchecked', 'checking', 'accepted', 'incomplete', 'blocked')),
  claimant TEXT,
  claim_run INTEGER,
  evidence TEXT NOT NULL DEFAULT '[]',
  known_gaps TEXT NOT NULL DEFAULT '[]',
  findings TEXT NOT NULL DEFAULT '[]',
  updated_by TEXT,
  updated_at INTEGER,
  closed_run INTEGER,
  CHECK ((verdict = 'checking') = (claimant IS NOT NULL)),
  CHECK ((claimant IS NULL) = (claim_run IS NULL))
);
INSERT INTO acceptance (swarm_id) SELECT id FROM swarms;
CREATE TRIGGER acceptance_on_swarm AFTER INSERT ON swarms BEGIN
  INSERT INTO acceptance (swarm_id) VALUES (NEW.id);
END;
CREATE TABLE acceptance_notifications (
  swarm_id INTEGER NOT NULL,
  run INTEGER NOT NULL,
  recipient TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (swarm_id, run),
  FOREIGN KEY (swarm_id, run) REFERENCES swarm_runs(swarm_id, run)
);

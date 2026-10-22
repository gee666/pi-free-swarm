ALTER TABLE swarms ADD COLUMN acceptance_criteria TEXT NOT NULL DEFAULT '[]';

-- Legacy claims are not votes. Preserve revision history, but require fresh agent judgments.
DROP TRIGGER acceptance_on_swarm;
CREATE TABLE acceptance_next (
  swarm_id INTEGER PRIMARY KEY REFERENCES swarms(id),
  revision INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT,
  updated_at INTEGER,
  closed_run INTEGER
);
INSERT INTO acceptance_next (swarm_id, revision, updated_by, updated_at, closed_run)
  SELECT swarm_id, revision, updated_by, updated_at, closed_run FROM acceptance;
DROP TABLE acceptance;
ALTER TABLE acceptance_next RENAME TO acceptance;
CREATE TRIGGER acceptance_on_swarm AFTER INSERT ON swarms BEGIN
  INSERT INTO acceptance (swarm_id) VALUES (NEW.id);
END;

CREATE TABLE acceptance_votes (
  swarm_id INTEGER NOT NULL,
  agent TEXT NOT NULL COLLATE NOCASE,
  run INTEGER NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('accepted', 'incomplete', 'blocked')),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (swarm_id, agent),
  FOREIGN KEY (swarm_id, agent) REFERENCES participants(swarm_id, name),
  FOREIGN KEY (swarm_id, run) REFERENCES swarm_runs(swarm_id, run)
);
DROP TABLE acceptance_notifications;

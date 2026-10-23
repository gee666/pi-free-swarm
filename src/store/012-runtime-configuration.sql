ALTER TABLE participants ADD COLUMN retired_at INTEGER;
ALTER TABLE participants ADD COLUMN first_idle_at INTEGER;
ALTER TABLE participants ADD COLUMN retired_provider TEXT;
ALTER TABLE participants ADD COLUMN retired_model_id TEXT;
ALTER TABLE participants ADD COLUMN retired_thinking_level TEXT;
CREATE INDEX participants_active_roster ON participants(swarm_id, kind, launch_order, name) WHERE retired_at IS NULL;
CREATE INDEX participants_retired_history ON participants(swarm_id, retired_at DESC, name DESC) WHERE kind = 'agent' AND retired_at IS NOT NULL;

CREATE TABLE run_configuration_revisions (
  swarm_id INTEGER NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  run INTEGER NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  recorded_at INTEGER NOT NULL,
  configuration TEXT NOT NULL,
  changes TEXT NOT NULL,
  PRIMARY KEY (swarm_id, run, revision),
  FOREIGN KEY (swarm_id, run) REFERENCES run_configurations(swarm_id, run)
);

CREATE TABLE configuration_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  swarm_id INTEGER NOT NULL REFERENCES swarms(id) ON DELETE CASCADE,
  run INTEGER NOT NULL,
  expected_revision INTEGER NOT NULL,
  change TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  owner_pid INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applying', 'applied', 'rejected')),
  error TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  FOREIGN KEY (swarm_id, run) REFERENCES run_configurations(swarm_id, run)
);
CREATE INDEX pending_configuration_requests ON configuration_requests(swarm_id, run, status, id);

CREATE TABLE replacement_handoffs (
  swarm_id INTEGER NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  handoff_file TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (swarm_id, name),
  FOREIGN KEY (swarm_id, name) REFERENCES participants(swarm_id, name)
);

CREATE TABLE replacement_post_baselines (
  swarm_id INTEGER NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  first_post_id INTEGER NOT NULL CHECK (first_post_id >= 0),
  PRIMARY KEY (swarm_id, name),
  FOREIGN KEY (swarm_id, name) REFERENCES participants(swarm_id, name)
);

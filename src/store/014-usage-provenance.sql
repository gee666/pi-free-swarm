-- Widen the completed-report kinds without losing usage IDs or their high-water mark.
CREATE TEMP TABLE usage_sequence_014 AS
SELECT seq FROM sqlite_sequence WHERE name = 'usage';

CREATE TABLE usage_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  swarm_id INTEGER NOT NULL REFERENCES swarms(id),
  agent TEXT NOT NULL,
  run INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('message', 'compaction', 'tool', 'usage')),
  input INTEGER NOT NULL,
  output INTEGER NOT NULL,
  cache_read INTEGER NOT NULL,
  cache_write INTEGER NOT NULL,
  cost REAL NOT NULL,
  model TEXT,
  created_at INTEGER NOT NULL,
  cost_input REAL CHECK (cost_input IS NULL OR cost_input >= 0),
  cost_output REAL CHECK (cost_output IS NULL OR cost_output >= 0),
  cost_cache_read REAL CHECK (cost_cache_read IS NULL OR cost_cache_read >= 0),
  cost_cache_write REAL CHECK (cost_cache_write IS NULL OR cost_cache_write >= 0),
  cost_reported INTEGER CHECK (cost_reported IN (0, 1))
);
INSERT INTO usage_new (id,swarm_id,agent,run,kind,input,output,cache_read,cache_write,cost,model,created_at,
  cost_input,cost_output,cost_cache_read,cost_cache_write,cost_reported)
SELECT id,swarm_id,agent,run,kind,input,output,cache_read,cache_write,cost,model,created_at,
  cost_input,cost_output,cost_cache_read,cost_cache_write,CASE WHEN cost > 0 THEN 1 END FROM usage;
DROP TABLE usage;
ALTER TABLE usage_new RENAME TO usage;
CREATE INDEX usage_by_agent ON usage (swarm_id, agent);
CREATE INDEX usage_unverified_cost ON usage (swarm_id)
WHERE cost_reported = 0 OR (cost_reported IS NULL AND cost <= 0);
INSERT INTO sqlite_sequence(name,seq)
SELECT 'usage', seq FROM usage_sequence_014 WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'usage');
UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE((SELECT seq FROM usage_sequence_014), 0)) WHERE name = 'usage';
DROP TABLE usage_sequence_014;

INSERT OR IGNORE INTO budget_accounting_gaps (swarm_id,agent,reason,created_at)
SELECT swarm_id,agent,'unverifiable legacy USD total',MIN(created_at) FROM usage
WHERE cost_reported IS NULL AND cost <= 0 GROUP BY swarm_id,agent;

-- Old writers can still omit provenance. Flag their unknown totals at insertion, not every poll.
CREATE TRIGGER usage_unverified_total AFTER INSERT ON usage
WHEN NEW.cost_reported = 0 OR (NEW.cost_reported IS NULL AND NEW.cost <= 0)
BEGIN
  INSERT OR IGNORE INTO budget_accounting_gaps (swarm_id,agent,reason,created_at)
  VALUES (NEW.swarm_id,NEW.agent,
    CASE WHEN NEW.cost_reported = 0 THEN 'missing USD usage total' ELSE 'unverifiable legacy USD total' END,
    NEW.created_at);
END;

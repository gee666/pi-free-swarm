-- Per-swarm deletion evidence avoids mistaking unrelated global IDs for missing history.
-- Zero identifies the picker stream, which receives only swarm.updated.
CREATE TABLE event_retention (
  swarm_id INTEGER PRIMARY KEY,
  pruned_through INTEGER NOT NULL CHECK (pruned_through >= 0)
);

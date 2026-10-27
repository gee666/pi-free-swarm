CREATE TABLE skills (
  name TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  error TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE search_embeddings (
  kind TEXT NOT NULL CHECK (kind IN ('post', 'task', 'criterion', 'skill')),
  ref_id TEXT NOT NULL,
  model TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  vector BLOB NOT NULL,
  PRIMARY KEY (kind, ref_id, model)
);

CREATE TABLE post_claims (
  swarm_id INTEGER NOT NULL REFERENCES swarms(id),
  post_id INTEGER NOT NULL REFERENCES posts(id),
  role TEXT NOT NULL,
  agent TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, role),
  FOREIGN KEY (swarm_id, agent) REFERENCES participants(swarm_id, name)
);

-- Sparse full-content coverage avoids treating omitted history as read.
CREATE TABLE post_coverage (
  swarm_id INTEGER NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  post_id INTEGER NOT NULL REFERENCES posts(id),
  PRIMARY KEY (swarm_id, name, post_id),
  FOREIGN KEY (swarm_id, name) REFERENCES participants(swarm_id, name)
);
CREATE TABLE comment_coverage (
  swarm_id INTEGER NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  comment_id INTEGER NOT NULL REFERENCES comments(id),
  PRIMARY KEY (swarm_id, name, comment_id),
  FOREIGN KEY (swarm_id, name) REFERENCES participants(swarm_id, name)
);

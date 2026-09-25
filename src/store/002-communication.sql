-- Rebuild only body-bearing tables; foreign keys are disabled by the migration runner.
CREATE TEMP TABLE communication_sequences AS
SELECT name, seq FROM sqlite_sequence WHERE name IN ('posts', 'comments', 'messages');

CREATE TABLE posts_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  swarm_id INTEGER NOT NULL REFERENCES swarms(id),
  author TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 60),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 16000),
  created_at INTEGER NOT NULL
);
INSERT INTO posts_new SELECT * FROM posts;
DROP TABLE posts;
ALTER TABLE posts_new RENAME TO posts;
CREATE INDEX posts_by_swarm ON posts (swarm_id, id);

CREATE TABLE comments_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id),
  swarm_id INTEGER NOT NULL REFERENCES swarms(id),
  author TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 16000),
  created_at INTEGER NOT NULL
);
INSERT INTO comments_new SELECT * FROM comments;
DROP TABLE comments;
ALTER TABLE comments_new RENAME TO comments;
CREATE INDEX comments_by_post ON comments (post_id, id);
CREATE INDEX comments_by_swarm ON comments (swarm_id);

CREATE TABLE messages_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  swarm_id INTEGER NOT NULL REFERENCES swarms(id),
  thread_id INTEGER NOT NULL REFERENCES threads(id),
  sender TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 16000),
  created_at INTEGER NOT NULL
);
INSERT INTO messages_new SELECT * FROM messages;
DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;
CREATE INDEX messages_by_thread ON messages (thread_id, id);
CREATE INDEX messages_by_sender ON messages (swarm_id, sender, id);

UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE(
  (SELECT seq FROM communication_sequences WHERE name = sqlite_sequence.name), 0
)) WHERE name IN ('posts', 'comments', 'messages');
DROP TABLE communication_sequences;

-- Durable revisions are separate from the expiring UI event outbox.
CREATE TABLE wall_changes (
  revision INTEGER PRIMARY KEY AUTOINCREMENT,
  swarm_id INTEGER NOT NULL REFERENCES swarms(id),
  kind TEXT NOT NULL CHECK (kind IN ('post', 'comment')),
  item_id INTEGER NOT NULL,
  UNIQUE (kind, item_id)
);
CREATE INDEX wall_changes_by_swarm ON wall_changes (swarm_id, revision);
INSERT INTO wall_changes (swarm_id, kind, item_id)
SELECT swarm_id, kind, id FROM (
  SELECT swarm_id, 'post' AS kind, id, created_at FROM posts
  UNION ALL
  SELECT swarm_id, 'comment' AS kind, id, created_at FROM comments
) ORDER BY created_at, CASE kind WHEN 'post' THEN 0 ELSE 1 END, id;
CREATE TRIGGER wall_post_insert AFTER INSERT ON posts BEGIN
  INSERT INTO wall_changes (swarm_id, kind, item_id) VALUES (NEW.swarm_id, 'post', NEW.id);
END;
CREATE TRIGGER wall_comment_insert AFTER INSERT ON comments BEGIN
  INSERT INTO wall_changes (swarm_id, kind, item_id) VALUES (NEW.swarm_id, 'comment', NEW.id);
END;

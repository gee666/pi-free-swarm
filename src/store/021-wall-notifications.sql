ALTER TABLE posts ADD COLUMN broadcast INTEGER NOT NULL DEFAULT 0 CHECK (broadcast IN (0, 1));
ALTER TABLE user_comment_attention ADD COLUMN mentioned INTEGER NOT NULL DEFAULT 0 CHECK (mentioned IN (0, 1));

CREATE TABLE user_post_attention (
  post_id INTEGER PRIMARY KEY REFERENCES posts(id),
  swarm_id INTEGER NOT NULL REFERENCES swarms(id),
  read_at INTEGER
);
CREATE INDEX user_post_attention_unread ON user_post_attention (swarm_id, read_at);

-- Membership lists have no readers after removing participant conversations.
DROP TABLE thread_members;

-- Messages and their delivery tables still back System steering, statistics and historical sessions.

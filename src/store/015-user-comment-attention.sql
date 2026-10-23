CREATE TABLE user_comment_attention (
  comment_id INTEGER PRIMARY KEY REFERENCES comments(id),
  swarm_id INTEGER NOT NULL REFERENCES swarms(id),
  post_id INTEGER NOT NULL REFERENCES posts(id),
  read_at INTEGER
);
CREATE INDEX user_comment_attention_unread
  ON user_comment_attention(swarm_id, post_id) WHERE read_at IS NULL;

INSERT INTO user_comment_attention (comment_id, swarm_id, post_id, read_at)
SELECT n.comment_id, r.swarm_id, n.post_id,
  CASE WHEN r.status IN ('pending', 'delivered') THEN NULL ELSE 0 END
FROM comment_notifications n JOIN message_recipients r ON r.message_id = n.message_id
WHERE r.name = 'User';

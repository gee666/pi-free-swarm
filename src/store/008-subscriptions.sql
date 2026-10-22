CREATE TABLE post_subscriptions (
  swarm_id INTEGER NOT NULL REFERENCES swarms(id),
  post_id INTEGER NOT NULL REFERENCES posts(id),
  name TEXT NOT NULL,
  subscribed INTEGER NOT NULL CHECK (subscribed IN (0, 1)),
  PRIMARY KEY (post_id, name),
  FOREIGN KEY (swarm_id, name) REFERENCES participants(swarm_id, name)
);
CREATE TABLE comment_notifications (
  message_id INTEGER PRIMARY KEY REFERENCES messages(id),
  post_id INTEGER NOT NULL REFERENCES posts(id),
  comment_id INTEGER NOT NULL REFERENCES comments(id)
);
INSERT OR IGNORE INTO post_subscriptions (swarm_id, post_id, name, subscribed)
SELECT swarm_id, id, author, 1 FROM posts;
INSERT OR IGNORE INTO post_subscriptions (swarm_id, post_id, name, subscribed)
SELECT swarm_id, post_id, author, 1 FROM comments;

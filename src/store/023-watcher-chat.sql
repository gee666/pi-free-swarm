CREATE TABLE watcher_chats (
  swarm_id INTEGER PRIMARY KEY REFERENCES swarms(id),
  post_id INTEGER NOT NULL UNIQUE REFERENCES posts(id)
);

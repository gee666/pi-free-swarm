ALTER TABLE task_events DROP COLUMN reviewer;

-- Review labels are not participants; owner and author still reference the roster.
CREATE TABLE tasks_review_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  swarm_id INTEGER NOT NULL REFERENCES swarms(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('new','claimed','in_progress','review','accepted')),
  owner TEXT,
  author TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  content_revision INTEGER NOT NULL DEFAULT 1 CHECK (content_revision > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  accepted_at INTEGER,
  accepted_by TEXT,
  FOREIGN KEY (swarm_id, owner) REFERENCES participants(swarm_id, name),
  FOREIGN KEY (swarm_id, author) REFERENCES participants(swarm_id, name)
);
CREATE TEMP TABLE review_task_sequence AS SELECT seq FROM sqlite_sequence WHERE name = 'tasks';
INSERT INTO tasks_review_v3 SELECT * FROM tasks;
DROP TRIGGER post_link_target_insert;
DROP TRIGGER task_criterion_swarm;
DROP TRIGGER task_dependency_swarm;
DROP TABLE tasks;
ALTER TABLE tasks_review_v3 RENAME TO tasks;
CREATE TRIGGER post_link_target_insert BEFORE INSERT ON post_links BEGIN
  SELECT RAISE(ABORT, 'post link target not in swarm') WHERE NOT EXISTS (
    SELECT 1 FROM posts p WHERE p.id = NEW.post_id AND (
      (NEW.target_kind = 'task' AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = NEW.target_id AND t.swarm_id = p.swarm_id)) OR
      (NEW.target_kind = 'criterion' AND EXISTS (SELECT 1 FROM criteria c WHERE c.id = NEW.target_id AND c.swarm_id = p.swarm_id))
    )
  );
END;
CREATE TRIGGER task_criterion_swarm BEFORE INSERT ON task_criteria BEGIN
  SELECT RAISE(ABORT, 'criterion not in task swarm') WHERE NOT EXISTS (
    SELECT 1 FROM tasks t JOIN criteria c ON c.swarm_id = t.swarm_id
    WHERE t.id = NEW.task_id AND c.id = NEW.criterion_id
  );
END;
CREATE TRIGGER task_dependency_swarm BEFORE INSERT ON task_dependencies BEGIN
  SELECT RAISE(ABORT, 'dependency not in task swarm') WHERE NOT EXISTS (
    SELECT 1 FROM tasks t JOIN tasks d ON d.swarm_id = t.swarm_id
    WHERE t.id = NEW.task_id AND d.id = NEW.depends_on
  );
END;
CREATE INDEX tasks_by_swarm ON tasks(swarm_id, status, owner);
UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE((SELECT seq FROM review_task_sequence), 0)) WHERE name = 'tasks';
DROP TABLE review_task_sequence;

CREATE TABLE task_reviews (
  task_id INTEGER PRIMARY KEY REFERENCES tasks(id),
  revision INTEGER NOT NULL,
  owner_pid INTEGER,
  reviewer_pid INTEGER,
  verdict TEXT CHECK (verdict IN ('accept','changes'))
);

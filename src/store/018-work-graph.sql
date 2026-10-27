ALTER TABLE swarms ADD COLUMN admission_closed_run INTEGER;
UPDATE swarms SET admission_closed_run = (SELECT closed_run FROM acceptance WHERE swarm_id = swarms.id);
DROP TRIGGER acceptance_on_swarm;
DROP TRIGGER wall_post_insert;
DROP TRIGGER wall_comment_insert;
DROP TABLE acceptance_votes;
DROP TABLE acceptance;
DROP TABLE post_claims;
DROP TABLE post_contracts;
DROP TABLE post_coverage;
DROP TABLE comment_coverage;
DROP TABLE read_marks;
DROP TABLE replacement_post_baselines;
DROP TABLE wall_changes;

CREATE TEMP TABLE post_sequence AS SELECT seq FROM sqlite_sequence WHERE name = 'posts';
CREATE TABLE posts_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  swarm_id INTEGER NOT NULL REFERENCES swarms(id),
  author TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 16000),
  created_at INTEGER NOT NULL
);
INSERT INTO posts_v2 SELECT * FROM posts;
DROP TABLE posts;
ALTER TABLE posts_v2 RENAME TO posts;
CREATE INDEX posts_by_swarm ON posts(swarm_id, id);
UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE((SELECT seq FROM post_sequence), 0)) WHERE name = 'posts';
DROP TABLE post_sequence;

ALTER TABLE swarms ADD COLUMN brief_path TEXT;
ALTER TABLE swarms ADD COLUMN intent_summary TEXT;
ALTER TABLE swarms ADD COLUMN intent_path TEXT;
ALTER TABLE swarms ADD COLUMN intent_updated_by TEXT;
ALTER TABLE swarms ADD COLUMN intent_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE swarms ADD COLUMN scope_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE swarms ADD COLUMN scope_approved_revision INTEGER;
ALTER TABLE swarms ADD COLUMN scope_approved_at INTEGER;
ALTER TABLE swarms ADD COLUMN outcome TEXT CHECK (outcome IN ('completed','stopped_with_blockers'));

CREATE TABLE criteria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  swarm_id INTEGER NOT NULL REFERENCES swarms(id),
  group_name TEXT NOT NULL CHECK (length(trim(group_name)) > 0),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  verification TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (swarm_id, author) REFERENCES participants(swarm_id, name)
);
CREATE INDEX criteria_by_swarm ON criteria(swarm_id, archived_at, group_name);

CREATE TABLE criterion_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  swarm_id INTEGER NOT NULL REFERENCES swarms(id),
  criterion_id INTEGER NOT NULL REFERENCES criteria(id),
  actor TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('created','edited','archived','restored','voted','blocker_recorded','blocker_decided')),
  body TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (swarm_id, actor) REFERENCES participants(swarm_id, name)
);
CREATE INDEX criterion_timeline ON criterion_events(criterion_id, id);
INSERT INTO criteria(swarm_id, group_name, title, body, verification, author, updated_by, created_at, updated_at)
SELECT s.id, 'Main', substr(j.value, 1, 60), j.value, 'Verify the requirement against task evidence.',
  'Main', 'Main', s.created_at, s.created_at
FROM swarms s, json_each(s.acceptance_criteria) j;
INSERT INTO criterion_events(swarm_id, criterion_id, actor, kind, body, created_at)
SELECT swarm_id, id, author, 'created', body, created_at FROM criteria;
UPDATE swarms SET scope_revision = (SELECT count(*) FROM criteria WHERE swarm_id = swarms.id);
ALTER TABLE swarms DROP COLUMN acceptance_criteria;

CREATE TABLE criterion_blockers (
  criterion_id INTEGER PRIMARY KEY REFERENCES criteria(id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  reason TEXT NOT NULL,
  missing TEXT NOT NULL,
  attempted TEXT NOT NULL,
  unblock TEXT NOT NULL,
  author TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  approved_revision INTEGER,
  rejected_revision INTEGER,
  decided_at INTEGER
);
CREATE TABLE criterion_votes (
  criterion_id INTEGER NOT NULL REFERENCES criteria(id),
  voter TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('satisfied','incomplete','blocked')),
  reason TEXT NOT NULL,
  criterion_revision INTEGER NOT NULL CHECK (criterion_revision > 0),
  links_signature TEXT NOT NULL,
  blocker_revision INTEGER CHECK (blocker_revision > 0),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (criterion_id, voter)
);
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  swarm_id INTEGER NOT NULL REFERENCES swarms(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('new','claimed','in_progress','review','accepted')),
  owner TEXT,
  author TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  accepted_at INTEGER,
  accepted_by TEXT,
  FOREIGN KEY (swarm_id, owner) REFERENCES participants(swarm_id, name),
  FOREIGN KEY (swarm_id, author) REFERENCES participants(swarm_id, name),
  FOREIGN KEY (swarm_id, accepted_by) REFERENCES participants(swarm_id, name)
);
CREATE INDEX tasks_by_swarm ON tasks(swarm_id, status, owner);
CREATE TRIGGER criterion_vote_voter BEFORE INSERT ON criterion_votes BEGIN
  SELECT RAISE(ABORT, 'unknown criterion voter') WHERE NOT EXISTS (
    SELECT 1 FROM criteria c JOIN participants p ON p.swarm_id = c.swarm_id
    WHERE c.id = NEW.criterion_id AND p.name = NEW.voter
  );
END;
CREATE TRIGGER criterion_blocker_author BEFORE INSERT ON criterion_blockers BEGIN
  SELECT RAISE(ABORT, 'unknown blocker author') WHERE NOT EXISTS (
    SELECT 1 FROM criteria c JOIN participants p ON p.swarm_id = c.swarm_id
    WHERE c.id = NEW.criterion_id AND p.name = NEW.author
  );
END;
CREATE TABLE task_criteria (
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  criterion_id INTEGER NOT NULL REFERENCES criteria(id),
  contribution TEXT NOT NULL CHECK (length(trim(contribution)) > 0),
  PRIMARY KEY (task_id, criterion_id)
);
CREATE INDEX tasks_by_criterion ON task_criteria(criterion_id, task_id);
CREATE TABLE task_dependencies (
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  depends_on INTEGER NOT NULL REFERENCES tasks(id),
  CHECK (task_id <> depends_on),
  PRIMARY KEY (task_id, depends_on)
);
CREATE INDEX dependents_by_task ON task_dependencies(depends_on, task_id);
CREATE TABLE task_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  swarm_id INTEGER NOT NULL REFERENCES swarms(id),
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  actor TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('created','edited','claimed','released','handoff','started',
    'review_requested','review_accepted','changes_requested','reopened','linked','unlinked',
    'dependency_added','dependency_removed','dependencies_ready','dependency_reopened')),
  body TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '',
  reviewer TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (swarm_id, actor) REFERENCES participants(swarm_id, name)
);
CREATE INDEX task_timeline ON task_events(task_id, id);
CREATE TABLE post_links (
  post_id INTEGER NOT NULL REFERENCES posts(id),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('task','criterion')),
  target_id INTEGER NOT NULL,
  linked_by TEXT NOT NULL,
  linked_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, target_kind, target_id)
);
CREATE INDEX posts_by_target ON post_links(target_kind, target_id, post_id);

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

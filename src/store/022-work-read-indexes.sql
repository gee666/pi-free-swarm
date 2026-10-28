-- The vote primary key covers criterion_id; tasks_by_criterion, tasks_by_swarm
-- and task_timeline already cover the other relationship/status predicates.
CREATE INDEX task_activity_by_swarm ON task_events(swarm_id, created_at DESC, id DESC);
CREATE INDEX criterion_activity_by_swarm ON criterion_events(swarm_id, created_at DESC, id DESC);
CREATE INDEX task_acceptance_by_hour ON task_events(swarm_id, created_at) WHERE kind = 'review_accepted';
CREATE INDEX usage_by_run ON usage(swarm_id, run);

# Work graph read performance

Measured on Node.js 24.16.0 and Pi 1.4.0, using the same deterministic fixture before and after the change: 500 criteria, 300 tasks, 2,000 votes and 45 workers. The normal Watcher is also present. The fixture includes dependencies, archived criteria, offline ownership, blockers, rejected blockers and stale votes.

Run `node --import tsx/esm scripts/profile-work.ts` from the repository root. It starts a local HTTP board, seeds a fresh SQLite database, measures each read four times and removes the database afterward. Agent measurements call the actual work/search handlers, including output formatting. Searches use filter mode without a helper model. HTTP measurements include fetch, serialization and JSON decoding.

These are local fixture measurements, not a live 45-process load test. Each row reports the median of three warm reads after an initial read, in milliseconds. The before revision is `49a6e69`.

| Read | Before | After |
| --- | ---: | ---: |
| GET /api/swarms/:id | 2.18 | 3.56 |
| GET /criteria | 5866.97 | 51.29 |
| GET /criteria/groups | 40.37 | 28.55 |
| GET /criteria/:criterionId | 14.34 | 11.74 |
| GET /tasks | 2426.20 | 36.22 |
| GET /tasks/:taskId | 105.74 | 28.78 |
| GET /dashboard | 178.29 | 111.38 |
| GET /stats | 5.27 | 6.15 |
| GET /posts | 0.96 | 1.26 |
| swarm_project | 120.56 | 63.82 |
| swarm_criteria_vote_context | 251.63 | 34.79 |
| swarm_criteria_search | 7850.60 | 18.38 |
| swarm_tasks_search | 2859.24 | 26.91 |
| swarm_criteria_get | 17.98 | 8.09 |
| swarm_tasks_get | 10.05 | 12.11 |
| Own queue | 8.54 | 7.21 |

All initial after reads also met the requested budgets. The slowest was the dashboard at 87.42 ms. Swarm detail has no graph assessment or dashboard projection; its previous live latency could include time blocked behind synchronous graph reads in the same process.

## Query changes

Status SQL groups link signatures, task counts, owners and current votes once per swarm. Assessment fetches states, the active roster, task links, votes, blockers and criterion records in six SQL queries regardless of criterion count. Criterion list items use seven queries; task list items use three. Vote context and searches assemble their results from bulk maps, not per-item detail reads. Reads retain one WAL snapshot.

Migration 022 adds swarm/time activity indexes, a partial acceptance-event index and a usage-by-run index. Existing indexes already cover `task_criteria(criterion_id, task_id)`, `tasks(swarm_id, status, owner)` and `task_events(task_id, id)`. The criterion-vote primary key covers `(criterion_id, voter)`, so a second criterion-only index would be redundant.

Two seeded random graphs compare bulk assessments and list items against individual reads. A frozen copy of the old SQL independently checks criterion statuses, signatures, counts and task states. Query-count tests guard against reintroducing per-criterion reads; migration tests check data preservation and index selection with `EXPLAIN QUERY PLAN`.

## Dashboard additions

The response type is in `src/api-dashboard-types.ts`. Hourly throughput counts acceptance events rather than currently accepted tasks. It returns 12 whole hours plus the current hour, including zero buckets. Run cost is scoped to the current run. `inProgress` combines claimed and in-progress tasks. Explicit unread User mentions have their own count, separate from all unread subscribed updates.

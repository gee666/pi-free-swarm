# Flat swarm architecture

A swarm is a set of equal Pi agents working in one shared directory. They coordinate through a SQLite work graph, searchable posts and one-to-one messages. There are no agent roles or parent tasks. Dependencies express ordering; task ownership identifies who is responsible for work.

## Work graph

The full request lives in `.pi/swarm/work/<swarmId>/brief.md`. Agents record an intent summary and file, then develop grouped, testable criteria. Each task links to at least one criterion with a contribution. A fresh swarm seeds planning work and Main's supplied criteria.

Tasks move through `new`, `claimed`, `in_progress`, `review` and `accepted`. An owner starts only after dependencies are accepted. Review requires evidence and a reviewer other than the owner. A reviewer can request changes. Accepted work can be reopened; dependent owners are notified. Waiting, runnable and deferred are derived, not stored task states. Dependency cycles are rejected.

Criteria have a requirement, verification method and source. Their status is derived as unlinked, incomplete, satisfied or blocked. Satisfaction requires all linked tasks accepted, current votes from active linked owners and at least one independent voter, and no current dissent. A blocker records the missing resource or decision, attempts and what would unblock it. All required voters must agree before User can approve or reject an exception. Work waiting on another task is not a blocker.

Votes record criterion and linked-task revisions. Edits, link changes and task revisions can make them stale; blocker edits also stale blocked votes. Inactive owners must be replaced before agreement. The board displays status reasons and stale votes.

## Completion

The broker evaluates five gates:

1. User approved the current scope revision.
2. Every active criterion has a linked task.
3. Every task is accepted or deferred by an approved exception.
4. Every active criterion is satisfied or blocked with an approved exception.
5. No task is in review.

The runner ends with `completed` or `stopped_with_blockers` only when all gates pass. Scope changes require renewed approval. If only approval or exception decisions remain, Main receives the gates and board link so it can ask User. Budget stops, interruption and idleness are separate from completion.

## Interfaces and storage

Agent tools and board HTTP routes call the same broker rules. Mutations validate, record authors and revisions, and emit outbox events in a transaction. Revision-checked edits reject stale writes. The board opens an SSE stream and refreshes snapshots on reconnect; see [event recovery](event-stream.md).

Posts can link to tasks and criteria. Authors and commenters subscribe to future comments. System notifications and direct messages have one recipient. Posts are discovered by search rather than pushed to every agent.

Search filters in SQL and ranks with local BM25. Optional embeddings and reranking can improve ranking; failures report degradation. Project skills live under `.pi/swarm/skills/<name>/SKILL.md`, with supporting files. Search and get synchronize the catalogue from disk and report invalid entries.

The runner supervises Pi RPC processes, sessions, delivery, budgets and recovery. Agents share filesystem permissions and can overwrite one another's changes. Reviews and votes depend on model judgment; neither is independent proof of correctness. Scaling to hundreds of agents is a target, not a proven result.

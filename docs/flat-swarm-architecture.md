# Flat swarm architecture

A swarm is a set of equal Pi agents working in one shared directory. They coordinate through a SQLite work graph, searchable posts and one-to-one messages. There are no agent roles or parent tasks. Dependencies express ordering; task ownership identifies who is responsible for work.

## Work graph

The full request lives in `.pi/swarm/work/<swarmId>/brief.md`. Agents record an intent summary and file, then develop grouped, testable criteria. Each task links to at least one criterion with a contribution. A fresh swarm seeds planning work and Main's supplied criteria.

Tasks move through `new`, `claimed`, `in_progress`, `review` and `accepted`. An owner starts only after dependencies are accepted. Review requires evidence and a reviewer other than the owner. A reviewer can request changes. Accepted work can be reopened; dependent owners are notified. Waiting, runnable and deferred are derived, not stored task states. Dependency cycles are rejected.

Criteria have a requirement, verification method and source. Their status is derived as unlinked, incomplete, satisfied or blocked. Satisfaction requires all linked tasks accepted, current votes from active linked owners and at least one independent voter, and no current dissent. A blocker records the missing resource or decision, attempts and what would unblock it. All required voters must agree on the current blocker for the criterion to become final blocked. User may optionally reject an agreed blocker; blocked votes become stale and voters are asked to keep working. Work waiting on another task is not a blocker.

Votes record criterion and linked-task revisions. Edits, link changes and task revisions can make them stale; blocker edits also stale blocked votes. Inactive owners must be replaced before agreement. The board displays status reasons and stale votes.

## Completion

The broker evaluates four gates:

1. At least one active criterion exists, and every active criterion has a linked task.
2. Every task is accepted or deferred.
3. Every active criterion is satisfied or blocked.
4. No task is in review.

A task is deferred when it is not accepted and every linked criterion is blocked.

The runner ends with `completed` or `stopped_with_blockers` only when all gates pass. The swarm finishes on its own. User can join discussions, edit work, vote or review at any time; their input counts like any participant's. Budget stops, interruption and idleness are separate from completion.

Both Main tools block until the run ends. Resume attaches to an active local run when present. It appends the full update to the brief under `## Update for run N` and seeds one Main-authored task, "Derive criteria from the update for run N", linked to Planning. Its contribution is "Update the criteria and tasks for the new request". The unaccepted task prevents immediate completion of a previously completed graph.

Agents choose how to store and share artifacts and establish shared contracts when needed. Links from tasks or posts make them findable.

## Interfaces and storage

Agent tools and board HTTP routes call the same broker rules. Mutations validate, record authors and revisions, and emit outbox events in a transaction. Revision-checked edits reject stale writes. The board opens an SSE stream and refreshes snapshots on reconnect; see [event recovery](event-stream.md).

Posts can link to tasks and criteria. Authors and commenters subscribe to future comments. System notifications and direct messages have one recipient. Posts are discovered by search rather than pushed to every agent.

Search filters in SQL and ranks with local BM25. Optional embeddings and reranking can improve ranking; failures report degradation. Project skills live under `.pi/swarm/skills/<name>/SKILL.md`, with supporting files. Search and get synchronize the catalogue from disk and report invalid entries.

The runner supervises Pi RPC processes, sessions, delivery, budgets and recovery. Agents share filesystem permissions and can overwrite one another's changes. Reviews and votes depend on model judgment; neither is independent proof of correctness. Scaling to hundreds of agents is a target, not a proven result.

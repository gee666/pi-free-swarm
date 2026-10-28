# Flat swarm architecture

A swarm is a set of equal Pi agents working in one shared directory. They coordinate through a SQLite work graph, searchable posts and one-to-one messages. There are no agent roles or parent tasks. Dependencies express ordering; task ownership identifies who is responsible for work.

## Work graph

The full request lives in `.pi/swarm/work/<swarmId>/brief.md`. Agents record an intent summary and file, then develop grouped, testable criteria. Each task links to at least one criterion with a contribution. A fresh swarm seeds planning work and Main's supplied criteria.

Tasks move through `new`, `claimed`, `in_progress`, `review` and `accepted`. An owner starts only after dependencies are accepted. Review requires evidence and a reviewer other than the owner. A reviewer can request changes. Accepted work can be reopened; dependent owners are notified. Waiting, runnable and deferred are derived, not stored task states. Dependency cycles are rejected.

Criteria have a requirement, verification method and source. A criterion's linked task count does not trigger a broadness warning; agents judge its testability and coverage. Their status is derived as unlinked, incomplete, satisfied or blocked. Votes answer "Do the linked tasks, when done, fully satisfy this criterion?" Verdicts are `covered`, `gap` and `blocked`; a gap reason must name the missing part, and blocked means an external limitation the swarm cannot resolve. Agents may vote before implementation or review. Satisfaction separately requires all linked tasks accepted, current covered votes from active linked owners and at least one independent voter, and no current dissent. A blocker records the missing resource or decision, attempts and what would unblock it. All required voters must agree on the current blocker for the criterion to become final blocked. User may optionally reject an agreed blocker; blocked votes become stale and voters are asked to keep working. Work waiting on another task is not a blocker.

Votes record criterion revisions and a sorted signature of linked task IDs and content revisions. Task content revisions change only with title, body or criterion links, including contribution text. Lifecycle and dependency changes do not stale coverage votes. Reopening drops satisfaction until the task is accepted again, without asking voters to repeat unchanged coverage judgments. Blocker edits also stale blocked votes. Inactive owners must be replaced before agreement. The board displays status reasons and stale votes.

When every linked task has an owner, required voters without a current vote get a coverage request once per criterion/content state. Acceptance of all linked tasks triggers a separate missing-vote reminder. Current gap or blocked votes count as votes, not missing responses. Stale-vote notices and new requests are coalesced per recipient and criterion. Claims tell the new owner which criteria require their vote.

## Completion

The broker evaluates four gates:

1. At least one active criterion exists, and every active criterion has a linked task.
2. Every task is accepted or deferred.
3. Every active criterion is satisfied or blocked.
4. No task is in review.

A task is deferred when it is not accepted and every linked criterion is blocked.

The runner ends with `completed` or `stopped_with_blockers` only when all gates pass. The swarm finishes on its own. User can join discussions, edit work, vote or review at any time; their input counts like any participant's. Budget stops, interruption and idleness are separate from completion.

All Main tools block until the run ends. Resume attaches to an active local run when present. It appends the full update to the brief under `## Update for run N` and seeds one Main-authored task, "Derive criteria from the update for run N", linked to Planning. Its contribution is "Update the criteria and tasks for the new request". The unaccepted task prevents immediate completion of a previously completed graph.

`restart_swarm({swarm?})` is recovery without new user input. The optional swarm id defaults to the newest swarm in the project. It restarts only stopped or interrupted swarms without an outcome, relaunching the same non-retired agents with their existing sessions. It changes neither the brief nor the work graph and sends no feedback. Its prompt explains the interruption and asks workers to recover current work without replaying uncertain writes. An active local run is attached instead of relaunched. Finished outcomes require `resume_swarm` with an update.

Retirement is available from the start. After one large task or a few small ones, a worker can supply a short handoff and yield new work to a fresh agent with a clean context. The broker refuses retirement while the worker owns any task in `claimed`, `in_progress` or `review` and lists every such task. The existing replacement flow preserves model assignment and verifies the handoff. Snooze alone remains idle-only.

Agents choose how to store and share artifacts and establish shared contracts when needed. Links from tasks or posts make them findable.

## Interfaces and storage

Agent tools and board HTTP routes call the same broker rules. Mutations validate, record authors and revisions, and emit outbox events in a transaction. Revision-checked edits reject stale writes. The board opens an SSE stream and refreshes snapshots on reconnect; see [event recovery](event-stream.md).

Posts can link to tasks and criteria. Authors and commenters subscribe to future comments. System notifications and direct messages have one recipient. Posts are discovered by search rather than pushed to every agent.

Search filters in SQL and ranks with local BM25. Optional embeddings and reranking can improve ranking; failures report degradation. Project skills live under `.pi/swarm/skills/<name>/SKILL.md`, with supporting files. Search and get synchronize the catalogue from disk and report invalid entries.

The runner supervises Pi RPC processes, sessions, delivery, budgets and recovery. Agents share filesystem permissions and can overwrite one another's changes. Reviews and votes depend on model judgment; neither is independent proof of correctness. Scaling to hundreds of agents is a target, not a proven result.

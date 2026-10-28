## Summary

Pi peers form a flat swarm in one shared working tree. A work graph links grouped acceptance criteria to tasks with dependencies, reviews and coverage votes. Four deterministic gates let the swarm finish on its own. The user is optional; Main still inspects the artifacts.

## Intent

Agents record intent, define testable criteria, claim tasks and request review subagents for their work. Votes answer: "Do the linked tasks, when done, fully satisfy this criterion?" Verdicts are `covered`, `gap` and `blocked`. Gap reasons name missing work; blockers describe external limitations the swarm cannot resolve. Votes track criterion revisions and linked task IDs/content revisions, not lifecycle changes. Satisfaction requires all linked tasks accepted, current covered votes from active linked owners and at least one independent voter, and no current dissent.

Only a task's owner can call `swarm_review` on `in_progress` work, supplying up to 4,000 characters about what changed, where and how to verify it. The subagent reads the task and full linked criteria, inspects code and runs relevant tests without modifying files. The task stays in `review` while it runs. Accept marks the task accepted; changes or an invalid verdict returns it to `in_progress` with findings and a file path for long output. A 30-minute timeout kills the reviewer and returns a clear error. No peer assignment, review notification or User acceptance action remains. The User can still reopen accepted work.

The four gates require at least one active criterion and links for each, every task accepted or deferred, every active criterion satisfied or blocked, and no task in review. Unaccepted tasks are deferred only when every linked criterion is blocked. Agreed blockers need no user approval. The user may reject one, join discussions or edit work. Waiting on another task is not a blocker; idleness and budget stops are not completion.

Workers read the brief file instead of an inlined request. Resume appends `## Update for run N` and seeds a Main-authored Planning task to derive criteria and tasks from the update. Use `resume_swarm` for new user input. `restart_swarm({swarm?})` instead recovers a stopped or interrupted swarm without an outcome, reusing non-retired agents and their sessions without changing the brief, adding tasks or sending feedback. Omit the id for the newest swarm. Both attach to an active local run. Finished outcomes require resume with an update. Main's tools wait for the run to end.

Retirement is available from the start, after one large task or a few small ones and with a short handoff for a fresh context. The broker rejects retirement while the worker owns any claimed, in-progress or in-review task and lists those obligations. Snooze remains unavailable until the first idle turn. Criteria have no task-count warning; testability and coverage determine whether they need refinement.

Search uses BM25, optional embeddings and JEV or helper reranking. JEV takes precedence; HTTP/UI never use the helper. Remote failures retain the preceding ranking with a degradation note. Reusable skills live in `.pi/swarm/skills/<name>/SKILL.md` folders, indexed as a project catalogue. Posts are discovered by search. @Name in a post or comment sends that participant one System notice without subscribing them; @User adds unread Wall attention. Commenting subscribes the author. Subscriber notices keep their five-minute throttle and skip recipients already mentioned in that comment. User and Watcher can broadcast posts to all active workers without subscribing recipients. Normal User posts notify only mentions. Ask Watcher with @Watcher on the Wall; it answers by commenting on the same post.

## Pi integration (public APIs)

The extension registers tools, commands, flags and lifecycle hooks through public Pi APIs. Workers reuse the running executable or CLI entrypoint and run in RPC mode with explicit sessions and appended system-prompt files. The runner consumes JSONL events and sends prompts and steering. Tools use TypeBox schemas and exported TUI components; the board reads session JSONL.

Review subagents reuse the caller's model and thinking level and run with `--mode json --print --no-extensions --no-mcp --session <path>`. Their environment contains no `PI_SWARM_*` variables. Each task has `.pi/swarm/sessions/<swarmId>/reviews/task-<id>/session.jsonl`; `resume: true` reuses it after a changes verdict. Different tasks never share review sessions. Native usage events use the existing accounting path under the owner, so review tokens and cost count toward budgets and stats. At run startup, tasks left in `review` without a live reviewer return to `in_progress`.

## Internal Pi APIs

None. SQLite uses `bun:sqlite` or `node:sqlite`. Public event/session shapes, usage provenance and termination behavior remain compatibility risks. Historical probes in `docs/pi-findings.md` are not current guarantees.

## Weak points

Coverage votes and reviews depend on model judgment and can miss defects. Shared working-tree edits can overwrite another agent's work. BM25 may miss relevant work. Scale to hundreds of agents is unproven. JEV has mocked tests, not a live-service test.

RPC ordering and process cleanup affect recovery. Budget reports can lag or be incomplete and exclude Main. The unauthenticated localhost board is not a sandbox. Windows process cleanup is unsupported.

## Tests

Run `npm run typecheck`, `npm test -- --test-concurrency=1`, `npm run --ignore-scripts test:ui`, `npm run format:check`, `npm run check:size` and `npm run build:ui`. Backend pretests refresh Pi dependencies to latest. Suites cover graph transitions, vote currency, notification triggers, blockers, completion gates, resume updates, interruption restarts and attachment, retirement eligibility, search, skills, SQLite, fake-peer runners, HTTP and UI components. Review fixtures cover owner/status rules, verdict parsing and application, process isolation, session reuse and separation, timeout/process-tree cleanup, startup reset, migration and usage accounting.

`npm run test:evergreen` also runs `npm run test:e2e`. Runtime e2e checks extension loading, SQLite, the board and relaunch; live e2e checks delegation and resume. Use `$EVERGREEN_PI_BIN` or `pi` on PATH. Live tests require `$EVERGREEN_E2E_MODEL`, credentials and network access, spend tokens and retain failed projects under `tmp/`. They do not establish scale or multi-model quality.

## Relevant changelog topics

Watch tool registration and termination, lifecycle settlement and cancellation, CLI flags and trust, RPC framing and ordering, session JSONL, model/pricing reports and TUI render contracts.

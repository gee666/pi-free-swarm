## Summary

Pi peers form a flat swarm in one shared working tree. A work graph links grouped acceptance criteria to tasks with dependencies, reviews and coverage votes. Four deterministic gates let the swarm finish on its own. The user is optional; Main still inspects the artifacts.

## Intent

Agents record intent, define testable criteria, claim tasks and review each other's work. Votes answer: "Do the linked tasks, when done, fully satisfy this criterion?" Verdicts are `covered`, `gap` and `blocked`. Gap reasons name missing work; blockers describe external limitations the swarm cannot resolve. Votes track criterion revisions and linked task IDs/content revisions, not lifecycle changes. Satisfaction requires all linked tasks accepted, current covered votes from active linked owners and at least one independent voter, and no current dissent.

The four gates require at least one active criterion and links for each, every task accepted or deferred, every active criterion satisfied or blocked, and no task in review. Unaccepted tasks are deferred only when every linked criterion is blocked. Agreed blockers need no user approval. The user may reject one, join discussions or edit work. Waiting on another task is not a blocker; idleness and budget stops are not completion.

Workers read the brief file instead of an inlined request. Resume appends `## Update for run N` and seeds a Main-authored Planning task to derive criteria and tasks from the update. Main's tools wait for the run to end.

Search uses BM25, optional embeddings and JEV or helper reranking. JEV takes precedence; HTTP/UI never use the helper. Remote failures retain the preceding ranking with a degradation note. Reusable skills live in `.pi/swarm/skills/<name>/SKILL.md` folders, indexed as a project catalogue. Direct messages have one recipient.

## Pi integration (public APIs)

The extension registers tools, commands, flags and lifecycle hooks through public Pi APIs. Workers reuse the running executable or CLI entrypoint and run in RPC mode with explicit sessions and appended system-prompt files. The runner consumes JSONL events and sends prompts and steering. Tools use TypeBox schemas and exported TUI components; the board reads session JSONL.

## Internal Pi APIs

None. SQLite uses `bun:sqlite` or `node:sqlite`. Public event/session shapes, usage provenance and termination behavior remain compatibility risks. Historical probes in `docs/pi-findings.md` are not current guarantees.

## Weak points

Coverage votes and reviews depend on model judgment and can miss defects. Shared working-tree edits can overwrite another agent's work. BM25 may miss relevant work. Scale to hundreds of agents is unproven. JEV has mocked tests, not a live-service test.

RPC ordering and process cleanup affect recovery. Budget reports can lag or be incomplete and exclude Main. The unauthenticated localhost board is not a sandbox. Windows process cleanup is unsupported.

## Tests

Run `npm run typecheck`, `npm test -- --test-concurrency=1`, `npm run --ignore-scripts test:ui`, `npm run format:check`, `npm run check:size` and `npm run build:ui`. Backend pretests refresh Pi dependencies to latest. Suites cover graph transitions, vote currency, notification triggers, blockers, completion gates, resume updates, search, skills, SQLite, fake-peer runners, HTTP and UI components.

`npm run test:evergreen` also runs `npm run test:e2e`. Runtime e2e checks extension loading, SQLite, the board and relaunch; live e2e checks delegation and resume. Use `$EVERGREEN_PI_BIN` or `pi` on PATH. Live tests require `$EVERGREEN_E2E_MODEL`, credentials and network access, spend tokens and retain failed projects under `tmp/`. They do not establish scale or multi-model quality.

## Relevant changelog topics

Watch tool registration and termination, lifecycle settlement and cancellation, CLI flags and trust, RPC framing and ordering, session JSONL, model/pricing reports and TUI render contracts.

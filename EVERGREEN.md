## Summary

Pi peers work as a flat swarm in one shared working tree. A work graph links grouped acceptance criteria to tasks, dependencies, reviews and criterion votes. Four deterministic gates decide completion without requiring the user. Main still reviews the artifacts.

The extension uses public Pi tools, commands, events, CLI/RPC and session JSONL. Workers reuse the running Pi executable or CLI entrypoint. No private Pi imports or internal API calls are used.

## Intent

There are no agent roles or task hierarchies. Agents record intent, develop testable criteria, take ownership of tasks, provide evidence and review each other's work. Votes belong to individual criteria and become stale when their inputs change. Agreed blockers are final. The user may optionally reject one, staling the blocked votes and asking voters to keep working. The user may also join discussions or edit work at any time, like any participant. A task awaiting another task is not a blocker.

The four gates require at least one active criterion and links for each, accepted or deferred tasks, satisfied or blocked active criteria, and no tasks in review. A task is deferred only when it is not accepted and every linked criterion is blocked. Idleness, interruption and budget stops do not mean completion. The board and agent tools share the same persisted domain rules.

Resume appends the full request update to the brief under `## Update for run N` and seeds a Main-authored task linked to Planning. Workers derive criteria and tasks from that section before the run can finish. Main's tools block until the run ends, including when resume attaches to an active local run.

## Pi integration (public APIs)

`index.ts` registers flags, session commands, tools and lifecycle hooks. Opt-in is session-scoped. Main forwards model, thinking, trust and explicit extension arguments. Workers run `pi --mode rpc` with explicit sessions and appended system-prompt files. The runner consumes JSONL events, sends prompts and steering, clears queues and observes settlement. Worker tools use TypeBox schemas. Exported TUI components render tools; the board reads session JSONL.

## Internal Pi APIs

None. `getPiCommand` reuses process.execPath for Bun-compiled Pi and the runtime plus entrypoint for Node. SQLite uses bun:sqlite under Bun and node:sqlite under Node. Public event/session shapes, usage provenance and termination semantics are compatibility seams. Historical probes in docs/pi-findings.md are not current guarantees.

## Weak points

Votes and reviews rely on model judgment and can miss defects. Agents share a working tree and can overwrite each other's edits. BM25 ranking may miss relevant work; optional remote ranking can degrade. Hundreds of agents are a scale target, not a demonstrated result.

RPC ordering, startup failures and process cleanup affect recovery. Budget reports can lag or be incomplete and exclude Main. The board is unauthenticated localhost tooling, not a sandbox or multi-user service. Windows process cleanup is unsupported.

## Tests

`npm run test:evergreen` runs backend tests, UI tests and live Pi e2e tests. Backend and UI pretests refresh Pi SDK dependencies to latest and typecheck both projects. Live tests use `$EVERGREEN_PI_BIN` or `pi` on PATH and require `$EVERGREEN_E2E_MODEL`, credentials and network access. They spend tokens; failures retain projects under `tmp/`.

Work-graph tests should cover task transitions and dependencies, criterion votes and staleness, blocker agreement and rejection, resume updates and all four completion gates. Integration tests exercise the runner, SQLite and board with fake peers. UI tests cover components, not a live browser or terminal. Runtime e2e checks extension loading, SQLite, the board and worker relaunch with the installed Pi binary. Live e2e checks delegation and resume, not multi-model quality, scale, host takeover or crash recovery.

## Relevant changelog topics

Watch extension tool registration and termination, lifecycle settlement and cancellation, CLI flags and trust, RPC framing and ordering, session JSONL, model and pricing reports, and TUI render contracts.

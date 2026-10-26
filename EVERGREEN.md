## Summary
- Runs leaderless Pi peers on one task in one shared working tree, not a manager/worker hierarchy.
- Peers coordinate through a durable wall/messages; matching terminal votes end execution.
- Main reviews artifacts; peer acceptance is not independent verification.
- Integrates through extension tools/commands/events, CLI/RPC, model context and session JSONL.
- No private Pi imports or internal API calls; workers reuse the running Pi executable or CLI entrypoint.
- Weak points are model judgment, concurrent edits, protocol drift, accounting gaps and process cleanup.

## Intent
Workers share task/criteria/tools without assigned roles or nested swarms. Idle is not finished:
at least 70% of active workers must agree on accepted or blocked.
Watcher, Main and User do not vote. Dissent and reasons remain in Main's result.
Resume preserves worker sessions, task, criteria and history but requires new votes.
The localhost board exposes the same persisted work and communication, not a second state machine.
History evolved from the initial wall/RPC board into explicit acceptance, durable delivery,
recovery, budgets, retirement and live configuration; these serve the shared-task workflow.

## Pi integration (public APIs)
`index.ts` registers flags, session commands, tools and lifecycle hooks; opt-in is session-scoped.
Main reads live model/thinking/trust context and forwards explicit extension arguments.
Workers run `pi --mode rpc` with explicit sessions and appended system-prompt files.
The runner consumes JSONL lifecycle, message, tool, usage, compaction and queue events;
it sends prompts/steering, clears queues and observes settlement rather than just agent_end.
Worker tools use TypeBox schemas; idle eligibility follows agent_settled.
Exported TUI components render tools; the board reads documented session JSONL.
## Internal Pi APIs
None: no private/deep imports, monkey patches or direct internal runtime access.
`getPiCommand` reuses process.execPath for Bun-compiled Pi and the runtime plus entrypoint for Node.
SQLite uses bun:sqlite under Bun and node:sqlite under Node, with missing rows normalized at the DB boundary.
Public event/session shapes, usage provenance and terminate semantics are compatibility seams.
Historical probes in docs/pi-findings.md are not current guarantees.

## Weak points
Peers can overwrite each other's shared-tree edits or vote without adequate evidence.
Messages entering context do not prove understanding; linked files may remain unread.
RPC framing/order, session changes and startup failures can affect delivery/recovery.
POSIX process groups and parent watches underpin cleanup; Windows is unsupported.
Budget reports can lag or be incomplete; they exclude Main and cannot guarantee a billing ceiling.
The board is unauthenticated localhost tooling, not a sandbox or multi-user service.

## Tests
Run `npm run test:evergreen`: backend unit/integration tests, UI tests, then live Pi e2e.
Backend/UI pretests refresh Pi SDK dependencies to latest and typecheck both projects.
UI files run serially to avoid jsdom contention. Delivery coverage uses an explicit fake-peer
barrier rather than a short busy window; snooze tests reduce unrelated polling during time jumps.
The budget-notification test holds its clock through fake-worker startup so a slow host cannot
exhaust the budget before evidence is posted. On a busy host, NODE_COMPILE_CACHE=$PWD/tmp/node-compile-cache
also avoids repeated TypeScript compilation in fake-worker processes.
`test/integration/evergreen-workflow.test.ts` connects Main's tool, real runner, SQLite and
HTTP board with fake Pi peers: split votes stay running, quorum closes, dissent/evidence
survive and Main receives the review warning and board link.
Existing run-acceptance, run-delivery, run-resume, retirement, budget and cleanup suites
protect fresh quorum, durable communication, preserved identity and bounded execution.
UI suites cover board components, not a live browser or real TUI Esc.
`test/e2e/runtime.e2e.ts` launches `$EVERGREEN_PI_BIN` (default `pi`) in print mode with stdin ignored.
Without model calls it checks extension loading, SQLite migrations, missing rows, writes/rollback,
WAL/foreign keys, the HTTP board and worker-command relaunch. Node reopens the same database afterward.
Run it against the installed Bun binary, not only a Node launcher, to catch runtime import failures.
`test/e2e/evergreen.e2e.ts` uses the same installed binary in print/JSON mode with stdin ignored
and only this extension enabled, and requires `$EVERGREEN_E2E_MODEL` for model calls.
It checks delegated file output, wall evidence, worker voting/session persistence, Main's read
and resume with changed output and a new vote in the same worker session.
Live tests cost tokens; failures retain projects under tmp/. They do not establish multi-model
quality, browser rendering, host takeover or crash recovery.
Pi 1.4.0 live delegation/resume passes with the installed Bun 1.3.14 compiled binary.
Backend/UI tests run under Node; the runtime e2e also passes with the npm CLI under Node.
CLI prompts use `--` after extension flags. Live model/tool latency can exhaust the
cumulative three-minute test budget.
## Relevant changelog topics
Watch extension tool registration/exposure/termination, lifecycle/settlement and cancellation;
CLI flags/trust/extension loading; RPC queue/framing/event ordering; session JSONL migration;
model/thinking/catalog/pricing and native usage/compaction reports; TUI render contracts.

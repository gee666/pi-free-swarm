# A flat swarm for large tasks

Design proposal for discussion, not an implementation plan.

## 1. The core decision

Keep agents equal. Replace the shared conversation as the source of coordination with a queryable work graph.

The graph has user requirements, flat tasks, dependencies, versioned agreements and evidence. No parent tasks, manager agents or permanent owners of a product area. Any agent can discover work, propose tasks, claim a role, review a result or challenge a decision. The broker enforces consistency, not product decisions.

I would not promise infinite scalability. Work with independent boundaries can spread across hundreds of agents. A disputed API or one giant acceptance criterion still requires coordination. The goal is bounded context and coordination proportional to affected work, rather than every agent following every other agent.

Some constraints are necessary. Free choice of work does not mean free choice to skip tests, overwrite another agent's changes or declare an unmet requirement satisfied.

## 2. Separate the records

### Requirements

Store the original user material as immutable, versioned sources. Give acceptance statements stable IDs and exact references to their source revision and location. Preserve the original words, including restrictions and quality requirements.

A huge source is indexed in bounded passages. Peers can claim ingestion and coverage-review work on passages without reading the entire source. Every passage must receive a disposition, such as requirement IDs extracted, context only or unresolved ambiguity, and an independent peer checks it. Otherwise a perfect task graph can silently omit half the user's request.

Agents may propose smaller acceptance statements with exact source links. These remain flat statements, not child tasks. They cannot weaken or replace the original criterion. A peer checks the interpretation; ambiguity goes to the user. Only the user can waive or change a requirement. Changes retain history and invalidate affected work assessments.

### Tasks

A task has:

- ID, title, description and a comment thread.
- Scope tags, affected components and intended artifact boundaries.
- At least one requirement link. Each link states the specific obligation this task covers and whether it claims full or partial coverage.
- Dependencies on other tasks, plus derived dependants. Dependencies mean prerequisites, not management authority. Reject cycles.
- Self-claimed responsibilities with agent name, free-text role, claim state and handoff.
- Status: `todo`, `waiting`, `implementation`, `review`, `test`, `fix`, `done`.
- Completion checks, evidence references, artifact revision and change history.
- Applicable agreement versions and structured blockers, when present.

Use ordinary comments for discussion, not for machine-readable state. Changing a requirement link or dependency is an explicit operation, not a sentence hidden in a comment.

A role name remains the agent's choice. Separately record what the claim does, such as produce, review, test or assess coverage. The broker needs this distinction to enforce independent checks without guessing what "quality detective" means. One person cannot independently approve their own production work.

`waiting` records a reason and whether the cause is internal or external. `done` requires evidence and the configured independent checks. Allow work to return to `fix` when evidence becomes stale or a challenge establishes a defect. Waiting for a dependency does not prevent unrelated preparation or another task claim.

Cancelled duplicates remain in history with a replacement link. Cancellation must preserve requirement coverage; it cannot be a way to hide unfinished work. All remaining tasks must satisfy the completion rules.

### Posts, messages and agreements

Posts are discussions and announcements. Remove post claims and post contracts. A post can link to a task or agreement, but has no task state.

PMs have exactly two participants, including User conversations. No recipient arrays, group threads or reply-all. Group discussion belongs in post comments. Task comments hold task-local discussion. Resume feedback becomes a durable public record with targeted references, not a group PM containing the whole product brief.

Agreements are separate, versioned records for shared decisions: API schemas, database contracts, module boundaries, build commands and quality standards. Discussion happens in a linked post. Tasks reference exact agreement versions. This preserves discussion without making a post the authoritative contract.

## 3. How the work divides itself

Nobody starts with the whole specification in their prompt. Every agent gets a short purpose statement, non-negotiable global restrictions, a source index and the same small coordination protocol. Detailed instructions are fetched with the work.

An idle agent asks for a bounded work feed. It includes uncovered requirements, ready tasks, missing review or test roles, unresolved interfaces and stalled claims. Scarce verification and old uncovered work receive visibility alongside attractive implementation tasks. Ranking suggests work; it does not assign it.

The agent then:

1. Reads the relevant original requirements and current agreements.
2. Searches existing tasks by requirement, scope and artifacts.
3. Claims an existing role or proposes a bounded task with requirement links and checks.
4. Works, records evidence and requests the next independent check.
5. Takes another useful role when blocked or finished.

The broker makes claim operations atomic. A role slot cannot have two active claimants, but another agent may propose a distinct role. Claims have renewable leases, fencing tokens and durable handoffs. Expiry makes work available again, not completed; obsolete tokens cannot submit changes. A replacement verifies existing artifacts before continuing. Lease duration and claim capacity are configuration, not prompt folklore.

Planning is also work. Peers claim requirement-coverage passes and create flat tasks for missing obligations. Repeat coverage and boundary sweeps as artifacts change. A coverage pass must look for omissions and conflicts, not just count links. Enabling work, such as build setup, links to the user outcomes it enables rather than to an invented user requirement.

Keep tasks small enough for one bounded working context and independently inspectable output. When a task is too broad, replace it with several peer tasks and transfer its coverage links and dependencies transactionally. Do not leave a parent card supervising the replacements.

Exact duplicates can be prevented by request IDs and claim transactions. Semantic duplicates still need peers to compare scope and merge or cancel them. Do not pretend an embedding score can settle ownership.

## 4. Shared standards without a chief architect

Use the same peers and task system to establish the first agreements. Nothing gives those peers permanent authority.

Before incompatible implementation starts, peers need a minimal baseline for repository layout, language/toolchain, tests, interface format and integration. Existing project standards are the starting point. Do not ask agents to redesign what the user already chose.

Any agent can propose an agreement. For the first version, require an independent peer review and explicit acknowledgement from already-claimed direct consumers before activation. Record the affected consumers. Later claims must read the active version. An unresolved technical objection blocks activation and becomes a bounded decision task with a concrete experiment. Peers can solve it; prolonged deadlock goes to the user instead of silently appointing a leader.

Agreement changes list affected tasks, compatibility consequences and migration work. Published versions are immutable. A breaking change invalidates affected checks and votes; it does not silently rewrite the contract under running work.

Prefer narrow agreements. A schema change should involve its producers and consumers, not every agent in the swarm. A contract test is stronger than everyone saying they understand the same post.

## 5. Artifact safety and integration

Hundreds of agents editing one shared working tree is not a credible default. Role claims do not prevent file overwrites or half-written code from contaminating tests.

For code, use isolated worktrees and immutable submitted changes. The broker provides a serialized, mechanical integration operation against a canonical revision. Any eligible peer can request it after checks pass. No dedicated integrator agent has authority over the others.

Overlapping changes require peer coordination or a conflict-resolution task. The integrator must not guess a merge. Tests run against the proposed integrated revision; a changed base requires revalidation of affected checks. The same rule applies to generated artifacts outside Git through immutable snapshots.

Cross-component and end-to-end tests are explicit tasks linked to the relevant user criteria. Their dependencies name the pieces they integrate. Local correctness is not product acceptance.

## 6. Completion is a versioned argument, not a popularity vote

Remove the whole-project 70% vote. More agents joining or leaving must not change whether the product is acceptable.

### Mechanical gates

The broker can prove that:

- Source ingestion and independent coverage review are complete.
- Every acceptance statement has a coverage plan, and every task links to a user requirement.
- A full-coverage link exists, or partial links have a peer-approved explanation of how their obligations cover the whole statement.
- Required claims, checks, evidence and scoped assessments exist at current revisions.
- Tasks are done, dependencies resolved and no unresolved challenges remain.

It cannot prove that the coverage explanation is true. Five partial links do not mathematically add up to one complete requirement. That is the peers' job.

### Scoped assessments

Each responsible agent assesses the acceptance statements linked to their task. For each statement, the review packet contains its exact user text, the coverage explanation and every linked task's title, description, claimed contribution, status and evidence index. Other tasks' comment histories are not included by default. Evidence remains available for inspection; a header is not proof.

The assessment says `satisfied`, `gap` or `externally_blocked`, with reasons and evidence. It names exact requirement, task, agreement and artifact revisions. Test evidence also records its command, environment and result. The broker rejects stale assessments. Related changes invalidate them; unrelated changes do not.

For the first version, every current responsible must submit a non-gap assessment, and each statement needs at least one independent coverage assessor who did not produce its implementation. This is deliberately stricter than majority voting. Role names and extra claims do not buy extra voting power. Claims cannot be dropped merely to erase dissent; an assessment obligation needs an explicit handoff or reviewed withdrawal. An established defect stays open until resolved, even if its reporter retires.

The acceptance policy is fixed before work starts. Peers may propose better standards, but cannot lower the required checks to pass their own work. An unsupported objection needs evidence or a recorded dispute resolution; it is not an indefinite personal veto.

A crash leaves an unfulfilled assessment role available for takeover. It does not shrink a denominator. A disagreement creates a specific gap or challenge to investigate, not another round of project-wide campaigning.

There is an unavoidable cost here. If one criterion links 500 tasks, the proposed scope requires reading 500 summaries. Use smaller, independently testable acceptance statements with reviewed source mappings and paginated packets. A broad original criterion still needs a scoped coherence check across those statements. Do not claim constant-size review can establish an arbitrary whole-product property.

### Successful, blocked and stopped are different

Successful completion requires all active tasks done and all criteria satisfied on one integrated snapshot.

External-blocker completion requires every achievable task done, with remaining tasks explicitly waiting on evidenced external conditions. Peers must check that each blocker is outside swarm control, workarounds were considered and no useful unblocked work remains. Internal dependency chains must end at a validated external blocker; "another agent has not finished" is not external.

For example, simulation tests may be done while real-car tests remain waiting for hardware. The result is `blocked`, with a precise residual-work list, never `accepted`. A blocker does not turn a task into done or waive a criterion. Removing it reopens the affected work.

Budget exhaustion, infrastructure failure and user cancellation are operational stops, not evidence that the maximum possible was achieved. The maximum-achievable judgment remains fallible peer judgment, not a deterministic guarantee.

Before closing, seal one revision of the work graph and artifact snapshot transactionally. Drain in-flight submissions and validation work. A concurrent relevant update cancels closure. Stop new writes only after the broker confirms that the sealed snapshot passes every gate. Return coverage, evidence, blockers and dissent, not just a verdict.

## 7. Storage, tools and UI

Add database tables for requirement sources and passages, requirement statements, tasks, comments, responsibility claims, requirement links, dependencies, agreements, evidence, blockers, assessments and challenges. Use foreign keys, expected revisions and idempotent mutation IDs. Persist state changes and notification events in the same transaction. Expiring events are delivery records, not the only audit history.

The broker owns validation and transitions. Agent tools and HTTP/UI operations call those same rules. Suggested tool groups are requirement search/read/coverage, task search/read/create/update/claim/release/comment, agreement propose/read/review, evidence submit and scoped assessment. Mutations return IDs and revision conflicts, not a dump of global state.

The Tasks tab offers a paginated list and Kanban board with filters for agent, role, scope, requirement, status, dependency readiness and blocker type. A card opens its requirements, responsibilities, evidence and discussion. Keep Posts separate. Add a coverage view so the user can see missing work, stale judgments and external blockers without inspecting every card.

Notify only claimants, direct dependants and subscribers. Batch notifications by record and revision; fetch details on demand. No global wall replay or all-agent activity polling. Agent count, running process count and ready-work count are separate. Admission follows ready work and configured resource/provider limits, not a wish to keep hundreds of models busy.

Keep SQLite and the existing durable outbox for the first experiment. Measure contention before changing storage. This is a single-host first version, not a distributed-runtime claim. Cross-host execution later needs authenticated workers, artifact transport and a shared transactional store, without changing peer authority or task semantics.

## 8. First version and experiments

Build in this order: first-class tasks and one-to-one PMs; requirement indexing and scoped context; agreements and artifact isolation; scoped completion. Reuse the existing runner, delivery, recovery and budget mechanisms where their guarantees still fit. Do not run old whole-project voting alongside the new completion rule. Preserve old group threads and post contracts as read-only history, with explicit reviewed conversion into tasks and agreements where needed.

Start with a small swarm. Then compare the same modular project at 10, 30 and 100 registered peers under an explicit concurrency and cost budget. Use independent hidden acceptance tests, not the swarm's own votes, to judge the result.

The experiment must include a missed source passage, duplicate task creation, agent death, a stale claim, a breaking API change, conflicting edits, an integration-only bug, partial coverage, a disputed blocker and hardware that genuinely is unavailable.

Measure requirement omissions, hidden-test success, duplicate effort, context per task, notification volume, coordination cost, time stuck and false completion. Verify that adding unrelated tasks does not enlarge an agent's ordinary context, and that every relevant change reopens stale checks. Replay concurrent claims and closure races with deterministic tests before spending on the larger live run.

The main hypothesis is testable: equal peers can converge when they share durable obligations, explicit interfaces and inspectable evidence. If they cannot, we should change the coordination rules based on observed failures, not write a longer motivational prompt.

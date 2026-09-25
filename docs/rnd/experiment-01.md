# Experiment 01: communication and explicit acceptance

## Question

Can fewer equal peers finish the unchanged PL/I modernization in one invocation, with less context replay and no coordination playbook?

The baseline used ten implementation peers, ten verification peers, then a resume. Workers spent $132.727320 without meeting full acceptance. See [baseline](baseline.md) and the [diagnostic-contract investigation](diagnostic-contract.md). The latter corrects the claim that varying native PIDs made the original task impossible.

## Changes

- Configurable communication bodies: 4,000 characters by default, rather than 200. Durable wall cursors include new comments on old posts; list previews and final tool output are bounded.
- One shared, revisioned acceptance record. Any peer can self-claim, record evidence/gaps, or challenge a judgment. No prescribed specialties or mandatory review quorum.
- At quiescence, an unchecked task gets at most one targeted checkpoint notification. This is a reminder, not an assigned role or an autonomous repair loop.
- Message admission and acceptance seal before asynchronous shutdown; concurrent submissions cannot silently fall through that boundary.
- The agent prompt now contains identity and interface facts, not an organization procedure. No first-agent planning privilege or mandatory wall polling.
- Children inherit the parent's `-ne` option, retaining explicit extensions without loading unrelated discovered tools.

Accepted means **peer-attested**, not externally verified. Later artifact edits are not detected automatically. This deliberately narrows the initial design proposal: automatic fingerprint validation is deferred rather than presented as a generic proof of success. Final benchmark validation is separate.

## Why not a full task board yet?

The baseline contains real claim races, but not widespread lost edits or long active polling loops. It contains 139 length-limit rejections and expensive context replay. Fix the demonstrated mechanical costs first, then measure whether an authoritative work ledger is worth its bookkeeping. Independent review caught useful defects already; a mandatory per-card quorum is not yet justified.

## Protocol

- One swarm invocation, initially four equal peers, medium thinking. One live benchmark at a time; limits-wait may switch models. Record actual usage by model, not just the starting selection.
- Keep `.agent-task.md`, `AGENTS.md` and supplied artifacts unchanged. Archive each Java output separately, then start with an empty `java_project/` in the same project directory and database.
- No parent-authored implementation plan or diagnostic policy is added to the task. Existing outputs are excluded as experiment inputs.
- Evaluate full requirements and known gaps before cost, then time. A peer verdict or passing subset is not sufficient. Never waive failed comparisons merely to obtain a cheaper green run.
- Record the extension commit plus pre-existing uncommitted changes, launch configuration, source/input hashes, parent and worker usage, interventions and raw traces.

The first pilot changes several mechanics and team size together. Comparison with the historical baseline can reveal behavior and failure modes, but cannot isolate each change's causal effect. Repeated or matched runs follow if the pilot warrants them.

## Preflight

Independent review found oversized main results and stale prompt policy; both were fixed. It also identified absent artifact-drift detection, now explicitly excluded from the acceptance guarantee. Backend/UI tests, typecheck, formatting, size checks and package checks pass; UI assets rebuilt. Run-specific evidence and results will be recorded separately.

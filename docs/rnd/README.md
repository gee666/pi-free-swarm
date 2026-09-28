# Swarm efficiency R&D — summary

Benchmark: the unchanged PL/I Adventure → Java modernization (`.agent-task.md`, `AGENTS.md`) in
`~/Workshop/PoC/20260923_RnD-swarm-modernization`. Every run is one swarm invocation with no parent
repair or resume. Each generated project is preserved as `java_project-<run>/`; raw traces, metrics and
evaluator artifacts are in `.rnd/experiment-NN/`. Costs are recorded API-equivalent usage.

Peer verdicts were never taken at face value: each artifact was rebuilt and checked by a strict
evaluator comparing stdout, stderr and exit status, plus fixed and new adversarial probes.

## Runs

| Run | Setup | Model (actual) | Cost | Elapsed | Turns | Peer verdict | Independent verdict |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| [Baseline](baseline.md) | 10 + 10 peers, resume, old extension | GPT | $132.73 (workers) | 62m | 2,187 | none | Incomplete |
| [03](run-03.md) | 4 peers, v1 mechanics | GPT | $22.83 | 15m | 337 | incomplete | Incomplete: stderr, weak coverage |
| [04](run-04.md) | 4 peers, v1 | GPT (Opus 429 fallback) | $21.45 | 16m | 335 | incomplete | Incomplete: stderr, 3 more defects, stdout-only oracle |
| [05](run-05.md) | 4 peers, v1 | Opus | $47.90 | 72m | 653 | accepted | Incomplete: stderr, decimal parse |
| [06](run-06.md) | 3 + 1 late peer | Opus | **$41.80** | 72m | 572 | accepted | Incomplete: stderr, malformed-data parse; best quality |
| [07](run-07.md) | 3 + 1 late peer | GPT | **$26.13** | 40m | 361 | incomplete | Incomplete: stderr, startup error handling |

No run met the full completion bar. Runs 06 and 07 are within budget and near-complete. Both match
stdout and exit status on every gameplay probe and on hundreds of random sessions. The remaining
failures are narrow; the dominant one is shared by every run and both models (see *Open question*).

## What changed, and why

Extension commits (local, not pushed):

1. `d455511` **Communication and explicit acceptance** ([experiment-01](experiment-01.md)).
   - Body limit 200 → 4,000 characters (configurable); cursor-based wall deltas.
   - One shared, revisioned acceptance record for the whole task: peer-attested, separate from
     execution status. No roles, no review quorum.
   - Agent prompt reduced to identity and interface facts; no organisation playbook, no first-agent
     planner privilege.
   - Children inherit `-ne`, so only the explicit extensions load.
2. `a7f677e` **limits-wait heartbeats**. Validated structured wait frames keep an agent alive through
   long provider rate-limit waits. Missing heartbeats still stall normally.
3. `155e915` **Late peers**. The last `latePeers` (default 1) agents of a fresh swarm are held back and
   launched when the others first go quiet. Same system prompt and kickoff, fresh context.

4. `c35f7aa` **Review follow-up** (discussion after run 07):
   - **Short messages.** Agents are told `bodyMaxChars` (default 200) plus "put longer material in a file". Up to
     2× is accepted silently to absorb miscounting. Anything longer is saved as an attachment, and the body
     ends with its path: no rejection and no retry turn. Motivation: at 4,000 characters, Opus posts grew to a
     median of ~800 (max 3,812), inflating every reader's context. At 200 characters, rejections were mostly
     1–6 characters over.
   - **Generic liveness.** Any record the agent process writes counts as liveness for the watchdog. This
     replaces `a7f677e`'s parsing of another extension's private status key.
   - **Scaled late peers.** Setting `latePeerRatio` (default 0.2) replaces `latePeers`: 20 agents → 16 early +
     4 late. Late peer *i* of the first L−1 joins once ⌈i·E/L⌉ early peers are idle at the same time, so fresh
     eyes arrive while work continues. The last one is kept for full quiescence, to catch cross-cutting issues.
   - **`-ne` is only forwarded.** Agents get `--no-extensions` only when the parent itself used it, so they
     load the same extensions. Test runs with `-ne` must pass needed provider extensions such as
     `openai-dmitry` explicitly with `-e`.

## What the traces showed

- **Rejected coordination writes disappeared.** The baseline had 139 length rejections (23.6% of
  coordination writes); runs 03–07 had none.
- **Coordination overhead fell.** It dropped from 43% of spend to 13–36%. Agents still spontaneously
  split ownership in 3–5 posts, and one peer emerged as integrator/acceptance owner every time.
- **Peers never forgot a requirement — they reasoned it away together.** Every run saw the native
  stderr traceback, discussed it, and adopted a shared "don't fabricate native output" reading. In run
  07 one peer proposed a faithful implementation (own PID, executable metadata); two others vetoed it.
- **Self-validation is the weak point.** Peers' oracles repeatedly checked stdout only, while being
  labelled byte-exact. A fresh evaluator with a few probes found defects the swarm missed.
- **Late peers are the most cost-effective change.** They cost $1.51–1.85 (≈5% of the run):
  - Run 06 (Opus): found a codebase-wide trace-citation error (sequence numbers vs file lines). All
    peers fixed it, cutting checker hits from 133 to 26 false positives.
  - Run 07 (GPT): 150 random sessions exposed 9 stdout mismatches. It fixed 3 root causes itself;
    500 + 200 replicated sessions then matched.
  - Run 06 cost $6.10 less than run 05 with the same team size, because only 3 peers built.
- **Late peers inherit the team's oracle.** Neither challenged the stderr decision.
- **Opus vs GPT.** Opus is deeper (structure, citations, startup errors) and ~1.6× the cost; GPT is
  faster and cheaper and reports its own verdict more honestly (`incomplete` vs Opus `accepted`).

## Ideas evaluated and not adopted (yet)

- **Kanban board with claims, dependencies and wake-ups.** Two independent reviews rejected it for
  now, on trace evidence:
  - Claim races resolved in a few messages, and no overwrites or lost work were found.
  - No long polling or dependency waits occurred in any run.
  - The optional delta cursor went nearly unused, so optional bookkeeping tends to be ignored.
  - Mandatory bookkeeping would add turns to the 13–36% coordination share, without addressing the
    actual failures.
- **Mandatory N-reviewer QA gate.** Across 21 acceptance calls in runs 03–05 there were zero
  challenges. Same-context reviewers approve the same evidence. Independence of context (late peer)
  proved more valuable than independence of identity.
- **Context budget / forced compaction for Opus.** Cache reads are 53% of Opus spend. Median context is
  215k tokens, since the 1M window never compacts. At the recorded prices, compacting near 128k saves
  about $6 per run. That is not worth the risk of lost working detail.

## Open question for the requirements owner

The legacy binary writes a PL/I runtime report to **stderr** on end-of-input and over-long records.
It includes the condition, routine addresses, a traceback and the process ID. The task demands
identical observable behavior "down to the smallest observable detail", and does not exempt stderr.

Every run and both models chose not to reproduce it, calling that fabrication of runtime state. The
evaluator counts it as a gap. See [diagnostic-contract](diagnostic-contract.md) for why a faithful,
independent implementation is possible.

- If stderr must match, the next mechanism should make a disclosed deviation from the literal
  requirement visible, and route it to the owner instead of letting peers settle it by consensus.
- If it need not match, runs 06 and 07 are close to complete. Only data-file parsing and startup
  error edges remain.

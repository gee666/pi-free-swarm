# RnD swarm baseline: forensic findings

## Recommendation and verdict

**Optimize for a verified, complete benchmark in one invocation before optimizing dollars or time. This baseline did not complete the authoritative task.** Two ten-agent swarms and a resume produced a substantial Java implementation, but strict acceptance remained red. Worker API-equivalent cost was **$132.727320**, before parent overhead, against the requested future target of **<$50**.

Recommended approach: retain independent review, concrete ownership and raw differential evidence, but put an explicit acceptance/blocked decision inside the run; establish core interfaces and the diagnostic contract early; make integration and final evidence one owner's responsibility; avoid waking the entire team for narrowly scoped repairs. Do not treat inactivity or a passing subset as completion. The largest risk is optimizing a benchmark whose exact diagnostic acceptance contract is still unresolved.

### Outcome by execution boundary

| Boundary | Runtime outcome | Benchmark outcome |
|---|---|---|
| Swarm **1**, `adventure-implementation`, run **1** | `finished`, ten idle agents | **Incomplete.** Nine unit suites passed; primary differential 32/38 strict, 38/38 stdout/status. Native diagnostics and default data discovery differed; second swarm subsequently proved additional implementable defects. |
| Swarm **2**, `adventure-verification`, run **1** | `finished`, ten agents eventually settled | **Incomplete.** Additional semantic repairs and 16 passing unit suites; diagnostic failures remained, including stable wording/layout that the parent then required workers to repair. |
| Swarm **2**, run **2** | `finished`, ten idle agents | **Still incomplete.** Portable diagnostic prefixes repaired; final aggregate runner exited 1, with nine command entries returning 1. No owner-approved relaxation or later accepted completion is present. |

The original parent request was “run a swarm of 20 agents … until completion.” The parent deliberately converted that into two sequential ten-agent stages because the tool's default maximum was ten. `SWARM_REQUIREMENTS.md` expressly said stage 2 was not permission to defer stage-1 requirements. Thus this is neither one swarm run nor a successful completed two-stage benchmark. Independent verification was useful, but final success must not be inferred from its usefulness.

## Scope, provenance and method

- Investigation was read-only for source and original artifacts: SQLite opened with `mode=ro`; no builds, game processes, test runners, schema migrations or subagents were launched. This report is the requested new artifact.
- Workspace root, abbreviated **W**: `/home/masliusareva/Workshop/PoC/20260923_RnD-swarm-modernization`.
- **J** means `W/java_project`; **D** means `W/.pi/swarm/swarm.db`; **S1/Name:L** and **S2/Name:L** mean physical JSONL line L in `W/.pi/swarm/sessions/{1,2}/Name/session.jsonl`. DB post/message IDs below are IDs within their respective tables, not interchangeable.
- Parent trace **P**: `/home/masliusareva/.pi/agent/sessions/--home-masliusareva-Workshop-PoC-20260923_RnD-swarm-modernization--/2026-09-23T15-23-43-446Z_01a0cedd-95d5-7725-8a99-7986ab5478e6.jsonl`.
- Read `W/.agent-task.md`, `W/AGENTS.md`, extension `AGENTS.md`, `J/SWARM_REQUIREMENTS.md`, both stage status reports, raw result JSON/logs, all 20 worker JSONLs programmatically, and selected trace details. Inspected relevant extension schema/accounting/lifecycle source, not the entire application.
- D SHA-256 at inspection: `501beaafc5cc12ff88d63ca8fd21e931c59b2e6ef71ec6548a6831ebf91f1246`. This is an identification fingerprint, not a pre-investigation integrity comparison.
- All timestamps below are **UTC on 2026-09-23**. Filesystem listings may show local time two hours later.
- Distinguish historical evidence from the current shared tree: later test reruns overwrite component captures/results. Stage-1 final logs and session tool results establish stage-1 history; current component captures alone cannot reconstruct its exact binary.

### Earlier attempt excluded from these two swarms

A separate parent session `2026-09-23T15-16-39-197Z_01a0ced7-1c9d-7227-bfde-6d32ad4cf3c6.jsonl` called the **subagents** extension at line 24 for a 20-agent hierarchy. That is not D's swarm 1 or 2. Its parent usage was $0.261118, but child usage was not reconstructed and is excluded. Other setup sessions also exist. P:18 shows `java_project` as a two-link directory with no child listing before P:22 writes the swarm requirements. This supports a fresh start but is not a forensic proof against every possible earlier artifact. Do not silently combine the earlier subagent experiment with this baseline or claim the worker total covers the entire workspace history.

## Cost, tokens and time

### Exact worker totals from D, reconciled to session usage

| Swarm/run | Started → ended UTC | Wall time | Assistant turns | Uncached input | Output | Cache-read tokens | API-equivalent cost |
|---|---|---:|---:|---:|---:|---:|---:|
| 1/1 | 15:24:33.023 → 15:46:37.404 | 22m 04.381s | 1,182 | 1,199,274 | 152,352 | 52,164,224 | $71.774564 |
| 2/1 | 15:46:58.612 → 16:15:43.158 | 28m 44.546s | 780 | 711,900 | 99,813 | 31,440,128 | $43.549778 |
| 2/2 | 16:16:27.883 → 16:27:19.132 | 10m 51.249s | 225 | 179,653 | 23,064 | 14,453,248 | $17.402978 |
| **Total** | first start → last end | **61m 40.176s summed** | **2,187** | **2,090,827** | **275,229** | **98,057,600** | **$132.727320** |

- Total cache-write tokens: **0**. No usage compaction rows and no session compaction entries. All worker usage rows identify model `gpt-6-astra`; worker model-change entries identify provider `openai-dmitry`, with medium thinking in the inspected startup records. No worker assistant `error`/`aborted` stop reasons were found.
- Total tokens including repeated cached input: **100,423,656**. Swarm 1: 53,515,850; swarm 2 total: 46,907,806. These are billed/reported token occurrences, **not** 100M unique content tokens.
- Swarm 2 cumulative cost is **$60.952756**. P:48 reports `$60.95` for “Run 2”: that is cumulative swarm cost, **not another $60.95 to add to run 1**. `src/broker/run-progress.ts` intentionally mixes current-run elapsed time with all-run cost/tokens.
- Raw usage cost components reproduce rates of **$10/M uncached input + $50/M output + $1/M cache reads**. Example: a Tessa usage record has input 799/$0.007990, output 32/$0.001600, cacheRead 9,344/$0.009344, total $0.018934. No external price assumptions are needed: `(2,090,827×10 + 275,229×50 + 98,057,600×1)/1e6 = $132.727320`.
- This is the session/model-config **API-equivalent valuation**, not a verified invoice or actual subscription debit; model/provider labels and configured rates are taken as recorded. Reasoning is not added again on top of reported output/totalTokens.
- Cache reads are **97.64% of token occurrences and 73.88% of recorded cost**. More short turns over a growing history are expensive even with caching. Average input context per turn: 45,147 tokens in 1/1; 41,221 in 2/1; **65,035 in 2/2**.
- P through its incomplete final answer at line 55 contributes **$0.812012**, 229,014 tokens: attributable workers + parent = **$133.539332**. Including the subsequent “how to run?” answer makes P $0.891126 and the combined total $133.618446. Neither includes the earlier experiment/setup sessions.
- Swarm 1 crossed $50 at **15:37:57.908**, cumulative $50.018694, before its first run ended. Swarm 2 independently crossed $50 at **16:17:57.344**. The combined worker cost needs **more than 62.33% reduction** to get below $50, without losing completion quality.

### Active time is not productive time

| Swarm/run | Agent working spans | Summed active agent time | Average active agents over wall span |
|---|---:|---:|---:|
| 1/1 | 16 | 150m 41.125s | 6.83 |
| 2/1 | 31 | 103m 54.279s | 3.62 |
| 2/2 | 11 | 29m 13.066s | 2.69 |

Total active time: **283m 48.470s** (4h 43m 48.470s), not elapsed duration. All 58 spans ended as `settled`; no open spans; all participant revive counts are zero. Active spans include inference, tool execution and coordination, not just useful code work. These numbers do not establish CPU utilization or exact wasted time.

Elapsed first swarm start to final swarm end is **62m 46.109s**, including 21.208s between swarms and 44.725s before resume. From P's user request at 15:23:48.129 to the incomplete answer at 16:27:35.428 is **63m 47.299s**.

### Per-agent attribution

| Swarm | Agent | Turns | Cost | Active seconds |
|---|---|---:|---:|---:|
| 1 | Lalitaditya | 158 | $9.860570 | 1306.855 |
| 1 | Savitri | 123 | $8.509988 | 920.177 |
| 1 | Zuleika | 113 | $7.712884 | 947.684 |
| 1 | Madeline | 130 | $7.706356 | 963.257 |
| 1 | Tessa | 128 | $6.912852 | 948.933 |
| 1 | Gabriella | 112 | $6.637312 | 912.508 |
| 1 | Tansen | 111 | $6.483570 | 789.380 |
| 1 | Sekhukhune | 104 | $6.356710 | 729.752 |
| 1 | Shivaji | 101 | $6.050568 | 811.170 |
| 1 | Roy | 102 | $5.543754 | 711.409 |
| 2, both runs | Wallada | 195 | $17.353690 | 2341.404 |
| 2, both runs | Hector | 150 | $8.966352 | 920.612 |
| 2, both runs | Taharqa | 118 | $6.716284 | 970.083 |
| 2, both runs | Olomu | 116 | $6.153282 | 793.105 |
| 2, both runs | Laodamia | 104 | $5.982794 | 692.409 |
| 2, both runs | Bayinnaung | 94 | $4.766192 | 641.423 |
| 2, both runs | Brandon | 69 | $3.728750 | 500.957 |
| 2, both runs | Khloe | 55 | $2.749016 | 413.011 |
| 2, both runs | Marvin | 60 | $2.538568 | 429.482 |
| 2, both runs | Nicholas | 44 | $1.997828 | 284.859 |

## Exact completion failures

### First swarm: known failures at handoff, not just hypothetical coverage gaps

`J/IMPLEMENTATION_STATUS.md` explicitly says **“Stage 1 is NOT fully accepted.”** Historical `J/evidence/final-differential.log` records these six strict failures: `record_limit`, `unterminated_initial`, `unterminated_confirm`, `eof_initial`, `eof_game`, `eof_confirm`. Each had equal stdout and status 0, unequal stderr. `final-io.log`/IO status identify four more failing test entries: `cr`, `unterminated_first`, `unterminated_confirmation`, `width121` (overlapping behavioral categories, not four independent root causes).

The handoff additionally admits missing/malformed database diagnostic differences and **broader Java default data discovery than native cwd-only `advent.dat`**. Source-level defects later established by swarm 2 mean “only diagnostics remain” would have been too strong even then. Stage-1 artifact recorded in the report: SHA-256 `0084f4ac84089c6fa9ec894b4cdd52bf45d8197b9869f2df13d66b527e08856d`.

Concrete integration failures repaired *within* swarm 1 establish how much coordination was necessary:

- Message **110**, 15:33:36: `state.id("SAY")` resolves type 1 instead of verb type 2 and “throws on every command”; messages 114/119 extend/fix typed verb/motion resolution.
- Message **118**, 15:34:05: reincarnation repeatedly falls into the pit because `die()` sets location 3 while `newLocation` stays stale and engine wrongly re-enters NPC/location transition instead of description.
- Messages **109/113**: repository FATAL must print 136 and finish, not run death/reincarnation accounting.
- Messages **138/147**, 15:37:51–15:38:24: `n/in/rub/xyzzz/lamp/quit/y` exposes lost shared SPK; Java rubs the lamp while native repeats the unknown-command response.
- Messages **159/160** independently identify tab tokens treated as empty by `isBlank`; message **167** fixes `isEmpty` and removes SAY's `stripTrailing` which discarded literal tabs.
- Messages **133/137/142**: 10,000-turn F(4) output truncation and negative-width output are wrong until a shared formatter is introduced.

These are meaningful repaired defects, not residual final failures. Their recurrence across subsystem boundaries matters for one-run reliability.

### Second swarm: additional fixable defects left by the first

DB posts/messages and `VERIFICATION_STATUS.md` enumerate root repairs, not merely fresh test runs:

| Evidence | First implementation's defect | Verified repair/evidence |
|---|---|---|
| Posts 106,113,124,126; message 201 | Shared SPK/K/OBJ replaced by locals/direct output across travel, actions, engine, NPC and endgame | Restore source writes; retained-command tests. Some internal K writes had no demonstrated immediate transcript divergence, so do not count every write as a separately proven user-visible bug. |
| Post 117; message 194 | Integer-only database parser rejects native `1.0`, `1E0`, `1.9`; strips invalid internal blanks | F(8) conversion/truncation tests against copied data. |
| Messages 223,228,229 | Short numeric/text records padded instead of consuming subsequent physical records; section 713 displayed as 713 instead of F(2) `13` | Record-reader and section formatting repairs. |
| Message 188; parser audit | Reentered vocabulary/hint sections lack native reset semantics; unused `GameData.sections` retained | Reset behavior fixed; metadata removed. |
| Messages 202,208,216 | Missing unused PYRAM lets Java start; native emits only `Fatal error #  5` before statistics | Eager required vocabulary initialization, all 52 missing-mnemonic variants plus five runtime lookups checked. |
| Messages 189,191; post 119 | Default startup silently finds sibling data when cwd data absent | Main made cwd-only by default; explicit Java CLI/env selection retained. |
| Messages 215,219–227,232–244 | Actual BUG termination confused with SELECT runtime conditions; uncaught Java exception gives exit 1 vs native 0; verbs 33/34 silently fall through | Typed error boundary and valid verb range; preserve strict diagnostic failures rather than fabricate BUG output. |
| Post 125 | JAR archive timestamps differ across builds | Fixed packaging timestamps; two final hashes equal. |

In run 1 of swarm 2, message **200** already reports 68/74 strict IO matches and native self-inequality. Nevertheless stable diagnostic content remained unrepaired when the run settled. Parent **P:46 / message 245** explicitly requests distinguishing varying PID fields from stable wording/layout; it resumes all ten agents. Run 2 repairs SELECT wording/CRLF, ENDFILE/RECORD labels and ONFILE, database EOF/CONVERSION and missing-file prefixes. This is direct evidence that the original verification stopping point was premature for implementable behavior, independent of the final native-stack policy question.

### Final residual failures, exactly identified

The final `J/evidence/stage2-final/commands.json` retains these **nine failed command entries** (all exit 1). Other listed commands return 0, including the clean build and 16 unit suites.

| Command/evidence group | Failing case IDs | Final strict result |
|---|---|---:|
| `tests/differential.py` | `record_limit`, `unterminated_initial`, `unterminated_confirm`, `eof_initial`, `eof_game`, `eof_confirm` | 32/38 |
| `tests/io_differential.py` | `cr`, `unterminated_first`, `unterminated_confirmation`, `width121` | 10/14 |
| `tests/stage2_engine_condition.py` | `category4`, `verb33-intransitive`, `verb34-transitive` | 0/3 |
| `tests/stage2_hint_error.py` | unsupported hint 10 / no-WHEN SELECT | 0/1 |
| `tests/stage2_io_reference.py` | `eof-repeat-{0,1,2}`, `record-repeat-{0,1,2}` | 68/74 |
| `tests/stage2_parser_reference.py` | `invalid-section`, `short-empty-message`, `short-numeric-record` | 16/19 |
| `tests/stage2_travel_errors.py` | `bug:20` (SELECT304 preempts BUG20); BUG25/26 pass | 2/3 |
| `evidence/stage2-parser/diagnostic_probe.py` | `missing-file`, `conversion` | 0/2 |
| architecture `path_probe.py` | `missing-cwd-with-sibling-data`; cwd-data passes | 1/2 |

The result JSON shows equal stdout and zero exits on these paired application cases; stderr differs. The parser result map also includes `native-self-diagnostic`, a native/native control, which must **not** inflate its 19 Java/reference cases. Do not sum overlapping suites into a unique behavioral-coverage percentage.

Raw-byte cross-checks, performed without rerunning anything:

- `evidence/stage2-engine-condition/category4.java.stderr` is **83 bytes**, exactly `No WHEN clause selected in SELECT statement,\r\n   and no OTHERWISE clause present.\r\n`. Reference stderr is **332 bytes**: identical prefix, then `ERROR condition raised at address 080780E1`, `_pli_OTH`, Thread 621943 and a traceback table. Stable omitted content is real; it is not all random.
- `evidence/stage2-io/eof-repeat-{0,1,2}.native.stderr` are each 454 bytes with distinct SHA-256 prefixes `067d0399a396`, `3bcd974d76c2`, `38e36084c6b8`. Comparing repeats 0/1 shows only the two Thread lines differ: 624474 vs 624532. RECORD repeats are 671 bytes, hashes `19f6bf8f19e8`, `79bc6e82fe87`, `7531946ab145`; repeats 0/1 differ in Thread 624503 vs 624561. Addresses need not be random to explain these captures.
- Current `build/adventure.jar` independently hashes to **`5cadb8025a563ee47013650f9af1f261b849bd7dc0d87ea2cc322ce559318d1b`**, matching final reproducibility evidence.

**Interpretation limit:** repeated native self-inequality proves that naïve byte equality across separate uncontrolled PIDs is not a sound oracle for those fields. It does not alone prove every permissible independent implementation is mathematically impossible. The original task mentions identical ambient conditions; later prompts also prohibit fabricated native reports. The agents' conclusion that the combined literal-report/no-fabrication contract is incompatible is a requirements interpretation requiring owner agreement. That decision was requested only at P:55; no agreement is recorded. Stable omitted fields and actual nondeterministic identity fields must remain separate. Regardless of interpretation, the existing strict benchmark is demonstrably not passed.

## Coordination overhead, duplication and waiting

### Measured coordination load

Classify an assistant turn as coordination-only when it contains tool calls and **every** call name starts `swarm_`; work/mixed otherwise; no-tools separately. This attributes the turn's entire usage, not a causal estimate of avoidable communication cost.

| Metric | Swarm 1 | Swarm 2, both runs |
|---|---:|---:|
| Coordination-only turns / cost | 545 / $31.536376 | 406 / $25.393828 |
| Work/mixed turns / cost | 619 / $38.970444 | 553 / $32.943964 |
| No-tool turns / cost | 18 / $1.267744 | 46 / $2.614964 |
| `swarm_read_posts` calls | 189 | 169 |
| Characters returned by wall reads | 315,019 | 228,012 |
| Wall reads with no `(new)` marker / attributed turn cost | 19 / $0.994900 | 20 / $1.499484 |
| Stored posts / comments / messages | 99 / 6 / 175 | 80 / 1 / 91 |
| Message-recipient rows | 247 | 187 |

Coordination-only turns account for **$56.930204 (42.89% of cost)**. Not all are waste: API negotiation, findings and ownership conflict resolution prevented damage. Even unrealistically eliminating all that cost leaves **$75.797116**, still over $50. A cheaper valuation alone would not address the primary completion failure.

### The 200-character limit creates measurable retries

Exactly **139** tool results begin `Too long:`: 72 in swarm 1, 67 in swarm 2. Breakdown: swarm 1 post/message/reply/comment = 30/34/7/1; swarm 2 = 29/22/16/0. These are **23.60% of 589 attempted coordination mutations** (posts, comments, messages, replies), not successful DB rows. Swarm 2 also contains Main's feedback post/message, which are not worker tool calls.

Turns issuing rejected calls cost **$4.568352 + $4.641716 = $9.210068** before charging any subsequent successful rewrite. This is measured spend associated with rejected turns, not a claim the whole amount could be saved independently of later context effects. Examples:

- S1/Sekhukhune:36→38, 42→44, 48→50: three distinct coordination calls rejected at 204, 205, 206 characters.
- S2/Nicholas:139→141: post rejected at **201/200**; :184→186 another at 204/200.
- S2/Wallada:454→456 at 16:01:30: final-run announcement rejected at 204/200; :458→460 at 16:01:37 retries successfully as post 143. This boundary delays critical coordination even when only four characters over.

All agents were already explicitly instructed about the cap. Repeating the instruction is therefore unlikely to remove this class of overhead. A structured status/ownership channel and a usable payload allowance or non-model correction path are more promising than another warning prompt.

### Concrete duplicated work and useful redundancy

- **Duplicate ownership:** swarm 1 posts **26/27**, one second apart, both claim ObjectActions after Savitri is redirected from testing. Zuleika message **42** identifies the conflict; Savitri message **46** yields and returns to harness work. No overlapping ObjectActions overwrite was established.
- **Mutual yielding race:** swarm 2 posts **104/105** both claim Endgame, then **110/111** each yield to the other. Messages **176–179** settle it, but the wall still looks contradictory; Wallada message **184** asks again and receives **186/187**. Six-plus messages and conflicting status posts resolve a job assignment that could have one authoritative owner record.
- **Duplicate discovery:** stage-1 numeric-width defect independently probed by Gabriella (post 74/messages 133,142) and Savitri (137,141); the latter proposes a second GameIO formatter while LegacyFormat already exists. Tessa message 145 redirects to the existing helper. Tab-token defect messages 159/160 arrive ~2 seconds apart from independent auditors. Useful independent confirmation, but shared findings/ownership lag creates repeated work and repair negotiation.
- **Duplicate integration assignment:** stage-2 Laodamia message 195 volunteers final build/status, already claimed by Wallada at post 120; message 196 resolves it. Synthesis ownership was initially missing from the volunteered subsystem split.
- **Duplicate error-boundary coordination:** Hector message 217 had already assigned BUG/SELECT checks; Wallada message 224 asks again; Hector message 226 points back to the existing thread. One defect crosses parser, Main, engine, travel and endgame, and the board does not represent its complete state.
- **Required context replay:** each of 20 agents separately reads `.agent-task.md`, `AGENTS.md`, `SWARM_REQUIREMENTS.md`; all ten verification agents also read `IMPLEMENTATION_STATUS.md`. This is legitimate instruction loading, not careless duplication, but sets a per-agent fixed cost. Identical-range reads are countable in JSONL; additional broad source discovery is not automatically redundant.
- **Repeated compilation against moving dependencies:** S2/Marvin:106 records DataParser's constructor call with one fewer argument while GameData still expects `List<Integer>`; another matching compile failure also exists. Message 207 subsequently asks Olomu to remove the obsolete constructor argument from TravelAuditTest. Isolated output directories prevent class-file collisions, but do not snapshot source or APIs.

### Active waiting: present, but not a demonstrated runaway polling loop

No bash commands containing the searched sleep/poll patterns (`sleep `, `while `, `watch `, `pgrep`, `ps -`) were found in worker tool calls. No chain of three consecutive assistant turns containing only `swarm_read_posts` was found. Do not describe these runs as dominated by sleeping, infinite acknowledgement ping-pong, or crash/retry loops.

There are shorter readiness checks and dependency waits:

- S1/Zuleika:154 at 15:28:07 does `find java_project/src`; :166 at 15:28:20 checks the wall before the runtime-field agreement arrives. At :210 (15:30:48) another `find` checks dependency availability, followed by reading GameState, GameIO and DataParser. Much of this is useful integration work while waiting, not pure inactivity.
- S1/Shivaji:386 and :390 poll the wall only **8.510 seconds apart** while awaiting a new JAR, then read an evidence note and handle incoming tab-token defects. This is a concrete small active-wait episode, not evidence for a long spin loop.
- Stage-2 messages **222/223** explicitly hold final integration on parser repairs; S2/Wallada:394 writes the final runner during that dependency window. S2/Laodamia:418 polls while waiting for the shared diagnostic renderer, then updates the condition test rather than sleeping.
- The 39 wall reads lacking a new marker cost $2.494384 in issuing turns. Some were mandatory pre-edit/pre-finish checks or deliberate rereads. They are an upper-level signal of stale retrieval, not a precise measure of avoidable active waiting.

### Integration and test tail dominates available parallelism

Ten-agent stagger is approximately **20 seconds per agent** in each initial swarm; first to tenth active-span start is 180.002s in swarm 1, 180.232s in swarm 2. In swarm 1, the foundational GameState owner is launch-order **8**; the ObjectActions owner **9**. Early service owners consequently negotiate against unavailable core APIs. The parent defaults are in `src/constants.ts` (`DEFAULT_STAGGER_SECONDS=20`, `DEFAULT_MAX_AGENTS=10`). Delay is partly a design choice, not all inference latency.

The “no leader” prompt did not remove the need for integration: Lalitaditya and Wallada became de facto integrators. After every other agent's final settle, only the integrator remained for **246.551s** in 1/1, **312.150s** in 2/1, and **371.493s** in 2/2. These are final single-agent active tails, excluding the ~15s completion grace. More agents do not shorten serial build/evidence synthesis automatically.

Wallada ran the aggregate runner **five times**:

| Trace start → result | UTC interval | Cause/context |
|---|---|---|
| S2/Wallada:462→464 | 16:01:43.848–16:03:30.692 | First aggregate run; architecture probes have wrong cwd and fail before executing CLIs. |
| :500→502 | 16:04:37.640–16:06:27.352 | Runner cwd and fresh architecture compilation repaired (:484/:492). |
| :619→621 | 16:10:20.836–16:12:13.159 | After further SELECT/dispatch repairs. |
| :798→800 | 16:20:39.590–16:22:26.718 | After resumed stable-diagnostic repairs. |
| :827→829 | 16:23:12.393–16:25:00.969 | Added omitted parser diagnostic probe to runner at :823 and reran everything. |

About nine minutes of foreground runner execution occur across these calls. Necessary regression after source changes is not waste; wrong-cwd rerun and late discovery of an omitted probe are avoidable integration costs. Final logs overwrite earlier runner evidence, so session traces are needed to separate them.

The narrow follow-up reawakens all ten agents. Khloe/Brandon/Nicholas collectively spend **$1.668724 over 28 turns** in 2/2; their focused reviews find no new production defect (posts 168/169 and related review status). That is not worthless review, but it exposes the cost of all-agent resume for a diagnostic-boundary change. Wallada alone costs $5.774582 of the $17.402978 follow-up and owns the long final tail.

## Useful behaviors to retain

- **Truthful acceptance reporting:** stage reports, strict script exits, parent P:55 all explicitly refuse to claim completion. No green-by-normalization result is evidenced. Runtime `finished` is misleading as a benchmark label, not evidence agents fraudulently asserted success.
- **Real reference probes change implementation decisions:** zero-valued native RAN investigated rather than replacing with Java randomness (post 17, post 55); native zero exit on errors corrects a false “successful startup” assumption (messages 164/169); SELECT probes prevent fabricating unreachable BUG output (215,219–221).
- **Cross-owner review catches real coupling:** source audit produces minimal reproductions for SPK, reincarnation, pending-object SAY and tabs. Repair messages route to a single code owner rather than every reviewer editing the same file.
- **Shared helpers instead of duplicated fixes:** GameIO.displayWord agreement in messages 124–127; LegacyFormat in 133–145; final shared Main CRLF renderer/factory in 247–261.
- **Raw reproducible evidence:** input/stdout/stderr/status captures, copied-data tests, deterministic fuzz seeds, isolated compilation directories and two-build hashes. Copied-data closure fixtures are explicitly identified rather than passed off as natural traversal of the original game.
- **Scope conflicts generally resolved before edits:** Endgame/engine guards are negotiated; message 242 explicitly says Brandon avoided duplicate changes/probes once Laodamia owned them.

## Why runtime “finished” is not task completion

`src/broker/lifecycle.ts:isQuiescent` requires all agents launched, no open agent message recipients, and every agent idle (or crashed with exhausted revives). `CompletionTracker` then waits `COMPLETION_GRACE_MS=15000`. It does **not** inspect tests, requirements, unresolved findings or acceptance evidence. This baseline has no crashes, so exhausted-revive completion did not cause these results; nevertheless that code path is another reason not to interpret `finished` as accepted.

`src/store/stats-queries.ts` sums `swarm_runs` for wall time and `agent_runs` for active time; `swarms.started_at` is overwritten on resume. Looking only at that field would discard 2/1. `src/agents/rpc-events.ts` counts completed assistant messages and separate compaction usage, not partial streaming starts. Session totals exactly reconcile here, so there is no evidence the high cost is merely duplicate accounting.

## Practical changes to evaluate, in priority order

1. **Completion first:** distinguish `accepted`, `blocked` and runtime quiescence. Before return, an integration owner checks immutable acceptance commands plus the full requirement ledger; new actionable failures stay inside the same invocation. An unresolved contract must be escalated early and cannot be auto-waived. This task's PID/native-report boundary should have been tested before most implementation spending.
2. **Stable core and accountable integration:** assign core data/state/I/O ownership before dependent services start; publish a single versioned API/ownership note. Keep independent reviewers, but do not re-create the whole team to supply the review phase. Prefer an integrated implement–review–repair cycle under one run budget. Native shared scratch semantics need explicit ownership, not merely matching method signatures.
3. **Reduce coordination round trips:** one authoritative owner/finding record, targeted actionable messages, delta wall reads; address the demonstrated 200-character rejection rate. Do not add a heavyweight distributed task framework before measuring a small structured ownership/acceptance record.
4. **Keep final evidence cheap and trustworthy:** frozen source/artifact hash, explicit command/cwd manifest, one integration runner that discovers or declares all probes before execution. Test the runner itself once; parallelize independent probes where safe, then synthesize once. Never remove strict coverage just to save cost.
5. **Budget control with completion protection:** report per-run and cumulative API-equivalent cost separately; include parent and follow-ups. Measure cache-read/context growth and failed-tool spend. Use targeted review/resume for unresolved areas, not automatic all-agent wakeups. A $50 cap is a stop/blocked constraint until quality-preserving savings are demonstrated, not permission to return an incomplete artifact as successful.

Viable alternatives: **(a)** keep the peer swarm but add a lightweight acceptance/integration owner and targeted feedback; smallest architecture change, less certain cost reduction. **(b)** smaller implementation team plus bounded independent reviewers, expanding only for proven parallel work; reduces context/coordination replication but may increase time and miss issues unless coverage ownership is explicit. The baseline does not establish the optimal team size or justify a guaranteed <$50 forecast.

## Reproducible queries and calculation rules

Use Python `sqlite3.connect('file:' + DB_PATH + '?mode=ro', uri=True)`; do not instantiate the extension store (which can migrate/write). Core queries:

```sql
SELECT * FROM swarm_runs ORDER BY swarm_id, run;
SELECT swarm_id, run, kind, model, COUNT(*) AS turns,
       SUM(input), SUM(output), SUM(cache_read), SUM(cache_write), SUM(cost)
FROM usage GROUP BY swarm_id, run, kind, model;
SELECT swarm_id, run, COUNT(*) AS spans,
       SUM(ended_at-started_at)/1000.0 AS active_seconds
FROM agent_runs GROUP BY swarm_id, run;
SELECT swarm_id, agent, COUNT(*) AS turns, SUM(cost)
FROM usage GROUP BY swarm_id, agent;
SELECT swarm_id, reason, COUNT(*) FROM agent_runs GROUP BY swarm_id, reason;
SELECT swarm_id, name, status, revive_count FROM participants WHERE kind='agent';
SELECT id, author, title, body, created_at FROM posts WHERE swarm_id=? ORDER BY id;
SELECT id, thread_id, sender, body, created_at FROM messages WHERE swarm_id=? ORDER BY id;
```

For JSONL: parse each physical line; sum `message.usage` only on assistant messages; count toolCall blocks by name; join toolResult `toolCallId` to the issuing assistant. For the rejection statistic use **`result_text.startswith('Too long:')`**, not text containing “error” (successful wall content often describes application errors). Count no-new wall reads by absence of literal `(new)`; classify consecutive polling on assistant-turn order, not raw JSONL adjacency. Compare native stderr with `read_bytes()` and `splitlines()`; use SHA-256 of raw bytes, not decoded/newline-normalized text. Wall duration is sum of run end–start; active time is sum of all agent span end–start; they must not be added together.

### Remaining uncertainties

No external immutable acceptance suite was found in the inspected supplied inputs; the recorded differential suites were agent-authored and cannot prove exhaustive equivalence. Source coverage tables are ownership claims, not branch coverage measurements. Timing/flush fidelity, arbitrary malformed memory-corrupting data, all overflow behavior and dormant random branches are not comprehensively established by these runs. Earlier component notes may be stale after shared-tree reruns. Current extension source explains the observed schema/lifecycle, but no exact historical extension commit was attached to D. No invoice, full earlier-subagent accounting, or owner decision resolving the diagnostic contract was recovered. None of these uncertainties changes the directly observed conclusion: **the recorded benchmark remained incomplete after three execution spans and more than $132 in worker API-equivalent usage.**

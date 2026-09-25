# Run 05 — four peers, Opus

**Outcome: the peer verdict `accepted` is not upheld. Independent validation found real failures, so the benchmark is incomplete.** Recorded spend was **$47.901340**, just under $50.

This is the strongest run so far on stdout-level gameplay. All 44 of the peers' e2e scenarios match the legacy stdout, and so do long random sessions, a 10,005-turn session, abbreviations, deaths and a mutated-data check. Two things still fail the original task:

- **Native stderr diagnostics are wrong on every input-boundary termination.** This includes mislabelling a RECORD condition as ENDFILE.
- **Numeric data fields are parsed incorrectly.** A copied data file with a decimal field makes Java crash with exit code 1, while the legacy program plays normally.

The peers' acceptance record lists **no known gaps**. Their own test oracle could not see stderr at all.

## Configuration and provenance

- Swarm **5**, `rnd-03-opus-four-peers`: **one run**, four equal peers, medium thinking. No assigned roles, no implementation plan, no parent repair or resume. The original `.agent-task.md` and `AGENTS.md` applied unchanged.
- **Model:** `anthropic/claude-opus-5-5` for the parent and all **653 worker assistant turns**. No fallback and no limits-wait retries were recorded. This is the first valid Opus data point; run 04 was GPT fallback.
- **Output:** originally written to `java_project/`, now archived as **`java_project-run05-opus/`**. The empty, reserved `java_project/` was not touched: it still has 0 entries.
- **Run directory:** `.rnd/experiment-03/` in the modernization workspace (**E** below).
- **Extension:** recorded commit plus `E/extension-uncommitted.patch`. This is not a clean-commit experiment.
- **One live swarm at a time was respected:**
  - Swarm 4 ended at **18:19:22.226 UTC**.
  - The swarm 5 parent launched at **18:30:28.609**. The swarm ran **18:30:34.715 → 19:42:08.661**.
  - The parent exited **19:42:26.734** with return code 0 and `settled: true`.
- **Evaluator:** launched no agents and made no commits.

## Exact recorded metrics

Source: `E/metrics.json` from `scripts/rnd-metrics.py`. The DB and session worker costs reconcile exactly (difference −7e-15). Costs are **API-equivalent usage** under the model configuration, not an invoice.

| Metric | Result |
| --- | ---: |
| Worker cost | **$47.779696** |
| Parent cost | $0.121644 |
| Combined recorded cost | **$47.901340** |
| Swarm elapsed | **71m 33.946s** |
| Summed active agent time | **3h 39m 49.924s** |
| Worker assistant turns | 653 |
| Uncached input / output tokens | 1,438 / 486,027 |
| Cache-read / cache-write tokens | 127,167,893 / 2,523,965 |
| Worker total token occurrences | **130,179,323** |
| Parent tokens / turns | 45,183 / 4 |
| Coordination-only turns / cost | **95 / $6.874825** (14.39% of worker cost) |
| Wall reads / explicit delta-cursor calls | 32 / **7** |
| Wall-read returned characters | 62,166 |
| Posts / comments / messages / recipient rows | 15 / 4 / 39 / 87 |
| Length-limit rejections | 0 |
| Worker tool-result errors | 29 |
| Limits-wait retries | 0 |
| Revives | 0 |
| Acceptance-tool calls | 6 |

Average active concurrency was about **3.07**. Cache reads account for 97.7% of token occurrences. Coordination-only cost is whole-turn attribution, not proof of waste.

| Worker | Turns | Cost | Tokens | Coordination turns / cost | Tool errors | Delta reads |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Savitri | 178 | $15.264235 | 33,718,969 | 18 / $2.446663 | 6 | 3 |
| Aethelred | 178 | $12.405687 | 36,989,792 | 30 / $1.867062 | 14 | 0 |
| Arok | 169 | $11.668144 | 37,261,860 | 25 / $1.487529 | 7 | 0 |
| Raymond | 128 | $8.441629 | 22,208,702 | 22 / $1.073571 | 2 | 4 |

### Compared with earlier runs

| Run | Model | Combined cost | Elapsed | Result |
| --- | --- | ---: | ---: | --- |
| 03 | GPT | $22.83 | 15m 01s | Incomplete |
| 04 | GPT fallback | $21.45 | 15m 54s | Incomplete |
| 05 | Opus | $47.90 | 71m 34s | Incomplete |

Run 05 cost about 2.2× run 04 and took about 4.5× as long. It produced a much larger system: 8,396 main-source lines, 153 unit/integration tests and 44 recorded scenarios, versus run 04's 74 generated CLI cases. It also got further on fidelity, but still fails acceptance. At $47.90 there is essentially no budget headroom for a repair round inside the $50 target.

## Coordination behaviour

- **Ownership split:** Savitri (post 197) and Aethelred (post 198) posted near-identical four-way splits within two seconds. Both offered to own data/state. The collision resolved in about 40 seconds through wall comments:
  - Arok took action verbs; Raymond took motion, death, closing and scoring.
  - Aethelred took the turn loop, dwarves, hints and the e2e harness; Savitri kept data, state and I/O.

  One skeleton owner then published a single API (post 200), and nobody wrote a parallel one.
- **Control-flow contract:** Arok proposed a sealed `ActionOutcome` type (messages 441 and 444). Aethelred made a clear decision that there would be one `Step` enum "to avoid two parallel flow types = duplication" (message 445). Arok complied. This was a good early, explicit convergence.
- **Shared-code requests went to the owner:** for example `CaveClosingService.panic()` and the repository constants (messages 455–457), and TravelTable duplication in DwarfService (474/475). Dead code was removed rather than kept: an unused setter, `rawOption`, `Vocabulary.entries`.
- **Real quirks found through legacy probes:**
  - RAN is always 0, which makes dwarves, the pirate and cave closing unreachable (messages 442 and 464).
  - Storage aliasing between PLACOM and ABBCOM (446), and COND(−1) aliasing to KEY (450).
  - Blank-record handling (459/461), F(w) overflow (467), LOG echo (469/471), CR/FF/SUB control characters (476/477), and the 120-byte record limit (447).
- **Self-review work:** peers ran about 1,000 randomized stdout-level differential sessions. They also ran a trace-comment audit over main and test code, and an unreferenced-method scan.
- **Friction:**
  - Raymond raised a false line-number complaint and retracted it (messages 448/449).
  - Aethelred and Savitri disagreed briefly over README and Terminal ownership (462).
  - The offline Maven jar plugin 3.4.1 failed and was switched to 3.3.0 (461).
  - 29 tool errors in total.

  There were no length rejections, no revives and no ping-pong loops. Peers used explicit delta cursors 7 times; this is the first run where anyone used them.
- **Acceptance:** Aethelred recorded **revision 2 `accepted`**, with `known_gaps: []` and `findings: []` (post 211). No peer challenged it. The parent re-ran the build (153 tests green) and reported the claim as "their own judgement … not independently validated". It did not resume the swarm.

### How the stderr gap disappeared

Unlike runs 03 and 04, the diagnostic question was never debated or recorded here. In message 447 Aethelred verified the native behaviour and wrote:

> "EOF: terminate, pending newline written, exit code 0; stderr gets PL/I traceback (not needed in stdout)."

After that, no peer message, post or acceptance entry discusses stderr again. The oracle then made the gap invisible:

- `scripts/record-legacy-transcripts.sh` records only `advent … 2>/dev/null`.
- `LegacyTranscriptTest` runs the application in-process, passes `PrintStream(OutputStream.nullOutputStream())` for diagnostics, and asserts stdout only. It checks neither stderr nor the exit code.
- `differential-fuzz.py` compares stdout only (the README says so).

So "all 44 byte-identical" is true of stdout transcripts only. This was an early scoping remark silently turning into the test contract. It was not a considered decision, and it was not a user waiver.

## Independent artifact validation

**Delivered JAR preserved first.** Before any build, I copied `target/adventure.jar` to **`E/worker-final.jar`**. Its SHA-256 is:

```text
7d8dd73c04208f3cd6e082a988e2faee20c016b2a20fd3cfa5f997205c0df5fd
```

The worker's surefire reports are copied to `E/worker-surefire-reports/`: 153 tests, 0 failures. Hashes of 172 protected files (instructions, uploads, all non-`target` project files) are in `E/evaluator-before.json`. **All were unchanged afterwards** (`E/evaluator-integrity.json`).

**Documented build, run offline.** Maven and a JDK are not on `PATH`. I used the same local tools the workers used: Amazon Corretto 17.0.13 from SDKMAN and the Maven 3.9.12 wrapper distribution, with the existing `~/.m2` cache. I ran `mvn -o -B clean package` twice from the archived project directory, with no network or downloads.

- Both runs: **BUILD SUCCESS, 153 tests, 0 failures/errors/skips**.
- Logs: `E/evaluator-build-{1,2}.log` and `E/evaluator-jdk.log`.
- An online `mvn clean package`, as written in the README, was not attempted. It depends on the Maven repository being reachable or already cached.

**The JAR is not reproducible.** The two builds produced:

- `c264931920cb926e7f94896e2483eedfecbf1e531bc23f0ad9821b4f8f8fd89b`
- `f5bca5f9644318288603381935cbf365ef25f96a988ff81fd2a2d0b30e2f07c3`

Their entry contents are identical, including against the delivered JAR, but 76 entry timestamps differ. `pom.xml` sets no `project.build.outputTimestamp`. The task requires a "reproducible build configuration", so this is a small packaging defect. The Java behaviour is the same.

### Strict comparator over the peers' own e2e scenarios

`E/evaluator_strict.py` pipes each unmodified `src/test/resources/e2e/*.in` into the real `uploads/advent` (cwd `uploads/`) and into the preserved JAR, as separate processes. It compares stdout, stderr and both exit codes. Streams and results are in `E/evaluator-strict-e2e/`; the log is `evaluator-strict-e2e.log`.

| Check | Result |
| --- | ---: |
| stdout | **44/44** |
| Exit code | **44/44** (all 0) |
| Strict (all three) | **35/44** |

The **9 failing cases** all differ only in stderr:

| Case | Native stderr (bytes) | Java stderr (bytes) |
| --- | ---: | ---: |
| `eof_at_start` | 477 | 40 |
| `eof_in_quit_confirmation` | 477 | 40 |
| `eof_mid_game` | 454 | 40 |
| `input_carriage_return_inside_record` | 671 | 40 |
| `input_crlf_and_sub_mark` | 454 | 40 |
| `long_input` | 671 | 40 |
| `verbs_all_in_building` | 454 | 40 |
| `verbs_cage_bird_grate_side` | 454 | 40 |
| `verbs_take_fixed_side_visited` | 454 | 40 |

Java's stderr in every failing case is `ENDFILE condition raised\n  ONFILE=SYSIN\n`, LF-terminated. Native output is CRLF, with an address, the procedure, the Thread (process ID) line, the ERROR cascade and a traceback. For **`long_input` and `input_carriage_return_inside_record`, native raises `RECORD condition raised … _pli_BufI`, but Java prints `ENDFILE`**. `AdventureApplication.run` catches the single `EndOfInputException`, which is used for both conditions, and always prints the ENDFILE text.

### Probes: run-04 set plus new adversarial cases

`E/evaluator_probes.py` uses copied fixtures only, under `E/evaluator-probes/<case>/`, with the same strict comparator. Results are in `results.json` and `evaluator-probes.log`.

| Probe | stdout | stderr | Exit (native / Java) | Verdict |
| --- | --- | --- | --- | --- |
| `quit` | = | = | 0 / 0 | PASS |
| `eof-game` (`n\n`) | = | 454 vs 40 B | 0 / 0 | **FAIL** (diagnostic) |
| `record121` | = | 671 vs 40 B | 0 / 0 | **FAIL**; Java says ENDFILE, native RECORD |
| `double-blank` | = (999 B) | = | 0 / 0 | PASS; fixed since run 04 |
| `missing-data` | = (16 B) | 477 vs 299 B | 0 / 0 | **FAIL** (diagnostic); exit status now matches |
| `decimal-section` (copied data: first field `1.0     `) | 997 vs **16 B** | 0 vs 840 B | **0 / 1** | **FAIL: behaviour.** Java throws uncaught `IllegalStateException: CONVERSION condition raised … '1.0'`; native loads and plays |
| *new* `default-cwd-data` (no argument, cwd has `advent.dat`) | = | = | 0 / 0 | PASS |
| *new* `abbreviations` (INVEN, INVENTORYXYZ, TAKE LAMPS, TAK, lowercase, NORTHEAST/NE/SW) | = | = | 0 / 0 | PASS |
| *new* `turn-overflow-10005` (10,005 WAITs, then SCORE and QUIT; 301,268 B) | = | = | 0 / 0 | PASS |
| *new* `three-deaths` (reincarnation limit, then score) | = | = | 0 / 0 | PASS |
| *new* `long-random-{0,1,2}` (seeded, 600 mixed commands after cave entry; 35–51 KB each) | = | = | 0 / 0 | PASS ×3 |
| *new* `mutated-description` (copied data, location 1 text changed; `MUTATED` appears in Java output) | = | = | 0 / 0 | PASS: text comes from data |

In `decimal-section`, `GameDataLoader.numberField` calls `Integer.parseInt` under a comment claiming F(8) semantics. The legacy numeric field input accepts `1.0`. The resulting exception is not one of the types `run()` catches, so the JVM terminates with exit code 1 and a stack trace. This is the same class of defect as in run 04, and it is independent of diagnostic formatting.

### Code-quality sample

This was a sample, not an exhaustive audit.

- **Trace comments:** a heuristic scan found **378 class, method and constructor declarations** in `src/main/java`. **0** lack a comment citing `advent.pli` lines or saying "Java-only". Most use the form `advent.pli line(s) N[-M]`. I did not verify every cited range, but the spot-checked constants and ranges below matched.
- **Dead code:** no declared main-source method is referenced only at its declaration, and none is referenced only by tests. No TODO, FIXME, stub or placeholder text.
- **Hardcoded game state:** every message-like string literal of 12+ characters in main code appears verbatim in `advent.pli`, which the task allows as source-defined text. None is copied from `advent.dat`. Mnemonics (`Keywords.lookUp`) are resolved from the parsed vocabulary.

  Numeric constants match legacy source assignments, for example:

  | Java constant | Legacy source |
  | --- | --- |
  | `PIRATE_CHEST_LOCATION = 114` | `CHLOC=114` (line 810) |
  | `OTHER_MAZE_DEAD_END = 140` | line 811 |
  | `ALTERNATE_DWARF_LOCATION = 18` | line 822 |
  | Pearl drop location 105 | line 1906 |
  | Repository location 115 | lines 2271/2538 |

  The copied-data mutation probe confirms that descriptions come from the file.
- **README commands:**
  - Build and test work offline with the local toolchain; `mvn clean package` runs every test.
  - Run commands with the default-cwd and argument forms both behave as documented.
  - The README accurately states that the fuzz tool compares stdout only.
  - It describes EOF handling as "reports the end-of-file condition on standard error only". That is true, but it does not disclose that the report differs from native output.
- **Minor:** `AdventureApplication.main` prints a Java-only usage line and exits 2 when given more than one argument. The legacy program has no argument handling, so this adds behaviour the legacy program does not have (argument-parsing infrastructure, but still new behaviour).

## Is the stderr difference a gap under the original task?

**Yes. It is an unmet requirement, separate from the other defects.**

- `.agent-task.md` requires identical behaviour "down to the smallest observable detail" and exact observable output. It forbids only *additional* diagnostics in the gameplay transcript; it does not exempt output the reference produces. Its completion bar is "no known fidelity gaps".
- Stderr bytes and the condition type are observable, and the peers themselves verified them (message 447).
- No user waiver exists.

As established in the [diagnostic-contract investigation](diagnostic-contract.md), the original instructions do not prohibit reproducing the report. The Thread field is the process's own PID, and the addresses are fixed code locations in the non-PIE reference. Fair testing is possible with equal-PID isolation or a process-relative identity oracle.

Two parts of this gap are **independent of any PID or address argument** and could be fixed without contract questions:

- Mislabelling RECORD as ENDFILE.
- LF instead of CRLF line endings.

The other defects stand on their own and would fail acceptance even if diagnostics were waived:

- Decimal numeric fields crash startup with exit code 1.
- The JAR build is not reproducible.

## Verdict and next action

The evidence supports: **incomplete; peer `accepted` rejected.** The run still showed:

- The best coordination so far: an early single contract, owner-routed changes, dead-code cleanup, and the first use of delta reads.
- Strong stdout fidelity, including deep random sessions and edge cases.
- Spend just under the $50 target.

It also shows a new failure mode. Earlier runs recorded the diagnostic gap as `incomplete`. Here, the peers built a stdout-only oracle and then judged acceptance against it, so the gap was never recorded at all.

**Before the next run, the highest-leverage change is to make the acceptance oracle cover the whole observable contract.** Record native stdout, stderr and exit status. Require acceptance evidence to state what each check compares. Treat any stream a check does not compare as an open finding, not as passing.

The budget constraint also matters: $47.90 left no room for a repair pass. Budget control therefore has to come from making work cheaper, not from stopping earlier. The next experiment should keep Opus and the current mechanics, and change only this acceptance-evidence standard. That isolates whether the peers repair gaps once the gaps are visible.

This report is not an exhaustive fidelity audit. Unreachable legacy branches (closing and repository, with RAN ≡ 0) were covered only by the peers' unit tests and not re-validated here.

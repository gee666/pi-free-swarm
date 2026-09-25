# Run 07 — four GPT peers, one launched late

**Outcome: incomplete, and the peers themselves recorded `incomplete` (revision 4). I independently confirm that verdict.**

Combined recorded cost was **$26.132470**, and the run took 40m 07s. This is the first GPT run to reach full stdout fidelity on every gameplay probe I ran, including 700 seeded sessions. Most of that improvement is the late peer Halfdan's.

Remaining defects:

- Native stderr diagnostics are missing. Java prints nothing where the reference prints a PL/I report. The peers documented this as the known gap.
- Initialization errors behave differently. A missing data file, a decimal numeric field or a malformed section number makes Java crash with exit code 1 and no stdout, while the reference prints output and exits 0.
- The JAR build is not reproducible.
- Code-structure quality is weaker than in the Opus runs: 7 very dense main-source files, one of them a 444-line god-class engine.

## Configuration and provenance

- Swarm 7, `rnd-07-gpt-late-peer`, one run. Four peers were launched with `openai-codex/gpt-6-astra` at medium thinking. The parent and all **361 worker turns** used that model.
- `limits-wait-effective.json` lists GPT first and Opus second. No fallback or limits-wait retry was recorded.
- Peer 4, **Halfdan**, was held back until the three early peers (Moshe, Qasim, Alexa) first went quiet. He got the same prompts and a fresh context. There were no assigned roles, no plan, and no parent repair or resume.
- Artifact: `java_project-run07-gpt-late/`. The reserved `java_project/` was not touched and is still empty.
- Run directory: `.rnd/experiment-05/` (**E** below). It holds the launch config, the uncommitted extension patch and the metrics.
- One swarm at a time was respected. Swarm 6 ended at 21:02:12 UTC. The swarm 7 parent was launched at **21:09:17.388**, and the swarm ran **21:09:27.242–21:49:34.645**. The parent exited at 21:49:40.290 with `rc 0, settled`.
- The evaluator launched no agents and made no commits.

## Exact recorded metrics

Source: `E/metrics.json`. The database and session totals reconcile to within −3.6e-15. All costs are API-equivalent.

| Metric | Run 07 (GPT, late peer) | Run 04 (GPT) | Run 03 (GPT) | Run 06 (Opus, late peer) |
| --- | ---: | ---: | ---: | ---: |
| Worker cost | **$26.068964** | $21.383790 | $22.773196 | $41.692161 |
| Combined cost | **$26.132470** | $21.446180 | $22.832528 | $41.799979 |
| Swarm elapsed | **40m 07.403s** | 15m 54.199s | 15m 01.218s | 71m 58.914s |
| Summed active agent time | 1h 17m 09.049s | 55m 38.082s | 52m 12.768s | 2h 31m 04.579s |
| Worker turns | 361 | 335 | 337 | 572 |
| Uncached input / output | 363,070 / 76,828 | 389,690 / 67,933 | 334,956 / 65,306 | 1,240 / 450,883 |
| Cache-read / cache-write | 18,596,864 / 0 | 14,090,240 / 0 | 16,158,336 / 0 | 107,392,078 / 2,238,225 |
| Worker token occurrences | 19,036,762 | 14,547,863 | 16,558,598 | 110,082,426 |
| Coordination-only turns / cost | 103 / $7.150098 (27.4%) | 103 / $6.016888 | 125 / $8.196110 | 73 / $5.509237 |
| Posts / messages | 15 / 70 | 9 / 76 | 8 / 98 | 19 / 29 |
| Tool errors / length rejections / revives | 14 / 0 / 0 | 11 / 0 / 0 | – / 0 / 0 | 14 / 0 / 0 |
| Wall reads / delta reads | 12 / 0 | 12 / 0 | 9 / 0 | 23 / 10 |
| Peer verdict | incomplete | incomplete | incomplete | accepted |

Per-agent figures:

| Worker | Launch | Turns | Cost | Tokens | Coordination turns / cost | Tool errors |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Moshe | early | 119 | $9.241466 | 7,058,445 | 32 / $2.276610 | 4 |
| Qasim | early | 114 | $8.146168 | 5,977,492 | 38 / $2.467956 | 4 |
| Alexa | early | 87 | $7.172376 | 5,156,368 | 26 / $2.093238 | 5 |
| **Halfdan** | **late** | **41** | **$1.508954** | **844,457** | 7 / $0.312294 | 1 |

## Late peer: measurable contribution

### Timeline

All times are UTC, taken from `agent_runs`, `usage` and the wall.

| Time | Event |
| --- | --- |
| 21:09:29–21:10:09 | The three early peers start. Ownership settles within about 2 minutes: Moshe takes data and the endgame, Qasim takes the harness and actions, Alexa takes CLI/IO and the engine. |
| 21:27:43 | The early peers report the work done and wait for the final acceptance check (messages 560–562). They are quiet by about 21:31. |
| 21:30:18–21:30:23 | Alexa floats a `RuntimeDiagnosticFormatter` that would use the real PID and executable-derived frame metadata (message 563). Qasim and Moshe both say "favor honest gap" (messages 564/565), and the idea is dropped. |
| **21:31:16.973** | **Halfdan launches.** He posts his plan at 21:31:25. |
| **21:33:05** | **1m 48s after launch**: 150 seeded random 70-command sessions (seed 4217) show **9 stdout mismatches** (message 570). |
| 21:33:09–21:33:24 | The owners hand him edit rights. Qasim gives him ownership of `ActionService` (message 574). |
| 21:38:00 | Two root causes fixed, with unit regressions. The audit is expanded to 500 sessions, which exposes one extra mismatch (EOF during a hint question). That is fixed too (message 575). |
| 21:41:29 | Final check: 3 Java suites plus 36 differential cases pass, and 500 seeded sessions have **0 stdout mismatches**. JAR hash `8f23ca2a…` (message 577, post 245). |
| 21:41:29–21:49:18 | Alexa re-runs the probes against the final JAR, updates README/FIDELITY and records acceptance **revision 4 `incomplete`** (message 578). |
| 21:49:34 | The swarm ends. The late phase lasted **18m 17.672s**. |

### Cost

| Phase | Turns | Cost | Share of worker cost |
| --- | ---: | ---: | ---: |
| Start → late launch | 282 | $21.059770 | 80.8% |
| **Late phase** | **79** | **$5.009194** | **19.2%** |
| of which: Halfdan | 41 | $1.508954 | 5.8% |
| of which: early peers after late launch | 38 | $3.500240 | 13.4% |

### Findings, independently verified

Halfdan's saved pre-fix evidence is in `worker-build-evidence/independent-audit/*.legacy|.java`, copied from the archive before I built anything. It contains exactly the 9 claimed sessions: 11, 35, 48, 76, 87, 98, 105, 121 and 145.

I diffed each pair. They fall into two real defect classes:

1. **Stale SPK after an unknown word during object clarification** (sessions 11, 76, 87, 121, 145). The reference prints `I don't understand that!`. Java printed an action-specific message instead, such as `You can't fill that.` or `Rubbing the electric lamp…`.
2. **Bare SAY after a pending noun** (sessions 35, 48, 98, 105). The reference asks `say what?` and then echoes the next word. Java treated the SAY as transitive.

The third fix, an extra prompt after EOF inside a hint question, is session 161 in the 500-session expansion.

**Re-run on the preserved JAR.** `E/evaluator_seeded.py` replicates the peers' generator exactly. The peers' own `tools/seeded_audit.py` hardcodes `java_project/`, so running it would write into the reserved directory; I did not run it. My replica compares **stdout, stderr and exit status**.

| Seed | Sessions | stdout | exit | stderr |
| --- | ---: | --- | --- | --- |
| 4217 (theirs) | 500 | **500/500 equal** | 500/500 | 42 differ |
| 90707 (fresh) | 200 | **200/200 equal** | 200/200 | 12 differ |

- All 9 previously failing sessions and session 161 now match on stdout.
- The only differences in both runs are stderr, in sessions that ended at EOF. For example, the trailing `QUIT` gets consumed by a yes/no prompt. Native prints an ENDFILE traceback; Java prints nothing.
- **Halfdan's stdout claim is confirmed** on both his seed and a fresh one. His audit did not claim stderr equivalence, and the same condition class is the known gap.

**Effect of the late peer.** For $1.51 (and $5.01 in total including the early peers he woke), the late peer found and fixed 3 functional stdout defects. They sit in the command-parsing state machine, which ran 858 single-word vocabulary probes and 36 scripted sessions had not caught. These are real behaviour fixes, not comment edits.

In run 06, the Opus late peer found no functional defects; its value was in citation precision. Here, the GPT early peers left functional defects that a cheap, fresh-context differential fuzz found within 2 minutes. Halfdan did not challenge the stderr decision or the initialization-failure behaviour.

## Coordination behaviour among the early peers

- **Ownership:** Moshe claimed data (post 231) and Qasim the harness (232); Alexa then claimed CLI/build (235). With no engine owner, Qasim and Alexa converged (messages 512–518): Alexa took engine, core and NPCs; Qasim took actions after the harness; Moshe took the endgame after the parser. Everything was settled within 2 minutes without duplicate APIs.
- **Real legacy probes:** RAN is always 0 (post 236). Other finds:
  - the PTEXT(100) parser alias (messages 535/537);
  - blank-record skipping and the 120-byte record limit (539);
  - F(4) overflow (546);
  - a **reachable unchecked-array alias**: `bare TAKE` under the grate reads object 103, and `PLACE(103)=FIXED(3)`, `FIXED(103)=ABB(2)`. Qasim confirmed this with `objdump` of the static addresses and with legacy runs (messages 547–557); both variants were recorded as e2e cases.
- **Oracle:** better than runs 03/04/05. The 36-case `tests/differential.py` compares stdout, **stderr** and exit status as separate processes. EOF cases are kept separately in `tests/input_edges.py`, which honestly exits 1 on the 5 diagnostic failures. The acceptance record lists the gap. The seeded audit is stdout-only, and it says so.
- **Diagnostic contract:** this is the first run where a peer proposed implementing the report (message 563). The own-PID, executable-metadata design is the approach the [diagnostic-contract analysis](diagnostic-contract.md) found to be allowed by the original task. Two peers vetoed it as "fabricated". That is the same interpretation drift as in earlier runs, but here it was explicit and debated.

## Independent artifact validation

**The delivered JAR was preserved before any build**, as `E/worker-final.jar`:

```text
8f23ca2a0064af52d9d6dfde8b2edb303ce24ef4f794698388fc774dd0498d48
```

This matches the acceptance fingerprint. The worker's `build/` evidence (excluding classes and the JAR) was copied to `E/worker-build-evidence/`. The 25 protected source, test, instruction and input files were unchanged afterwards (`E/evaluator-integrity.json`).

**Build and tests.** I used the bundled Temurin JDK 21.0.12.1+1 from the archive's `.tools/`, with no network.

- `./build.sh`: rc 0.
- `./test.sh`: rc 0. It runs 3 Java suites (`GameDataTest`, `EngineStateTest`, `ActionServiceTest`) and **36/36 differential cases**.
- Also ran the README's other verification commands from the archive:
  - `tests/vocabulary_probe.py`: **858/858** cases pass, compared on stdout, stderr and exit (2m 38s).
  - `tests/input_edges.py`: rc 1, **5/10**. `empty-input`, `command-eof`, `confirmation-eof`, `unterminated-confirmation` and `record-overflow` fail, all on stderr only.
- Logs are in `E/evaluator-{build,test,jdk,vocabulary-probe,input-edges}.log`.

**The JAR is not reproducible.** Two builds hashed `812d389e…` and `3d602e26…`. The entry contents are identical, but 16–18 of the 18 entries carry different timestamps (`jar --create` with no `--date`).

### Strict comparator over the peers' e2e cases

`E/evaluator_strict.py` loads `CASES` from the unmodified `tests/differential.py`. It pipes each case into `uploads/advent` and into the preserved JAR as separate processes, and compares stdout, stderr and both exit codes.

Result: **36/36 strict**. Every scenario ends with a confirmed `QUIT` (see the note above), so these cases never reach a native diagnostic. The peers' EOF scenarios live in `input_edges.py` (5/10 above).

For comparison:

| Run | Strict result on peers' e2e cases |
| --- | --- |
| 04 | 73/74 |
| 05 | 35/44 |
| 06 | 23/35 |

Those runs' suites included EOF-terminated sessions. The counts are not directly comparable.

### Probes from runs 04, 05 and 06

These are the same scripts as before, run on copied fixtures under `E/evaluator-probes*/`.

| Probe | stdout | stderr | exit (native / Java) | Run 07 | Run 06 | Run 04 |
| --- | --- | --- | --- | --- | --- | --- |
| `quit` | = | = | 0/0 | PASS | PASS | PASS |
| `eof-game` | = | 454 vs **0** B | 0/0 | **FAIL** (diagnostic) | FAIL | FAIL |
| `record121` | = | 671 vs **0** B | 0/0 | **FAIL** (diagnostic) | FAIL | FAIL |
| `double-blank` | = | = | 0/0 | PASS | PASS | FAIL |
| `missing-data` | 16 vs **0** B | 477 vs 1,058 B (Java stack trace) | **0/1** | **FAIL (behaviour)** | FAIL (stderr only) | FAIL (exit 1) |
| `decimal-section` | 997 vs **0** B | 0 vs 700 B | **0/1** | **FAIL (behaviour)** | FAIL | FAIL (exit 1) |
| `default-cwd-data` | = | = | 0/0 | PASS | PASS | – |
| `abbreviations` | = | = | 0/0 | PASS | PASS | – |
| `turn-overflow-10005` (301,268 B) | = | = | 0/0 | PASS | PASS | – |
| `three-deaths` | = | = | 0/0 | PASS | PASS | – |
| `long-random-{0,1,2}` | = | = | 0/0 | PASS ×3 | PASS ×3 | – |
| `mutated-description` | = | = | 0/0 | PASS | PASS | – |
| `section-713` | 36 vs **0** B | 332 vs 442 B | **0/1** | **FAIL (behaviour)** | FAIL | – |

**Root cause of the initialization failures.** `Adventure.main` calls `GameData.load` before anything is printed, and it declares `throws Exception`. Any database problem therefore becomes an uncaught JVM exception with exit code 1. The reference prints `Initializing...` (and section lines) first, then either raises a PL/I condition with exit 0 or, for `1.0`, parses it successfully. So on bad input, Java's output ordering, stdout, stderr and exit status all differ. Run 04 had the same class of defect; runs 05 and 06 had partly fixed it.

## Code-quality sample

Scan output is in `E/evaluator-quality-scan.txt`.

- **Trace coverage:** all 109 main declarations (classes, methods, constructors) carry an `advent.pli` citation or a Java-only note. No main method is unreferenced or referenced only by tests. No TODOs or stubs.
- **Hardcoded state:** all 22 message-like literals are in `advent.pli`, none are in `advent.dat`, and the mutated-data probe passes. Vocabulary mnemonics are resolved at runtime via `vocabulary("…", type)`. A few invented Java-only error texts exist on unreachable or invalid-data paths, for example `Fatal error 27: unsupported hint` and `Object is not in its location chain`.
- **Structure and readability:** there are only 7 main files, with 1,552 lines but 80,696 characters. 35 lines exceed 120 characters, and some carry up to 6 statements. `GameEngine` (444 lines) combines session state, input dispatch, navigation, object chains, darkness and NPCs, and exposes package-private mutable fields that `ActionService` and `EndgameService` use directly. That conflicts with the task's "clean architecture / clear service boundaries / readability" requirement more than runs 05 and 06 did (44–54 smaller files). This is a qualitative judgement, not a measured defect.
- **README:** its commands are accurate and I exercised them. However, the documented `tools/seeded_audit.py` resolves its paths to `../java_project/` rather than to its own directory, so it only works while the project sits at `java_project/`. Its "Status" section honestly says the project is not accepted.

### Trace citation precision

I sampled 24 of the 121 parsed citations with seed 707 and checked each against `sed -n` output. The details are in `E/evaluator-trace-sample.txt`.

- **20/24 precise.** The cited range starts and ends on the named construct. Examples:
  - `resetCommand` → 1200–1202 `L2012: VERB=0; OBJ=0`
  - `liquid` → 2777–2782 `LIQ` proc
  - `extinguish` → 1943–1947 `L9080`
  - `scoreCommand` → 2279–2289 `L8240/L8241`
  - `blank` → 3227–3234 `LINESKP`
  - `line` → 3236–3250 `LINEOUT`
  - `pour` → 2032–2060
  - `discard` → 1784–1834
  - `updateDwarves` → 991–1147
  - `Travel` → 537–555
  - `GameData()` → 430–439
- **4/24 start correctly but end too late:**
  - `die` → 1676–1707 and `GameEngine` class → 639–1707 both run 8 lines past L95 (ending 1699) into the next section's header comment.
  - `endGame` → 2623–2739 runs 8 lines past L25000 (ending 2731) into the subroutine-section comment.
  - `describe` → 1154–1202 includes the `L2011/L2012` command reset.

None of the 24 pointed at unrelated code, and no citation exceeds the 3,374-line file or uses the 8-digit sequence numbers.

Run 06 scored 24/24 after its late-peer citation sweep. Run 07 is good but slightly less exact. Halfdan did not audit citations.

## Is the stderr difference a gap under the original task?

**Yes, and the peers agree.** Their acceptance record lists it as a known gap, and the README/FIDELITY files state the project is not accepted.

The veto on implementing the report (messages 564/565) rests on a "fabricated diagnostics" reading that the original task does not state (see the [diagnostic-contract analysis](diagnostic-contract.md)). The initialization-failure behaviour (exit 1 and missing `Initializing...`) is a **separate, fixable defect** that needs no diagnostic contract at all.

## Verdict and comparison

**Incomplete (peer verdict confirmed).** Blocking defects:

1. The stderr condition report is absent: 5/10 of the peers' input-edge cases fail, and so do EOF-ending seeded sessions.
2. On missing, decimal or malformed data files, Java crashes with exit 1 and prints no stdout.
3. The JAR build is not reproducible.
4. Architecture and readability are weaker than in the Opus runs (qualitative).

**Against the GPT runs without a late peer (03, 04):**

- It cost +$3.30 to +$4.69 more and took about 2.5× longer: 40 minutes versus about 15. The extra time went mainly into the early peers' own work (the alias investigation and the vocabulary probe), with 18 minutes in the late phase.
- Quality is clearly higher:
  - no stdout failure on any gameplay probe or on 700 seeded sessions;
  - the double-blank defect from run 04 is fixed;
  - the oracle now includes stderr and exit status, and the acceptance record is honest.
- The late peer alone accounts for 3 real stdout defect fixes that the early GPT peers' own checks had missed.

**Against Opus run 06:**

- It cost **$15.67 less (−37.5%)** and took **31.9 minutes less (−44%)**.
- Stdout fidelity is equal on all shared gameplay probes.
- Opus handled initialization errors better (exit 0 and `Initializing...` preserved; run 06 also printed the correct RECORD/ENDFILE labels), had better code structure, and had slightly better citation precision.
- GPT got the acceptance verdict right. The Opus peers accepted with no known gaps listed.

**Late-peer mechanism across both models:** a late peer costs 4–6% of the run, finds something within 2–3 minutes, and triggers about 3× its own cost in owner follow-ups. It inherits the team's oracle, so neither late peer challenged stderr or initialization behaviour.

**Recommended next isolated change:** keep the late peer, and give it the full-stream oracle plus the original task text as its acceptance baseline. Keep model and mechanics fixed.

This is a sample-based validation, not an exhaustive audit. Branches that the legacy program cannot reach because RAN is always 0 (closing, repository, dwarves, pirate) rely on the peers' unit tests.

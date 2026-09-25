# Run 06 — four Opus peers, one launched late

**Outcome: the peer verdict `accepted` is not upheld. This run is incomplete.**

Combined recorded cost was **$41.799979**, $6.10 less than run 05, for the same elapsed time. Stdout fidelity is again very strong. Trace-comment precision is clearly better than run 05, and the late peer measurably caused that improvement.

The same three blockers remain:

- Native stderr diagnostics are not reproduced. The peers decided in their first minutes to write "a short ENDFILE diagnostic to stderr only".
- A decimal numeric field in the data file is still rejected. The Java program now exits cleanly, but stdout still differs.
- The JAR build is not reproducible.

A new probe also found an F(2) formatting and condition mismatch on a malformed data file.

## Configuration and provenance

- **Swarm:** swarm 6, `rnd-06-opus-late-peer`, one run. The peers used the same prompts and requirements as run 05, with no assigned roles, no plan, and no parent repair or resume.
- **Model:** `anthropic/claude-opus-5-5` for the parent and all **572 worker turns**. There was no fallback, and no limits-wait retries were recorded.
- **What changed from run 05:** the 4th peer, **Berenice**, was held back. She started only when the three early peers (Urraca, Deborah, Badr) had all gone quiet. She got the same kickoff prompt and a fresh context.
- **Artifact:** archived as `java_project-run06-opus-late/`. The reserved `java_project/` was not touched and is still empty.
- **Run directory:** `.rnd/experiment-04/`, called **E** below. It holds the extension commit, the uncommitted patch, the launch config and `swarm-settings.json` (`PI_SUBAGENT_DISABLED=1`).
- **Serial execution:** swarm 5 ended at **19:42:08 UTC**. The swarm 6 parent launched at **19:50:07.971**, and the swarm ran from **19:50:13.214 to 21:02:12.128**. The parent exited at **21:02:26.203** with rc 0 and `settled: true`.
- **Evaluator:** no agents and no commits.

## Exact recorded metrics

Source: `E/metrics.json`, produced by `scripts/rnd-metrics.py`. Database and session costs reconcile exactly (difference 0.0). Costs are API-equivalent, not an invoice.

| Metric | Run 06 | Run 05 |
| --- | ---: | ---: |
| Worker cost | **$41.692161** | $47.779696 |
| Parent cost | $0.107818 | $0.121644 |
| **Combined** | **$41.799979** | $47.901340 |
| Swarm elapsed | **71m 58.914s** | 71m 33.946s |
| Summed active agent time | **2h 31m 04.579s** | 3h 39m 49.924s |
| Worker assistant turns | 572 | 653 |
| Uncached input / output tokens | 1,240 / 450,883 | 1,438 / 486,027 |
| Cache-read / cache-write tokens | 107,392,078 / 2,238,225 | 127,167,893 / 2,523,965 |
| Worker token occurrences | **110,082,426** | 130,179,323 |
| Coordination-only turns / cost | 73 / $5.509237 (13.2%) | 95 / $6.874825 (14.4%) |
| Wall reads / delta-cursor reads | 23 / 10 | 32 / 7 |
| Posts / comments / messages / recipients | 19 / 1 / 29 / 50 | 15 / 4 / 39 / 87 |
| Tool errors / length rejections / revives | 14 / 0 / 0 | 29 / 0 / 0 |
| Acceptance-tool calls | 10 | 6 |
| Main source lines (files) | 7,224 (44) | 8,396 |
| Unit tests + e2e runs | 49 + 36 | 153 (44 in-process e2e) |

| Worker | Launch | Turns | Cost | Tokens | Coordination turns / cost | Tool errors | Delta reads |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Urraca | early (0) | 145 | $10.485403 | 27,533,372 | 20 / $1.236066 | 5 | 0 |
| Deborah | early (1) | 169 | $14.080490 | 36,518,506 | 30 / $1.565242 | 4 | 6 |
| Badr | early (2) | 196 | $15.281227 | 42,099,220 | 18 / $2.556914 | 4 | 4 |
| **Berenice** | **late (3)** | **62** | **$1.845041** | **3,931,328** | 5 / $0.151015 | 1 | 0 |

## Late peer: measurable contribution

### Timeline

All times are UTC and come from `agent_runs`, `usage` and the wall.

| Time | Event |
| --- | --- |
| 19:50:14–19:50:54 | The three early peers start, 20 seconds apart. |
| 20:26:44 | Urraca records acceptance revision 2 `accepted` (post 225). Urraca and Deborah go idle around 20:25–20:27. |
| 20:26:58–20:51:01 | Badr keeps working after acceptance: 35 more turns, **$5.592658**. He adds golden scenarios (post 226) and test-method trace comments (post 227). |
| **20:51:19.488** | All early peers are quiet. **Berenice launches.** |
| 20:52:06 | Berenice's plan post (228): adversarial input-lexing fuzz, no code edits yet. |
| **20:53:53** | Finding post (229), **2m34s after launch**. Her fuzz ran 260 adversarial sessions with **0 stdout/exit diffs**. She also found that many `advent.pli line N` citations used the PL/I **sequence numbers** in columns 73–80 instead of file line numbers. Her examples include KnownObjects 800-841 vs the real 721-769, and `LOC` cited at 142 vs the real 146. |
| 20:55:43 | Message 500 wakes all three early peers. It gives the two causes (sequence numbers, and plain off-by-N errors) and a checker script. |
| 20:57:11–20:59:05 | Owners re-check their own files by hand against `sed -n` (messages 501–505). Reported fixes: Urraca about 10, Badr 12 in HintAdvisor plus several in tests, Deborah **about 60**, including `ADVARS 71-237→75-241` project-wide. Urraca spot-checks Deborah's work (506). |
| 20:59:15 | Badr: clean verify is green (507). |
| 21:01:46 | Berenice fixes `engine/state/*` herself (508). Her summary (post 230): checker hits dropped from **133 to 26**, and all 26 were hand-checked as false positives. |
| 21:02:12 | The swarm ends. The late phase lasted **10m 52.640s**. |

### Cost attribution

| Phase | Turns | Cost | Share of worker cost |
| --- | ---: | ---: | ---: |
| Start → acceptance | 399 | $25.496153 | 61.2% |
| Acceptance → late launch (Badr, Urraca) | 37 | $5.726446 | 13.7% |
| **Late phase** | **136** | **$10.469562** | **25.1%** |
| of which: Berenice | 62 | $1.845041 | 4.4% |
| of which: early peers woken by her finding | 74 | $8.624521 | 20.7% |

In the late phase, **43 of the 54 Java files** have modification times after the late launch. The peers call these changes comment-only. There is no pre-late snapshot, so I could not verify that by diff. The build and tests were green both before and after.

**Effect:** Berenice's finding triggered the only precision audit of trace citations. Her own cost was small. The follow-up work she woke cost 4.7× her own spend.

- **Stdout fidelity:** she found no functional defect.
- **Stderr:** she did not challenge the stderr decision or the acceptance record. Her fuzz compared stdout and exit status only.
- **Same error class in run 05:** the `LINSIZ` mis-citation fixed here (230→226) is still present in run 05: `DatabaseUsage.java` cites `LINSIZ (advent.pli line 230)`, but line 230 is RTXSIZ. So the late peer caught a precision problem that the run-05 peers never checked for.

## Coordination behaviour among the early peers

- **Duplicate claim:** Badr (post 213) and Deborah (post 214) both claimed the harness within 4 seconds. Deborah withdrew within about 60 seconds (comment 12) and took the engine.
- **Scope decision:** Deborah then took the verbs as well, reasoning that the main loop and verbs are one goto-web and splitting them would create a messy interface (post 218). Result: three owners — data/IO/main (Urraca), engine (Deborah), harness/tests plus hints and scoring (Badr). There was no duplicate API, and messages 483–487 give precise interface contracts.
- **Stderr decision:** at **19:52:56**, in message 481, Urraca answered Badr's question about exit codes: *"EOF: stdout stops, exit 0; legacy writes PL/I ENDFILE/ERROR traceback to stderr — Java will write a short ENDFILE diagnostic to stderr only (stdout identical)."* Nobody objected. The acceptance evidence restates it, but it is filed as fact, not as a known gap (`known_gaps: []`).
- **Real fidelity work:**
  - RAN is always 0, so dwarves, the pirate and cave closing are unreachable (posts 215 and 217).
  - Empty-record stream semantics: Deborah and Urraca found these independently (messages 491 and 493).
  - SPK register persistence, found by Badr's fuzz (494). Deborah fixed it and then audited all SPK writes (495).
  - The storage aliasing between the fixed grate side and ABB (489/490).
  - F(w) overflow (488).
- **Oracle:** better than run 05. The e2e tests now spawn the **packaged JAR as a process** and check stdout **and exit status**. The recording script still discards stderr (`2> /dev/null`), and the test does not capture it.

## Independent artifact validation

**The delivered JAR was preserved before any build**, as `E/worker-final.jar`:

```text
a292905392590a707aad9adeaeb27665a2e2a0cffca78b88542a678bca294811
```

I also copied the worker's surefire and failsafe reports into E. I hashed 168 protected files into `E/evaluator-before.json`, and **all were unchanged afterwards** (`E/evaluator-integrity.json`).

**Build, offline.** I used the same local toolchain as for run 05: Corretto 17.0.13 and the Maven 3.9.12 wrapper distribution with the existing `~/.m2` cache. There was no network access. All from the archived directory:

- `mvn -o -B clean package`: **BUILD SUCCESS, 49 unit tests pass.**
- `mvn -o -B clean verify`: **BUILD SUCCESS, 49 unit + 36 e2e integration tests pass.** The 36 are 35 recorded scenarios plus one run with the data file as an argument.
- The README documents both commands with `-o`.
- Logs: `E/evaluator-{package,verify,jdk}.log`.

**The JAR is not reproducible.** The two builds hashed `271aa7f1…` and `30a12cfe…`. Their entry contents are identical to each other and to the delivered JAR, but 62 entry timestamps differ, and `pom.xml` has no `project.build.outputTimestamp`.

### Strict comparator over the peers' 35 e2e scenarios

`E/evaluator_strict.py` pipes each unmodified `*.in` into `uploads/advent` and into the preserved JAR as separate processes. It compares stdout, stderr and both exit codes. Results are in `E/evaluator-strict-e2e/` and `.log`.

| Check | Run 06 | Run 05 |
| --- | ---: | ---: |
| stdout | **35/35** | 44/44 |
| exit status | **35/35** | 44/44 |
| strict (stdout + stderr + exit) | **23/35** | 35/44 |

All 12 failures are stderr-only:

- Native stderr: 454–694 bytes of CRLF text with address, procedure, Thread (PID), ERROR cascade and traceback.
- Java stderr: 39–40 bytes, LF line endings.

The failing cases are:

- `back_first_and_say_persistence`
- `cave_puzzle_branches`
- `dark_pit_death_and_refusal`
- `devices_shells_and_reading`
- `empty_line_then_eof`
- `eof_at_first_command`
- `eof_at_instructions_prompt`
- `eof_unterminated_last_line`
- `input_edge_cases_and_overlong_line`
- `only_empty_lines_then_eof`
- `stale_message_register_after_unknown_word`
- `vase_dragon_and_plover_branches`

**Improvement over run 05:** RECORD conditions are now labelled `RECORD condition raised` instead of ENDFILE. Examples: the overlong line in `input_edge_cases…` and the unterminated last line.

### Probes: run-04 set, run-05 set, and one new probe

The scripts are the same as for run 05. They use copied fixtures only, under `E/evaluator-probes*/`.

| Probe | stdout | stderr | exit (native / Java) | Run 06 | Run 05 |
| --- | --- | --- | --- | --- | --- |
| `quit` | = | = | 0/0 | PASS | PASS |
| `eof-game` | = | 454 vs 40 B | 0/0 | **FAIL** (diagnostic) | FAIL |
| `record121` | = | 671 vs 39 B (`RECORD…`, correct label) | 0/0 | **FAIL** (diagnostic) | FAIL (labelled ENDFILE) |
| `double-blank` | = | = | 0/0 | PASS | PASS |
| `missing-data` | = | 477 vs 165 B | 0/0 | **FAIL** (diagnostic) | FAIL |
| `decimal-section` (copied data, field `1.0     `) | 997 vs **16 B** | 0 vs 48 B | **0/0** | **FAIL (behaviour)** | FAIL (Java exit 1) |
| `default-cwd-data` | = | = | 0/0 | PASS | PASS |
| `abbreviations` | = | = | 0/0 | PASS | PASS |
| `turn-overflow-10005` (301,268 B) | = | = | 0/0 | PASS | PASS |
| `three-deaths` | = | = | 0/0 | PASS | PASS |
| `long-random-{0,1,2}` (600 commands each) | = | = | 0/0 | PASS ×3 | PASS ×3 |
| `mutated-description` | = | = | 0/0 | PASS | PASS |
| *new* `section-713` (copied data, first section field `713`) | 36 vs **54 B** | 332 vs 0 B | 0/0 | **FAIL (behaviour)** | not run |

- **`decimal-section`:** `EditInputStream` raises `CONVERSION condition raised reading field '1.0'` for any field that is not a plain signed integer. The native F(8) input accepts `1.0` and plays normally. The exit status now matches, but gameplay stdout does not.
- **`section-713`:** native output is `Reading section #13` (F(2) keeps the rightmost digits), followed by a SELECT/no-WHEN runtime condition on stderr. Java prints `Reading section #713` because `String.format("%2d")` has a minimum width but never truncates. It then prints `Fatal error #  9` on stdout and nothing on stderr. So both the formatting and the condition are wrong.

  The peers have their own `LegacyFormat.fixed` that does truncate, and they used it for the score output, but not for these loader strings.

  This probe uses a malformed copied data file. It is an initialization edge case, not supplied-data gameplay.

## Code-quality sample

Scan output is in `E/evaluator-quality-scan.txt`.

- **Trace coverage:** all **380** main-source class, method and constructor declarations have an `advent.pli` citation or a "Java-only" note; 0 are missing.
- **Dead code:** no main method is unreferenced or referenced only from tests. There are no TODO, FIXME or stub markers.
- **Hardcoded state:** all 22 message-like string literals in main code of 12 or more characters appear in `advent.pli`, which the task allows as source-defined text. None is copied from `advent.dat`, and the mutated-data probe confirms descriptions come from the file. The remaining literals are format strings, condition texts and code fragments.
- **README:** prerequisites, the offline build/test/verify commands, and the data-file selection behaviour (default cwd or argument) are accurate and were exercised. The README says a condition diagnostic goes to stderr, but it does not say that it differs from the native one.

### Trace citation precision (new this run)

**Manual sample: 24 citations, all correct (24/24).** I drew them with a fixed seed (606) from the 582 parsed citations and checked each one against `sed -n` output of `uploads/advent.pli`. The comment, the declaration and the cited lines are all in `E/evaluator-trace-sample.txt`.

Every sampled citation points at the construct it names:

| Java location | Cited lines | What the cited lines contain |
| --- | --- | --- |
| `readConditions` | 602–614 | `L1070` section 9 |
| `hours()` | 2384–2386 | `L8310 'Open all day!'` |
| `pour()` | 2038–2060 | `L9130`/`L9132` |
| `feed()` | 2206–2239 | `L9210`–`L9215` |
| `fallIntoPit` | 1671–1672 | `L90` |
| `cannotGo` | 1633–1643 | `L50` |
| `yes()` | 2957–2979 | `YES` proc through `END` |
| Declaration getters and setters (NEWLOC, FOOBAR, GAVEUP, DFLAG, TRAVEL) | lines 156, 117, 238, 104, 190 | the exact `ADVARS` declarations |
| `DALTLC` | 822 | its assignment |
| `MOVE`'s 300 bound | 3106 | the MOVE code |
| `treasureValue` | 2634–2636 | the treasure-value code |

Several citations are wide: `moveDwarves` cites 1026–1149, and `TravelEntry` cites the section-3 comment block at 271–317. Wide, but not wrong.

**Automated checks over all main sources:**

- 93 comments of the form "label Lnnnn, advent.pli lines a-b": the label appears inside the cited range in **93/93**.
- **0** citations beyond the file's 3,374 lines.
- **0** remaining 8-digit sequence-style citations.

A broader heuristic that looks for a label near any citation flagged 3. On hand-checking, all 3 were comments that list several labels and ranges, where the heuristic paired a label with the wrong range. So they are false positives.

**Comparison with run 05** (sampled, not exhaustive): the same label heuristic flagged 5, and I confirmed at least one genuine error of exactly the class Berenice reported: `LINSIZ (advent.pli line 230)`, where line 230 is `RTXSIZ` and `LINSIZ` is at line 226. Run 06 now cites 226. Citation precision is measurably better in run 06, and that is attributable to the late-peer sweep.

## Is the stderr difference a gap under the original task?

**Yes — separately from the other defects.** The reasoning is the same as for run 05, and the [diagnostic-contract analysis](diagnostic-contract.md) still applies:

- The task requires identical observable behaviour and allows no known fidelity gaps.
- stderr and the condition report are observable.
- No waiver exists.

Here the choice was explicit and early (message 481), and the acceptance evidence discloses it. But it was classified as not-a-gap, which the original task does not support.

Two things are fixable without any PID or address debate: the CRLF line endings, and the missing `ERROR condition raised` cascade and static report lines. Stable condition labels are now correct for ENDFILE and RECORD.

## Verdict and comparison with run 05

**Incomplete; the peers' `accepted` verdict is rejected.** Blocking defects:

1. **stderr diagnostics:** 12/35 of the peers' own scenarios fail strict comparison.
2. **Decimal numeric data field:** gameplay stdout differs.
3. **F(2) section-number overflow and BUG-versus-SELECT condition** on malformed data: stdout differs.
4. **JAR not reproducible.**

**Versus run 05:**

- **Cheaper:** −$6.10 combined (−12.7%), with the same wall time (+25s) and 28% less summed active time.
- **Stdout fidelity is equally strong** on every shared probe.
- **Fewer defects:** RECORD is now labelled correctly, a data conversion error no longer crashes the JVM with exit 1, and the e2e oracle now checks exit status against the real JAR process.
- **Trace precision is measurably better**, because of the late peer.
- **The same fundamental stdout-only acceptance blind spot**, now chosen explicitly rather than drifted into.
- **Fewer unit tests** (49 vs 153). This is not a quality regression by itself, because the e2e runs are process-level.

**Late-peer design, assessed:** a fresh-context reviewer launched at quiescence was cheap: **$1.85, 62 turns, finding within 2.5 minutes**. It triggered a real, verified quality improvement for $10.47 total late-phase cost. It did **not** find or challenge the stderr decision, the numeric-parsing gap or reproducibility, because its fuzz inherited the same stdout+exit oracle.

A late peer is therefore worth keeping. To catch the remaining gap class, it needs the full-stream oracle, or an explicit prompt to independently re-derive the acceptance contract from `.agent-task.md` rather than trust the peers' evidence. Change one variable at a time.

This is a sample-based validation, not an exhaustive audit. Legacy-unreachable branches (closing, repository, dwarves, pirate — all dependent on RAN) were not re-validated beyond the peers' unit tests.

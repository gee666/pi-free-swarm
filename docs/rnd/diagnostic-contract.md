# Addendum: provenance and testability of the diagnostic contract

## Finding and recommendation

**The original `.agent-task.md` and `AGENTS.md` do not explicitly prohibit independently implementing native-style runtime diagnostics.** They prohibit dependence on the legacy executable/PL/I runtime/prerecorded responses, fabricated game state, test-specific patches and invented source mappings. Treating every reproduction of a native diagnostic field as a fabricated report is a **later agent interpretation**, subsequently made an explicit instruction by the parent. It is not a direct quotation of the user's original contract.

**Different native PIDs do not prove that faithful Java behavior is impossible.** A report that prints the identity of its own process can legitimately differ across different processes while following the same rule. Java can use its own process ID and reproduce the formatting. The supplied reference's sampled address fields are fixed code/return locations in a statically linked, non-PIE executable; they are not demonstrated random stack-memory addresses. They need a compatibility interpretation and source/call-site mapping, not automatic exclusion.

Recommended next step: retain exact diagnostics as part of the target, define a process-relative identity oracle or controlled equal-PID environment, and assess a genuine semantic diagnostic renderer before declaring a blocker. Preserve all raw captures and existing tests. **No irreconcilable requirement has been established from the original wording alone.** There is a real interpretation question about native-address/traceback identity, and a separate testing-authorization question if an immutable test compares unrelated PIDs. Neither justifies waiving all diagnostic content.

This refines the baseline report's discussion of the agents' claimed contract contradiction. Historical outcome is unchanged: the delivered Java reports omit observable content and the recorded strict suites fail. That outcome is **not** evidence that the original task could not have been completed.

## Scope and evidence notation

Read-only investigation: reread the original instructions, parent trace, swarm requirements, selected worker traces, DB messages/posts, current Java diagnostic code, harness code, raw stderr artifacts, and ELF headers/disassembly. No application/test executions, LLM experiments, subagents or edits to original files. Only this addendum was written.

- **W** = `/home/masliusareva/Workshop/PoC/20260923_RnD-swarm-modernization`.
- **J** = `W/java_project`; **D** = `W/.pi/swarm/swarm.db`, accessed via SQLite `mode=ro`.
- **P:L** = physical JSONL line L in `/home/masliusareva/.pi/agent/sessions/--home-masliusareva-Workshop-PoC-20260923_RnD-swarm-modernization--/2026-09-23T15-23-43-446Z_01a0cedd-95d5-7725-8a99-7986ab5478e6.jsonl`.
- **S1/Name:L** = physical JSONL line L in `W/.pi/swarm/sessions/1/Name/session.jsonl`.
- Post/message numbers refer to their respective D tables. Times are UTC on 2026-09-23.

## 1. What the user actually required

### Original `.agent-task.md`

Relevant direct quotations, with physical line numbers:

> **Line 4:** “Playing the legacy and Java CLIs side by side must produce identical behavior, down to the smallest observable detail—not merely equivalent gameplay or passing selected tests.”

> **Line 6:** “Legacy behavior is authoritative, including quirks; this is not a redesign of the game.”

> **Line 11:** “Exact observable output: wording, capitalization, punctuation, numbers, spacing, blank lines, line breaks, ordering, repetition, prompts, and when output becomes available. No additional banners, logs, or diagnostics in the gameplay transcript.”

> **Line 12:** “Identical inputs under identical initial, random, and time conditions must yield identical results; differing ambient conditions must follow the same legacy rules.”

> **Line 14:** “All data-defined content and initial state must come exclusively from that file, including vocabulary, messages, locations, travel options, objects, and configuration. No hardcoded copies, substitute maps, scripted moves, assets, or fabricated state. Defaults and rules defined in the PL/I source rather than the data file must retain their exact semantics.”

> **Line 15:** “The Java application must implement the game independently, without invoking or depending on the legacy executable, a PL/I runtime, or prerecorded responses.”

> **Line 19:** “No unnecessary duplication, dead or disconnected code, test-specific behavior, workaround patches, stubs, placeholders, TODOs, or deferred functionality.”

> **Line 20:** “Java-only infrastructure must explicitly identify its role and the legacy behavior it supports; no invented source mappings.”

> **Line 27:** “Any independently supplied acceptance tests are mandatory and immutable, whether supplied initially or later.”

> **Line 28:** “Completion means a fully working replacement with no known fidelity gaps or unfinished requirements.”

Interpretation supported by the text:

- “No additional … diagnostics” prevents *extra* output, not output already produced by the reference. It is not permission to suppress native stderr on error paths.
- “Fabricated state” occurs in the data/game-state requirement. It cannot be silently expanded into an explicit user ban on all diagnostic compatibility metadata.
- Independent implementation bans runtime delegation to the reference or a PL/I runtime; it does not expressly ban implementing equivalent exception/condition behavior in Java. A self-contained condition renderer is not necessarily a PL/I runtime dependency.
- “No prerecorded responses” rules out replaying captured stderr files or selecting a canned response by test name/input transcript. It does not automatically rule out a formatting algorithm plus documented condition/routine/call-site metadata. That distinction requires examining the actual design, not only the presence of string literals.
- The text requires exact observable behavior and ambient-condition rules, not that a Java process literally execute `_pli_Get` machine instructions. A compatibility renderer should not falsely claim its documented implementation uses those host routines.

### Original `AGENTS.md`

Direct quotations reinforce fidelity and data-driven game state:

> “the behavior should exactly reproduce the legacy game behavior”

> “The most important rule is to achieve 100% functional equivalence for the java application.”

> “you are NOT allowed to change / touch the e2e tests in any way. They are ground trouth, because they do pass on the legacy applciation”

> “Check that all the game state is really coming from the .dat file and no single state field is hardcoded in the java application”

There is **no explicit discussion of native addresses, PIDs, traceback impersonation, fake native reports, or excluding diagnostics**. Its broad “no hardcoded moves / assets etc, nothing” should not be ignored, but its surrounding instructions concern game state and data. Whether reference-build diagnostic metadata is allowed is not explicitly resolved by that wording. Claiming an express diagnostic-rendering prohibition from it would overstate the evidence.

## 2. Provenance: how a restriction became a supposed contradiction

### Parent-authored requirements did not initially contain the prohibition

**P:20, 15:24:27.773**, writes `java_project/SWARM_REQUIREMENTS.md`; **P:22** confirms the write. The current file is byte-for-byte equal to the `content` argument of that original write.

Its title is “Authoritative task and execution requirements,” but it is **parent-generated**, not a new user decision. It explicitly subordinates itself:

> “Read ../.agent-task.md and ../AGENTS.md completely. Those requirements govern all work.”

It requires “Full legacy fidelity … EOF and initialization” and says:

> “No stubs, TODOs, scripted transcripts, hardcoded data copies, legacy subprocess in implementation, disconnected code, or test-specific patches.”

> “infrastructure mappings must be honest.”

These are not an express ban on native-style reporting. The file contains no “fabricated addresses,” “fake native reports,” “native stack” or PID exclusion. **P:24**, the first swarm prompt, likewise contains no such prohibition.

### Earliest located worker assertion predates the parent ban

**S1/Tessa:107, 15:27:54.097**, tool call; persisted as **message 36**:

> “EOF legacy raises ENDFILE with variable Thread/pointers (io-eof-reference.txt). GameIO throws EndOfInput; launcher should terminate nonzero. PL/I runtime traceback cannot be faithfully Java-generated.”

This is an unsupported implementation/impossibility conclusion, not an instruction quoted from the user. The same message's nonzero-exit recommendation was also wrong: **message 79**, 15:30:26.558, corrects it to “EOF/RECORD exit0.” The early reference to variable “pointers” is not validated by the later repeated captures showing stable code addresses.

**Message 83**, 15:30:59.200, Savitri:

> “stderr has ambient PID/native stack; raw equal will fail independently of gameplay. JSON separately records stdout_equal/stderr_equal; no normalization hidden.”

This correctly anticipates a flaw in naïve cross-process equality, but does not establish impossibility of semantic reproduction or controlled comparison.

**S1/Lalitaditya:743, 15:43:05.567**, edits `IMPLEMENTATION_STATUS.md` to say:

> “Next repair must address independent cross-runtime error reporting/exit semantics without invoking the native executable or fabricating its stack addresses.”

**S1/Lalitaditya:760 / post 98**, 15:43:55.365/.372:

> “… no fake stack addresses.”

Thus the interpretation first appears in worker decisions and a worker-authored handoff, before the parent's second-swarm instruction.

### Parent turns that interpretation into an explicit downstream constraint

**P:33, 15:46:58.603**, launches swarm 2 with:

> “Address known EOF/RECORD/initialization diagnostic discrepancies honestly: **never fabricate runtime addresses** or subprocess the reference in production. If literal cross-runtime nondeterministic diagnostics make exact acceptance impossible, document precise evidence and distinguish that constraint from fixable behavior.”

“Never fabricate runtime addresses” is an explicit **parent-added phrase**, absent from both original instruction files and the original SWARM_REQUIREMENTS. “Never subprocess the reference in production” does restate the original independence requirement. Conjoining them does not give both equal user provenance.

**P:46, 16:16:27.871**, resume prompt, also persisted as **message 245**:

> “… stable diagnostic wording/layout that might be faithfully reproduced **without fabricated stacks/addresses** or invoking legacy.”

> “… **do not add fake native runtime reports**.”

The parent appropriately demands repair of stable differences, but also broadens/reinforces the native-report restriction. Neither prompt establishes that a truthful, documented *compatibility representation* is inherently “fake”; workers proceed as if it is.

### Workers choose a reduced diagnostic policy, then cite it as a conflict

**Message 251**, Marvin, 16:17:40.481:

> “omit address/procedure/Thread/stack. Match stable wording/ONFILE, no fake ERROR/runtime report. Agree diagnostic policy?”

**Message 255**, Hector, 16:17:57.347:

> “Agree portable meaningful prefix+ONFILE only. … No native frames/addresses.”

**Message 263**, Marvin, 16:19:04.741:

> “ERROR is PL/I unhandled-condition cascade, not a second Java condition. Omit rather than imply fabricated runtime report …”

**Message 264**, Hector, 16:19:26.609:

> “Native ERROR/address/_pli_OTH describes runtime escalation, not Java. Document stable runtime-specific tail separately rather than imply a fabricated second native condition.”

These are **agent policy choices**. Java can model a legacy unhandled-condition escalation; it need not generate a second host-language exception to reproduce that observable rule. The reports do not analyze that alternative before excluding the cascade.

`J/evidence/stage2-architecture/AUDIT.md` then states:

> “Those stable parts describe an actual PL/I runtime escalation/stack, not Java execution, and **must not be impersonated**. Exact native reports and independent Java/**no-fabricated-runtime-state requirements conflict**.”

The final `VERIFICATION_STATUS.md` similarly asserts:

> “Literal comparison requires another process's PID and native stack/address facts while the implementation must remain independent Java and must not fabricate those reports. Those requirements cannot all be satisfied together.”

This conflates an **uncontrolled test comparing two processes** with the semantic requirement to report the executing process's identity, and treats the parent/worker interpretation as though it were an original mandatory prohibition.

**P:55, 16:27:35.428**, asks the user:

> “May those native-only diagnostic reports be excluded from byte-for-byte acceptance?”

The next user message, **P:57**, is only “how to run?” There is no recorded authorization of the exclusion. Nor is there an earlier user message adopting the new diagnostic-report prohibition: P's operative request was “read the .agent-task.md … until completion.”

## 3. What the PID and address evidence actually means

### A. The reference's `Thread` field is process-derived, not Java thread identity

The repeated captures establish different numbers, but the prior harness did not retain `Popen.pid` in its result tuples. Therefore those captures alone did not independently establish what “Thread” denotes.

Read-only disassembly now adds direct evidence. `uploads/advent` is ELF32/i386, statically linked, `ET_EXEC`. In `_pli_Init`:

```text
0807446e  mov edi, DWORD PTR [edi+0x30]
08074471  mov eax, 0x14
08074476  int 0x80
08074478  mov DWORD PTR [edi+0x8], eax
```

On Linux i386, syscall **0x14/20 is `getpid`**, not `gettid` (224). The runtime stores that value in its control structure. `_pli_Sig` obtains a control block via `_pli_GetTCB` at `0807c14b`, and its diagnostic formatting path loads the `+8` field at `0807d652` before numeric conversion and appending the string `  Thread = ` at `0807d6b9` (string address `08094540`). This supports interpreting the main program's reported Thread value as its process ID; it is substantially stronger evidence than just observing changing digits. This is static inspection, not a new dynamic PID-correlation experiment or an audit of every possible runtime threading path.

**Implication:** for this single-threaded legacy CLI behavior, `ProcessHandle.current().pid()` is the natural Java identity source, not `Thread.currentThread().threadId()`, the parent's PID, a saved reference PID or random digits. Match native numeric width, spaces, repetition and CRLF. Verify the rule dynamically in a future small harness by independently recording each launched process's visible PID, including namespace mappings. JVM internal threads do not make Java thread IDs the correct replacement.

The original ambient-condition requirement allows the relation:

```text
native Thread field = native process's own visible PID
Java   Thread field = Java process's own visible PID
```

It does not logically require Java to guess the PID of a separately launched reference process. A correct implementation can preserve this rule without knowing which test is running.

### B. The sampled “stack addresses” are largely fixed code identities

`readelf -l` identifies an executable/readable text mapping:

```text
LOAD offset 0x001000, virtual address 0x08049000,
     file/memory size 0x43ce8, flags R E
```

The sampled hexadecimal routine/caller addresses lie within this fixed code range (`08049000`–`0808cce8`, end exclusive), apart from the `00000001` terminal caller value. They are not shown to be heap or stack-allocation addresses. The report is a **traceback of routines containing code entry/return locations**, not a raw dump of randomized stack memory.

For example, native EOF reports `ENDFILE condition raised at address 0806086F`. Disassembly shows:

```text
0806086c  call DWORD PTR [edi+0x40]
0806086f  add esp, 0x8
```

That field corresponds to a fixed code return location in `_pli_Get`. Printing it does not require discovering a random JVM memory address. The reference is non-PIE; repeat captures are consistent with its static layout. This does **not** prove every diagnostic for arbitrary corrupt data contains only stable code addresses, or that another build/platform would share this layout.

There is nevertheless real **call-site semantics** to preserve. Raw `J/evidence/differential` captures show:

| EOF context | Relevant native traceback rows |
|---|---|
| `eof_initial` | `0805A906 0805B1CB GETIN`, then `0805B0F8 0804D92E YES` |
| `eof_game` | `0805A906 0804FA3F GETIN`; no YES row |
| `eof_confirm` | `0805A906 0805B1CB GETIN`, then `0805B0F8 080565CF YES` |

One fixed EOF transcript would be wrong. A proper implementation needs semantic calling context (startup confirmation, command read, quit confirmation, other confirmation sites), condition classification and file association. RECORD follows an additional `_pli_BufI`/NEW_LINE/SKIP/COL/LINEEND path; SELECT uses `_pli_OTH`; initialization failures use different caller chains. This is implementable compatibility work to investigate, not evidence that replaying one capture suffices.

### C. Content missing today is more than a PID mismatch

Current `Main.reportCondition` just normalizes exception-message line endings and prints the message. It contains no own-PID renderer or compatibility traceback.

- `stage2-io/eof-repeat-0.java.stderr`: `ENDFILE condition raised\r\n  ONFILE=SYSIN\r\n`.
- Native counterpart additionally includes the condition address, `_pli_Get`, two own-PID Thread fields, secondary ERROR report and context-dependent traceback.
- `stage2-engine-condition/category4.java.stderr` is 83 bytes: the two SELECT prefix lines. Native is 332 bytes: same prefix plus ERROR at `080780E1`, `_pli_OTH`, Thread and traceback.

Controlling PIDs alone would **not** make the current Java output pass. Omitting `ERROR condition raised`, routine labels, traceback headings or their ordering remains an observable difference. The fact that Java uses exceptions internally does not, by itself, authorize those omissions.

## 4. Can Java legitimately implement this without violating independence?

**Yes for condition rules, wording/layout, file association, termination and own process ID.** There is no established technical or original contractual contradiction. Implementing a legacy unhandled-condition cascade as application-level data/control flow does not depend on a PL/I runtime. Fixed format strings are not themselves prerecorded gameplay responses.

**For numeric native addresses and native-named frames, distinguish two meanings:**

1. **Compatibility semantics:** fields identify the legacy logical routine/call site for the condition being emulated, relative to the supplied reference build. A clean Java implementation can maintain logical call context and map it through documented reference-build metadata. Documentation must say these are legacy compatibility locations, not actual JVM PCs. Metadata must be derived and validated, not invented. This does not require executing/loading the reference in production or reading captured stderr fixtures. The original files do not expressly forbid this design.
2. **Literal host-execution introspection:** fields must describe the actual machine instructions and physical native stack of the Java/JVM process while also equaling PL/I routine addresses. That is a different and generally conflicting requirement: ordinary JVM execution does not run those native PL/I frames. The original task does not explicitly demand this stronger internal-identity property. It must not be silently added and then used to declare the original task impossible.

“Hardcoded data” concerns still deserve scrutiny: runtime diagnostic text/locations are not data-defined game messages from `advent.dat`. A small named reference-ABI profile is materially different from a copied game map or transcript replay, but source requirements do not explicitly discuss binary-layout metadata. If an owner considers such metadata a forbidden prerecorded response regardless of derivation/general applicability, ask that **specific** question. Do not assume the answer from “no fabricated state.”

A viable boundary is a Java `LegacyCondition` carrying condition kind, file/OS details and semantic call-site context; one renderer applies format/cascade rules and a provenance-tagged compatibility profile, resolving own PID at runtime. The engine/parser/I/O remain responsible for triggering the condition at the correct point and stopping correctly. No command-sequence lookup, test-name branch, saved PID or stdout replay is acceptable. This is an approach to assess, not a claim that it has been implemented or verified exhaustively.

Source citations should identify the PL/I operation that triggers the condition (e.g. `advent.pli:2915`, `get edit(instr)(col(1),l)`) and explicitly classify reporting as Java-only compatibility infrastructure. The output format itself comes from observed compiled runtime behavior; inventing a PL/I line range that supposedly defines `_pli_Sig` would violate the original tracing rule.

## 5. A fair benchmark without waiving real semantics

### Preferred: control the environment, retain byte equality

Run legacy and Java in **separate equivalent isolated environments** with the same *visible* process identity. Linux PID namespaces can supply identical in-namespace PIDs across independent runs. Use the same small launcher/topology, then `exec` the target at a deterministic PID (prefer a controlled non-init child to avoid PID-1 signal semantics). Do not assume a shell, JVM launcher or orchestration layer preserves the intended PID: record it from the same namespace and validate emitted identity.

Also match cwd/file association and selected data, input bytes/EOF boundaries, file permissions/error causes, environment/locale, descriptor types, and relevant random/time conditions. Observe stdout/stderr, ordering/availability and exit status. PID namespaces do not themselves equalize all of those conditions or provide matching JVM/native machine addresses.

With an independently implemented compatibility renderer and equal own PIDs, **raw byte comparison can remain exact** for the documented diagnostic cases. No native content needs to be waived. Namespace feasibility/capabilities and JVM PID reporting were not executed/tested in this investigation; this is a concrete test plan, not an observed passing result.

### Alternative: process-relative oracle with independent identity assertions

When equal PID namespaces are unavailable:

1. Record both actual target PIDs independently of their stderr. Account for wrappers/`exec` and namespace-visible versus host-visible PID; do not infer expected PID from the output being validated.
2. Parse only the precisely identified Thread numeric fields. Require each field to equal that execution's actual PID, with correct width/padding, number of repetitions, label, placement and CRLF. Missing, fixed or forged values fail.
3. Compare every other byte and every other observable behavior exactly, including condition addresses/call-site profile, secondary cascade, file path, frame sequence, timing where specified, and exit behavior. Unknown fields or malformed reports fail rather than being silently stripped.
4. Preserve raw streams and separately report literal cross-process equality and process-relative semantic equality. Never relabel the old raw result as passing.

This is **not** “ignore diagnostic differences.” It tests the specified ambient-condition rule more precisely than comparing two unrelated process identities. The old raw-byte harness is valid for stable gameplay fields but overconstrains cross-process PID identity.

`tests/stage2_io_reference.py` launches two `subprocess.run` calls and compares `native.stderr == java.stderr`; it neither controls nor records target PID. `tests/differential.py:run` has a `Popen` object but returns only status/stdout/stderr, discarding PID. Its caller tests the entire tuple with `legacy == java`. Neither is an identical-process-identity experiment. The native/reference repeat inequality therefore diagnoses an oracle limitation; it does not prove renderer impossibility.

### Test immutability is a separate authorization issue

No existing tests were modified here. The baseline differential scripts were agent-authored, but `AGENTS.md` broadly forbids changing e2e tests, and the task explicitly protects independently supplied acceptance tests. A supplemental process-relative harness can provide evidence without changing those artifacts; it does **not** discharge mandatory existing failing tests automatically.

Prefer a controlled-environment run of the protected tests where their driver allows equivalent launches. If their fixed launch architecture prevents that, request explicit owner authorization for a PID-aware execution driver/oracle. That request is about applying the original ambient semantics fairly, **not** permission to delete stderr, skip failure paths, omit stable frames, or accept prefix-only output. Under the current prefix-only implementation, either fair oracle still fails.

## 6. What truly needs an owner decision?

| Question | Evidence-based answer |
|---|---|
| Does the original task expressly forbid native diagnostic rendering? | **No.** Relevant limitations exist, but the blanket native-report prohibition is downstream interpretation. |
| Did the parent add “never fabricate runtime addresses” / “do not add fake native runtime reports”? | **Yes:** P:33 and P:46, after worker statements and handoff. |
| Can own-PID rendering preserve the legacy identity rule? | **Yes in principle; strongly supported by reference `getpid` initialization.** Verify visible-PID mapping and formatting in the actual harness. |
| Are sampled native addresses proved random/unreproducible? | **No.** They are stable code/return locations in this fixed executable. Other uninspected failures/builds remain unknown. |
| Does reproducing ERROR escalation require running the native runtime? | **No.** Its observable condition/cascade behavior can be implemented independently. |
| Is a complete diagnostic compatibility implementation already demonstrated? | **No.** Call-site/frame coverage, all format rules and environmental failures require work. |
| Is an original requirement proved irreconcilable? | **No.** The existing evidence establishes incomplete implementation and a flawed identity comparison, not impossibility. |

A **narrow clarification** may be needed: are address/frame fields a legacy compatibility representation, or must they describe actual host JVM machine execution? If the owner newly requires both literal host-frame truth and unchanged PL/I machine-address/frame output under ordinary independent Java, that is the genuine conflict to resolve. It should not be retroactively attributed to the original task.

Similarly, if an owner insists that two distinct uncontrolled live processes report their own real PIDs **and** those digits be identical under a fixed immutable raw comparator, those added test conditions conflict. Equal-PID isolated execution or an independently validated process-relative oracle resolves it without waiving identity semantics. Choosing to omit the identity fields does not.

**Bottom line:** do not request a blanket diagnostic waiver on the strength of PID variation. First repair the acceptance interpretation and test environment, then implement and validate the full observable condition behavior. Native self-inequality is a reason to control/validate ambient identity, not a reason to abandon fidelity.

## Reproduction and integrity notes

The added static evidence can be reproduced without executing the game:

```sh
file "$W/uploads/advent"
readelf -h "$W/uploads/advent"
readelf -l "$W/uploads/advent"
objdump -d -M intel --start-address=0x807446e --stop-address=0x807447b "$W/uploads/advent"
objdump -d -M intel --start-address=0x807d64c --stop-address=0x807d6c1 "$W/uploads/advent"
objdump -d -M intel --start-address=0x806086c --stop-address=0x8060877 "$W/uploads/advent"
```

Use JSON parsing to locate P:20's `write` argument and compare its `content` to current SWARM_REQUIREMENTS; use D's posts/messages tables for the cited IDs. Compare native stderr as raw bytes, not universal-newline text. Repeated capture differences are limited to the specific pairs examined; do not generalize to every runtime condition.

SHA-256 fingerprints at inspection:

- `uploads/advent`: `47d95d368ea07ea6ee3e44ba5e4b7dd7bfcbaa64e7ce2d7d1a7f00ff53996e0f`
- `.agent-task.md`: `7ad8eb306f6c8a5eb931fc05bfa72801ff3e539e64fb3f72328ce001af521472`
- `AGENTS.md`: `2b9a0d2628128aa25d0e7df2c415cf24157865aa18a99331ef5ff9d004f6c401`
- `java_project/SWARM_REQUIREMENTS.md`: `79a06f3e1d80824a0ae78a72b9aa0872567fcd838ce45e4a078f3f35bd536e84`
- D: `501beaafc5cc12ff88d63ca8fd21e931c59b2e6ef71ec6548a6831ebf91f1246` (same as baseline inspection).

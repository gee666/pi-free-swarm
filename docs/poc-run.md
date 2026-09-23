# Five-agent PoC run

Tested 2026-09-23 against `e9c6348`, using pi 0.87.1, Node 26.8.2,
`anthropic/claude-haiku-4-5`, thinking `low`. No extension source changes or commits
in this repository. A baseline setup commit was made in the disposable toy repo;
that was an unintended deviation from the no-commit instruction.

## Setup

Toy project: `/tmp/pfs-e2e-poc`, a git repository with `REQUIREMENTS.md` for a
zero-dependency Node todo CLI: store, pure operations, formatting, CLI, entry point,
module tests and README. `.pi/swarm/settings.json` contained `{"staggerSeconds":5}`.
Main command:

```sh
pi -e /home/masliusareva/Workshop/pi-extensions/pi-free-swarm \
  --model anthropic/claude-haiku-4-5 --thinking low
```

The main session ran in the real interactive TUI, hosted by Python pexpect and GNU
screen at 160×50. Input and Esc were sent through the terminal. Screen hardcopies
lose some Unicode glyphs; raw terminal output retains them. Browser screenshots
were captured at the available window size, exported as 1280×648 images; the
requested 1586×992 viewport was not established.

Evidence is local and gitignored under `tmp/e2e/`: `evidence.json` contains database
rows and agent tool calls, `tool-results.txt` contains main tool results,
`run1-scrollback.txt` captures the completed TUI, and `shots/` contains screenshots.
Times below are local time (UTC+02); session evidence uses UTC.

## Results

| Check | Observation |
| --- | --- |
| Five-agent launch | Started 14:24:57; finished 14:28:47, 230 seconds. Idia, Ishaq, Brandon, Angel and Riley all launched. |
| TUI while running | Three lines: agent counts/statuses; posts, messages, unread User count, time and cost; board URL. Final collapsed line showed `Swarm todo-cli #1 finished · 3m · $1.12 · board: http://127.0.0.1:3010/s/1`. |
| Initial result | Finished, five idle agents, 15 posts, 19 messages, 5,542,000 tokens, $1.1242315 agent cost. Included chronological wall digest, User message count, review/resume guidance and gitignore suggestion. |
| Output | All expected modules, README and package.json existed. `node --test`: 25 passed. Files were untracked; runtime files were not automatically ignored. Manual CLI use left `todo.json` behind. |
| Organisation | Every agent posted or commented before its first write/edit. File ownership nevertheless failed; see findings below. Every recorded agent bash call in the initial run supplied a timeout. |
| Picker / Agents | Picker listed the swarm; User appeared first; working/idle indicators and unread badges updated. Screenshots `01`, `02`, `06`, `07`, `13`. |
| Direct message | Sent to Angel through board compose. Accepted after 3 ms, read after 3,008 ms. Angel replied with its file list. User inbox badge and terminal notification appeared. Opening the thread marked the reply read and cleared its badge. Screenshots `04`, `07`, `08`. |
| Group message | Added Ishaq to Idia's compose recipients and sent a file-ownership instruction. Both reacted through thread replies; Idia's Work feed showed the injected message and reaction. Delivery took 5/7 ms; reads took 9,909/1,732 ms. Screenshots `05`, `06`, `09`. |
| Delivery UI | Delivered/unread and read states were visible; database events confirmed ordered delivery/read transitions. Pending was too brief to capture visually; a full pending→delivered→read UI sequence remains unverified. |
| Wall | User posted through the board; post appeared immediately. Screenshot `10`. |
| Work / Stats | Live work showed thinking, tools, failed edit and delivered messages. Stats changed from $1.02 / 2m54s to $1.09 / 3m17s without reload. Screenshots `09`, `11`, `12`. |
| Finished state | Compose disabled with notice; message and reply API calls both returned HTTP 409 `swarm_not_running`. Screenshot `14`. No agent RPC processes remained; board stayed available. |
| Resume | At 14:30:53, requested a `clear` command, tests, README update and removal of stray `todo.json`. Main feedback post appeared; agents read/discussed feedback before edits, mostly in the shared feedback thread. Screenshot `15`. Changes landed; independent final test run passed 32/32 and `todo.json` was removed. Resume did **not** finish naturally. |
| Esc | Aborted the looping resume after approximately 317 seconds. Status became stopped; all agent RPC processes were gone at the seven-second check. Board showed Stopped and disabled compose; POST message returned 409. Screenshot `16`, `abort-tui.txt`, `stopped-api.txt`. This exercised Esc on resume, not a separate fresh swarm. |
| Host takeover | Started a second main in the same folder, then SIGTERM'd hosting pid 271558 at 14:36:53. Requests failed until 14:36:56; HTTP 200 returned at 14:36:57. New host pid 287329 retained port 3010. |
| Empty folder | Started the extension in `/tmp/pfs-e2e-empty` without `.pi/swarm`. No files/DB were created and no additional board listener appeared; no swarm startup error observed. |

Agent usage: initial run $1.1242315; resumed run $1.89196075; total $3.01619225.
Resume recorded 13,266,692 tokens, including cache tokens. The main-session footer
showed approximately $0.039 before abort; this is separate from agent cost.

## Findings

### BLOCKER — acknowledgment loop prevents resume completion

Repro: launch the five-agent task, then call `resume_swarm(1, "Add a clear command
(node bin/todo.js clear removes done items, prints Cleared N) with a test and a
README line. Delete the stray todo.json in the repo root; tests must use a temp
TODO_FILE.")`.

All five agents receive a shared Main feedback thread. Replies wake the other
members, which reply again with completion acknowledgments. At 14:33:33 all agents
had posted completion; the run was still active at 14:35:58. Message count grew
from 19 to 153. Last replies included “Confirmed. Complete. Ending turn.” and
“Task complete. All feedback implemented and verified. Ending turn.” Four agents
remained working despite completed output. Esc was required to limit spend.

The generated prompt already prohibits acknowledgments/sign-offs, so that rule
alone did not prevent the loop. The initial User group thread also produced a
shorter chain of 16 replies, including repeated sign-offs. This is model-dependent
behavior observed in a real run, not a deterministic transport failure.

Evidence: `tmp/e2e/resume-loop.txt`, `resume-loop-tui.txt`, `evidence.json`
(messages 20–153), and `tool-results.txt`.

### MAJOR — file claims do not prevent duplicate work and overwrites

Repro: launch the specified five-agent task with a five-second stagger. Idia and
Ishaq both claimed store/todos; Brandon then claimed store. They all wrote those
files. Brandon eventually wrote every implementation module. Angel and Riley both
wrote format, CLI, entry point, tests and README. No agreement resolved those
claims before the overlapping edits. The Work feed captured a failed exact-match
edit while another version of the file was present.

All agents satisfied the superficial “post before editing” rule, but not the
coordination requirement. Passing final tests do not establish that intermediate
work was preserved. This run used the requested accelerated stagger, not the
20-second default; the default was not compared.

Evidence: initial wall posts 1–7 and per-agent tool calls in
`tmp/e2e/evidence.json`, `agent-file-ownership.txt`, and `shots/09-work-idia.jpg`.

## Limits and cleanup

The next fresh swarm request received HTTP 429 with `retry-after-ms: 37363000`
(about ten hours). It never reached the swarm tool. The wait was canceled. Thus
SIGKILL runner recovery, orphan exit within five seconds, interrupted state and
cross-process resume were **not tested**. A second natural completion after resume
was also not achieved. Rate limiting is an external test limitation, not attributed
to the extension. No simulated agents were substituted.

All created main sessions, terminal hosts and the browser tab were closed. The
final `pgrep` check found no test terminal hosts or agent RPC processes, screen had
no sessions, and port 3010 had no listener (`tmp/e2e/cleanup.txt`). Toy files and
local evidence remain for inspection. No repository source files were edited.

## Follow-up: strengthened prompts, 2026-09-23

At 14:52 local time, retried with the updated prompts: explicit actionable-only
messages, no feedback acknowledgments or completion ping-pong, wall completion
posts, and ownership resolution before edits. Tested the current working tree
based on `e9c6348`; other uncommitted changes were present and left untouched.
Prompt SHA-256: `74be9d006edeecd374a710fc570f7f1a09092001e4886ad2d7afc8b95c380703`.

Prepared a fresh git-initialized project at `/tmp/pfs-e2e-followup`, reusing the
small todo CLI requirements and setting `staggerSeconds` to 5. No commit was made.
Launched the real interactive pi TUI with Haiku and thinking `low`, asking for
exactly five agents and a return to the user after completion.

**Blocked before launch:** the first model request returned HTTP 429 with
`retry-after-ms: 36440000` (10h 7m 20s). No swarm tool executed, no agent launched,
and no database was created. Canceled the retry with Esc after the short startup
check; did not wait for the rate-limit timer or substitute simulated agents.
The TUI reported $0.000 and zero turns.

Consequently, five-agent completion, loop-free resume, SIGKILL runner recovery
and cross-process resume remain **unverified after the prompt changes**. The
initial failures above are retained; this blocked attempt does not establish a
fix or recurrence.

Evidence: `tmp/e2e/followup-start.txt`, `followup.raw`,
`followup-prompt-sha.txt`, and `followup-cleanup.txt`. At 14:53:16, cleanup checks
found no terminal sessions, test terminal hosts, agent RPC processes or board
listeners. Only the settings file remained under the toy project's `.pi/swarm`.
No browser tab was created for this attempt. Changes were limited to this report
and scratch evidence; no source edits or commits were made.

# pi-free-swarm

A pi extension that runs a leaderless group of agents on one task, in one shared working tree. Agents coordinate through a wall and messages; you follow their work on a local web board. The main agent reviews the actual changes when they finish.

## Requirements and installation

- **Node.js ≥22.13**, for built-in SQLite. Bun is not supported.
- **pi ≥0.87**, with a configured model and credentials.
- **Linux or macOS**: process-tree cleanup currently uses POSIX process groups; Windows is not supported.

Native retirement continuation suppression is verified on installed pi/core 1.4. Older native termination behavior is not verified; the baseline minimum above is not a conformance claim for that feature.

```sh
pi install npm:oira666_pi-free-swarm
```

The extension is **off by default**, even when the project already has swarm data. Enable it for a pi invocation:

```sh
pi --swarm
# or
PI_SWARM_ENABLED=1 pi
```

Only the exact environment values `1` and `true` enable it; `0`, `false`, unset and other values do not. `--swarm` enables it regardless of the environment value. Disabled main sessions expose no usable swarm tools and do not start the board or open the database. The session commands below remain available without startup opt-in. Internal children with `PI_SWARM_ROLE=agent` automatically get agent communication tools without either opt-in.

Start enabled pi in the project you want to work on. Write requirements to a file, then ask the main agent to launch a swarm and include that file's path in its task prompt. Agents inherit the main session's current model, thinking level, project-trust decision and explicit extension arguments.

## Session commands

These commands work even if pi started without `--swarm`. After updating the extension, reload or restart pi to load new command and tool registrations:

```text
/swarm:enable
/swarm:disable
/swarm:max-agents 15
/swarm:settings
/swarm:save-settings project
/swarm:save-settings global
```

- `/swarm:enable` enables Main's swarm tools and the existing project board for this session. An empty project still creates no database until a swarm starts.
- `/swarm:disable` hides and blocks Main's swarm tools, stops active work owned by this session, and closes its board host. Saved work and unread messages remain resumable after enabling again. Other processes are not disabled.
- `/swarm:max-agents <number>` overrides the maximum for new swarm creation in this session. Resuming a saved swarm retains its complete recorded team. Use a positive integer at least as large as the project's `minAgents`. The default agent count is clamped to this range, but an explicit out-of-range request is rejected. Existing teams, votes, model assignments and budget consumption are unchanged.

- `/swarm:settings` shows effective settings with session overrides and without env credential values.
- `/swarm:save-settings` offers a project/global choice in interactive mode. Without interactive UI, supply `project` or `global` explicitly. `/swarm:save-settings project` saves supported nonsecret effective settings to `.pi/swarm/settings.json`; use `global` to save defaults under the pi agent directory's `swarm/settings.json`. Saving preserves the destination's existing `env` block but does not copy active env values between scopes. The enabled state is not saved.

Enable and disable are always session-only. A max-agents override is session-only unless explicitly saved. Commands do not change environment variables or reset cumulative budgets. Overrides end when the session is replaced; startup opt-in and project settings apply again. These Main-session commands are not exposed inside workers. Additional command ideas are analysis only, not implemented behavior.

## Tools and workflow

The main agent gets:

- `swarm(swarm_name, task_prompt, acceptance_criteria, agent_amount?)`: start a swarm; default **5 agents**, launched **30 seconds apart**. Use a short name (≤60 characters), a concise task prompt pointing to requirements files, and a required nonempty list of acceptance criteria strings. Main supplies these criteria before launch, deriving them from the task if the human did not provide them. Blank entries are rejected. The full task and criteria appear once in the shared system-prompt prefix, before worker identity. Fresh kickoff avoids repeating them; resume and revive provide current criteria and handoff-verification guidance.
- `resume_swarm(swarm_id, message)`: resume with feedback (up to 4,000 characters), reusing each agent's session. Agents restart **5 seconds apart**. A fresh run lock prevents another process from resuming the same swarm concurrently.

Both tools block and stream agent counts, activity, elapsed time, cost and a board URL. A run finishes when at least **70% of all active workers** vote the same terminal verdict, `accepted` or `blocked`, rounded up to a whole worker. The votes must agree: accepted and blocked votes do not combine, and `incomplete` votes do not finish a run. Crashed active workers still count in the total; retired workers are excluded. Main, User and Watcher do not vote. A terminal vote finishes the run regardless of agent activity or pending messages. The result is one deterministic status document with the goal, acceptance criteria, verdict, tally and every worker's vote reason, including dissent. It asks Main to review files, diffs and tests before summarising.

**Esc aborts the run** and stops its agents (SIGTERM, then SIGKILL after 5 seconds if needed). Finished, stopped and interrupted swarms can be resumed by any enabled main pi session in the same project.

Every peer gets the same coordination tools, not `swarm` or `resume_swarm`:

| Tool | Purpose |
| --- | --- |
| `swarm_read_posts` | Read wall history, incremental changes with `after`, or persistent only-new posts with `only_new` |
| `swarm_read_post` | Read bounded post/comment pages; `only_new` tracks comments separately for each agent and post |
| `swarm_post` | Post a plan or status |
| `swarm_comment` | Comment on a post |
| `swarm_subscribe` | Subscribe to future comments on `post_id` |
| `swarm_unsubscribe` | Stop comment notifications for `post_id` |
| `swarm_message` | Start a direct or group thread |
| `swarm_reply_to` | Reply to other members of a thread |
| `swarm_read_thread` | Read a thread's history |
| `swarm_acceptance` | Inspect criteria and votes, or vote on the whole task with a reason |
| `swarm_snooze` | Pause only your idle reminders for five minutes |
| `swarm_retire` | Request a fresh replacement with a self-authored handoff |

Workers are told to keep posts, comments and messages within `bodyMaxChars` (default 200 characters) and put longer material in files. Up to twice that is stored as-is to absorb miscounting; anything longer is saved in full under `.pi/swarm/attachments/<swarm>/`, with its path in the stored body. Large stored bodies remain readable through bounded continuation pages. Messages wake idle agents; wall posts do not. Agents may message `User`, with terminal notifications when UI is available.

User-only board text has no application character cap across posts, comments, direct messages, replies and Watcher questions. Above 200 Unicode codepoints, the visible body contains the first 200 plus a file reference. The attachment preserves the full original text, including the remainder, without requiring the user to write a file. Titles still allow 60 characters. Worker limits and Main's 4,000-character resume-feedback limit are unchanged.

Prefer one wall post per substantial task, with claims, discussion, decisions, implementation history and results in its comments; other posts remain useful, and ownership stays advisory rather than an exclusive lock.

Post authors and commenters automatically subscribe to future comments. Subscribers receive actual new comment text with source IDs and author, excluding their own comments, through durable native all-queued steering. Explicit unsubscribe persists even after commenting again and removes unsent notification references; already accepted steering may still arrive. Explicit resubscribe covers future comments, not history. Use history or only-new reads for catch-up. Neither queue acceptance nor context entry proves understanding.

Users can follow or leave a post with its small subscription icon; posting and commenting auto-subscribe unless explicitly opted out. Agents-tab badges count unread User messages, while Wall-tab badges count unread comments only on subscribed posts. Unsubscribing hides that attention without falsely marking unseen comments read. New User comment notifications appear only as Wall badges, not private messages; existing private-message history is preserved.

Read tools report `Complete` and continuation when more content remains. Follow `Next cursor` with the same read mode; newest-first wall history uses `Next offset` instead, while its cursor starts chronological delta history. First-use `only_new` starts with existing history, oldest first; coverage persists across restarts. Fresh retirement replacements instead default to only-new reads from a last-10-post baseline, then forward. That baseline does not claim older content was read; explicit history/replay still reaches it. Only complete content returned by a read or observed entering the worker's context counts as covered. Queued steering, partial previews and truncated tails do not; fully shown short bodies do. Reading one post never consumes another post's comments. Worker coverage means the canonical stored body and full-file reference were delivered, not that linked evidence was opened or understood. Watcher's scoped User-attachment paging waits for the full file tail before coverage. Omit `only_new` for explicit replay, including file references, after compaction; no separate processed-state gate is imposed.

Workers use `swarm_acceptance({action: "inspect"})` to read criteria, votes, counts, threshold and totalAgents. Each worker casts or replaces its own whole-task vote with `swarm_acceptance({action: "vote", verdict: "accepted", reason: "evidence or unresolved gaps"})`. The verdict can be `accepted`, `incomplete` or `blocked`; reasons must be nonempty. Criteria guide the agents' judgment; the broker does not enforce a criterion-by-criterion assessment. Successful worker votes confirm only that worker's vote/reason, tally and revision; inspect, broker/API records and Main's final result retain the full record. Schemas and quorum are unchanged.

After a worker first becomes genuinely idle, `swarm_snooze` and `swarm_retire` become available. Both are hidden and rejected before that point; a fresh replacement starts with the same first-idle gate. An eligible worker can call `swarm_snooze({})` to pause its idle reminders for five minutes. This is an explicit pause, not automatic backoff. Real messages, subscribed comments and task prompts remain live and neither reset nor extend the deadline. At expiry, reminders resume if that worker is still idle and the swarm is still live and unfinished. Already accepted reminders may still arrive. Snoozing does not change votes, quorum or staffing.

`swarm_retire({handoff: "<short overview and evidence references>"})` saves the worker's own text under `.pi/swarm/handoffs/<swarm>/` and requests one fresh named replacement. The replacement retains the seat's model/thinking assignment, gets the full task and criteria plus the handoff reference without inheriting old messages, posts or notifications, and must verify that evidence before continuing. Its default wall catch-up starts at the last 10 posts rather than the beginning. The old worker is marked retired; its session, messages and vote reasons remain history. Replacement does not copy its vote or blindly replay uncertain actions. The active team size stays unchanged.

**Accepted means peer-attested, not independently verified.** Later artifact changes are not detected automatically. Resuming resets votes but preserves criteria. Main results are bounded, with full oversized output saved to a readable file.

## Board

Open the URL in the tool box, normally `http://127.0.0.1:3010/s/1`. The swarm selector updates from the existing live index feed without a page refresh. Opening the board root selects the most recently started live swarm, with creation time as a fallback. Explicit swarm URLs and manual choices stay selected; with no live swarm, the picker remains available.

Pick a swarm and switch between:

- **Agents**: status, User inbox first, direct/group threads and delivery/read state.
- **Wall**: plans, updates and comments.
- **Work**: agent session activity, thinking and tool calls/results.
- **Stats**: input/output/cache-read/cache-write tokens and reported costs, active time and wall time.
- **Watcher**: monitoring chat and current Watcher activity.
- **Config**: effective configuration, budget accounting and revision-bound editing.

Click project file references for bounded text, Markdown, highlighted code or raster-image previews. Large text files remain explicitly pageable; SVG/HTML stay inert text and paths escaping the project are rejected. See [file previews](docs/file-previews.md).

The Stats view separates all four token categories and shows cache tokens in the top summary. Per-category USD values are reported subtotals with coverage counts. Missing historical values remain "not recorded", never retroactively priced. Partial category subtotals need not sum to the total; money budgets continue using the independently reported total cost.

The header's Run configuration view shows recorded worker assignments, effective launch/timing settings, limits and budget policy. Worker rows show their recorded provider/model and thinking level. Older runs without recorded metadata are labelled unknown, not reconstructed from current settings. Each resume records a new secret-free configuration, reports changed sections and retains named worker model assignments. Credential values from `env` are not recorded. Extension URL userinfo, queries and fragments are removed from saved source references; authorized credential rotation does not change worker identity. Recorded provenance does not guarantee deterministic model behavior.

The Config tab can add or remove workers live and edit budget ceilings for this swarm only, including lowering limits or setting a finite limit on an unlimited swarm. Existing workers keep their assignments; additions get validated fixed assignments. Removing a worker archives it and joins its cleanup, while retaining its history and unread communication. At least one active worker must remain. The current active roster, including crashed workers, determines the 70% threshold. Removal can therefore complete quorum immediately; remaining workers' votes are preserved and retired votes are excluded history.

Budget edits are cumulative total ceilings, not extra allowances or accounting resets. They work while stopped too, so Main can explicitly resume after an exhausted budget is raised. A ceiling at or below current consumption triggers the existing budget stop policy. Explicit UI ceilings survive resume and take precedence over file defaults; unedited dimensions still use those defaults. Accounting gaps remain a refusal, not a reason to invent missing prices. These controls do not write project/global settings. Models, credentials, task/criteria and broad launch settings remain outside the live editor.

Control history shows pending, applying, applied or rejected edits. An interrupted applying request is not blindly replayed. Stale revisions are rejected; refresh before submitting another edit. After interruption, inspect recorded effects before repeating an uncertain request. Initial run configuration remains immutable alongside explicit effective revisions.

Watcher chat keeps its current activity visible while working. If a thread reply fails, the chat can show final answer/error evidence from the bounded Watcher session tail for the latest unanswered question, without retrying writes. Watcher runs within the owned swarm execution; questions sent after stopping remain queued until resume rather than starting a separate paid runner. Already-loaded runtimes must be restarted to pick up extension updates; newer-schema refusal remains enforced.

Watcher's overview reads one bounded recent activity slice per worker and shows current runtime activity separately. Missing tool calls in that slice do not imply inactivity. Deliberate deeper inspection remains available through paginated activity reads.

Messages can be sent through the board only while the swarm is live. The wall remains writable after it ends, while the board is hosted. Pending and accepted-but-unobserved messages survive shutdown and are recovered on resume. Messages already marked undeliverable are not replayed. Queue acceptance does not prove entry into model context.

One enabled main pi process hosts the project's board; other enabled sessions can take over, polling every 5 seconds and normally retaining the port. The server exists only while an enabled main pi process is running in that project. Opening an empty project creates no swarm data or server; an existing database starts hosting automatically only in enabled sessions.

Port selection: `settings.port`, then the process environment's `PI_SWARM_PORT`, otherwise **3010–3030**, trying the previous host's port first. An explicit port has **no fallback**: a bind failure is reported, though agent work can continue without the board.

## Settings

Settings load from the global pi agent directory's `swarm/settings.json`, then optional project `.pi/swarm/settings.json`, with project values taking precedence. The agent directory defaults to `~/.pi/agent` and respects `PI_CODING_AGENT_DIR`. `/swarm:save-settings` writes only to the selected scope; files can also be edited by hand.

Example project settings:

```json
{
  "minAgents": 1,
  "maxAgents": 10,
  "defaultAgents": 5,
  "staggerSeconds": 30,
  "bodyMaxChars": 200,
  "maxRpcFrameBytes": 16777216,
  "idleReminderDelay": 60000,
  "idleReminderDigestSize": 10,
  "env": {
    "NODE_ENV": "development"
  }
}
```

These are the agent-count and stagger defaults; `env` defaults to `{}` and `port` is unset. To pin a port, add e.g. `"port": 3010` (integer 1–65535).

- `minAgents` is an integer ≥1; `maxAgents` must be ≥`minAgents`. If only `minAgents` exceeds 10, the implicit maximum rises to match it.
- `defaultAgents` is clamped into the allowed range. An explicit `agent_amount` outside it is rejected, never silently clamped.
- Without `models`, workers inherit Main's provider, model and thinking level. An optional nonempty `models` array selects authenticated catalog models using `{ "provider": "provider-id", "model": "model-id", "thinkingLevel": "high", "count_proportional": 3 }`. Omitted weights count as one relative part. Positive integer weights are allocated by largest remainder, with configuration order breaking ties, preserving exactly the requested worker count. Tiny swarms may assign zero workers to a profile. Invalid or unavailable profiles fail instead of falling back; recovery retains each worker's assignment. Watcher policy is unchanged.
- `staggerSeconds` is the nonnegative scheduling interval on a fresh swarm, default 30 seconds. The first real worker for each effective model/launch configuration gates its peers until its first `agent_start` protocol event, not merely process creation or prompt acceptance. Peers need not wait for its task to finish. A confirmed shared fatal startup failure stops admission and cleans up the run without separate probes. Resume uses a fixed 5-second scheduling interval.
- Shared recovery is coordinated only for structured OS resource failures, `EAGAIN`, `EMFILE` and `ENFILE`, within an effective launch configuration. One affected worker retries within its existing bounded recovery allowance; matching failed workers wait for its readiness while healthy and unrelated workers continue. Unknown/provider error text keeps individual handling. No stderr guessing, health probes or generic command timeouts are used.
- `maxRpcFrameBytes` is a positive safe integer bounding each worker RPC JSONL record, default 16 MiB. Large tool results can require a higher limit. An oversized record stops that worker with a fatal protocol error rather than truncating JSON or retrying the same failure.
- `bodyMaxChars` is an integer from 100 to 16,000: the limit stated to worker agents, not a cap on User text. Main's resume feedback keeps its own 4,000-character limit.
- `idleReminderDelay` (milliseconds, integer ≥0) is how long an agent may stay idle before it is reminded to continue. `idleReminderDigestSize` (integer ≥1) bounds fresh full posts in a reminder, oldest uncovered first. Read tools and observed delivery share coverage, so unchanged reminders repeat neither covered post bodies nor subscription comment notifications. Queuing alone does not advance coverage. Reminders direct blocked workers to useful alternative work, not filler activity, and continue until terminal quorum unless that worker explicitly snoozes them.
- `budgetMoneyUsd` and `budgetTimeSeconds` are optional finite positive cumulative ceilings. Omit a limit for unlimited. Time counts active run wall time across resumes, excluding stopped time. Money counts persisted worker/Watcher usage, including reported tool costs, other native usage, retries and compaction, not Main or external billing. Reports lost on abrupt failure are not estimated. Missing or unverifiable zero-only model prices reject money-budget admission. Delayed reports and active work can overshoot. Missing or invalid reported usage costs, including compaction, are recorded as accounting gaps rather than free usage. Legacy nonpositive totals without reporting provenance remain unverified; newly explicit reported zero stays valid. Historical prices are never reconstructed. A money-limited run stops with an error on a gap or unexpected worker model, and raising the ceiling cannot repair incomplete accounting. Inspect the evidence; continuing without a money limit requires user agreement.
- After unexpected owner loss, active time is reconciled through the latest recorded heartbeat or same-run worker usage/spans, not the later sweep/discovery timestamp. The unobserved final interval remains uncertain; this does not invent an exact process death time. Clean owned stops retain their actual stop time.
- `gracefulShutdownOnBudget` defaults to `false`, initiating immediate process interruption on exhaustion. `true` stops new deliveries/admissions and waits for the active pi agent turn to settle. The runner clears queued steering without marking it read. The active turn can include further model/tool steps; this is not a per-tool cancellation boundary. Explicit stop or a genuine terminal vote quorum can end the graceful wait early. Progress and unread messages remain resumable; external effects may be uncertain. Inspect artifacts before repeating interrupted actions.
- After the user agrees, Main can raise limits in `.pi/swarm/settings.json` and call `resume_swarm`. Limits are new cumulative ceilings, never accounting resets. The board and tool result show consumption and budget stop reason, not fabricated completion votes.
- Settings are re-read on each launch/resume; the run keeps that snapshot for revives. Port settings apply when hosting starts.
- Invalid settings fail the tool. Unknown keys produce warnings.
- `env` values must be strings. They override inherited environment values. Keys starting with **`PI_SWARM_` are reserved** and ignored with a warning in `env`; the extension sets agent identity itself.

The extension does not store configured env values in its database or expose them in settings diagnostics or the board. This is not secret isolation: children inherit them, can read project files, and their commands/output may reveal secrets in sessions. Protect credentials accordingly.

## Runtime data and git

```text
.pi/swarm/
  settings.json
  swarm.db                 # SQLite; WAL/SHM sidecars while open
  sessions/<swarm-id>/<agent-name>/
    session.jsonl          # same file for launch, revive and resume
    system-prompt.md
```

Session files appear after the first persisted message. The board's static assets live in the extension, not your project.

Suggested `.gitignore` entries (the extension does not write them):

```gitignore
.pi/swarm/*
!.pi/swarm/settings.json
```

If settings contain secrets, omit the exception and ignore `settings.json` too.

## Recovery and limits

- Startup watchdog: **120 seconds** without output before the first model turn, with **2 startup retries**. Inactivity watchdog: **20 minutes** without output after it. Any record the agent process writes counts, including other extensions' notifications and statuses, so an extension that waits long keeps its agent alive by reporting periodically; a silent process still times out. Idle agents and active tool executions are not timed out; a hung tool can still block progress.
- Nonfatal crashes allow **3 revives per agent per run**, delayed 5, 30 and 120 seconds. Fatal startup failures are not revived. Exhausted agents are reported on the wall; the remaining swarm can finish.
- Process-level overrides: `PI_SWARM_STARTUP_TIMEOUT` and `PI_SWARM_IDLE_TIMEOUT` (milliseconds), `PI_SWARM_STARTUP_RETRIES` (count). Set them in pi's environment, not settings `env`.
- Agents check their runner's PID every 5 seconds. A dead runner leads to shutdown; another enabled main session can clean up the stale run and resume it.
- Run locks expire after **20 seconds** without a heartbeat. Local sweeps protect runs this process still owns, but another process cannot distinguish a paused/blocked runner from a dead one. **Do not pause a runner while another main process is sweeping the same project**: it may mark the run interrupted before the old runner notices ownership loss.

This is a **localhost PoC with no authentication**, not a sandbox or multi-user service. Do not expose its port. Agents share filesystem permissions and one working tree, with no worktree isolation or enforced file locks. Peers receive the same short interface description, without assigned roles or a coordination playbook. Duplicate edits and overwrites remain possible. Review diffs and tests yourself.

Model-dependent acknowledgment/completion loops have occurred, especially after group feedback on resume, with the earlier prompt guards. They can prevent completion and keep spending; watch the board and abort if needed. Optional cumulative money/time budgets now stop execution; message-count quotas are not supported. A five-agent run, real TUI Esc and host takeover were observed; provider rate limiting prevented several further recovery checks. See the [PoC evidence and gaps](https://github.com/gee666/pi-free-swarm/blob/main/docs/poc-run.md).

## Development and packaging

From a checkout:

```sh
npm ci
pi -e . --swarm          # try this checkout without installing it
npm run check            # types, formatting, size, backend/UI tests, package contents
npm run build:ui
npm run check:package
```

For another working project, use `pi -e /absolute/path/to/pi-free-swarm --swarm`. Backend TypeScript loads directly through pi; no backend build is needed.

**`ui_dist/` is committed and shipped.** After UI changes, run `npm run build:ui` and include the rebuilt assets with the source changes. Users do not run Vite to use the board.

The `pi.extensions` manifest points to `index.ts`. The npm file allowlist ships the entry point, `src/` (including `store/schema.sql`), prebuilt board/fonts, README and license. Pi supplies the declared peer packages. `npm run check:package` checks `npm pack --dry-run --json` for required files and excludes scratch data, runtime data and implementation plans. It checks package contents, not whether the prebuilt UI is up to date.

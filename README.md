# pi-free-swarm

A pi extension that runs a leaderless group of agents in one shared working tree. Agents coordinate through a work graph and searchable posts. Follow their work on a local web board and review the changes when they finish.

Tested against Pi 1.4.0 with the Node.js CLI on Linux, using Node.js 24.16.0.

## Requirements and installation

- Pi's compiled Bun binary, or the Node.js CLI with **Node.js ≥22.19**. SQLite is built into both runtimes.
- **Pi ≥1.4.0**, with a configured model and credentials. Only the latest npm Pi release is tested.
- **Linux or macOS**: process-tree cleanup currently uses POSIX process groups; Windows is not supported.

The native retirement test exercises continuation suppression with the installed Pi/core SDK. Older Pi releases are not tested.

```sh
pi install npm:oira666_pi-free-swarm
```

The extension is **off by default**, even when the project already has swarm data. Enable it for a pi invocation:

```sh
pi --swarm
# or
PI_SWARM_ENABLED=1 pi
```

Only the exact environment values `1` and `true` enable it; `0`, `false`, unset and other values do not. `--swarm` enables it regardless of the environment value. Disabled main sessions expose no usable swarm tools and do not import the runtime, start the board or open the database. The session commands below remain available without startup opt-in. Internal children with `PI_SWARM_ROLE=agent` automatically get agent communication tools without either opt-in.

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

Main calls `swarm(swarm_name, task_prompt, acceptance_criteria, agent_amount?)` to start. The default is five agents, launched 30 seconds apart. The request is saved as `.pi/swarm/work/<swarmId>/brief.md`; agents read that file rather than receiving the full request in their prompt. Main's criteria seed the Main group. Planning starts with a criterion and tasks to record the intent and draft criteria.

`resume_swarm(swarm_id, message)` resumes with up to 4,000 characters of feedback and the same agent sessions. Agents restart five seconds apart. A run lock prevents competing runners; resuming an active local run attaches to it. The full update is appended to the brief under `## Update for run N`, and a Main-authored task asks agents to derive criteria and tasks from it. All three Main tools report activity, cost and the board URL, and block until the run ends.

`restart_swarm({swarm?})` recovers an unfinished swarm after a rate limit, crash or manual stop. `swarm` is an optional id, defaulting to the newest swarm in this project. It relaunches the same non-retired agents with their existing sessions, without changing the brief, seeding a task or sending feedback. It attaches and waits if the local run is still active. Only stopped or interrupted swarms without an outcome can restart; use `resume_swarm` with an update for new user input or a finished swarm.

Agents are peers. They record intent, create grouped, testable criteria, and link tasks to criteria with a contribution. Tasks have dependencies, not parent tasks. An owner starts work after dependencies are accepted and calls `swarm_review` to have a subagent check the result. Criterion edits and task title, body or criterion-link changes make votes stale. Claims, reviews, acceptance, handoffs and reopening do not.

Each criterion needs current coverage votes from active owners of linked tasks and at least one independent voter. The question is "Do the linked tasks, when done, fully satisfy this criterion?" Vote `covered` for full coverage, `gap` for missing work, or `blocked` for an external limitation the swarm cannot resolve. A `gap` reason must name the missing part. Vote as soon as tasks are linked; task completion is checked by the pipeline. A criterion becomes `satisfied` only when all linked tasks are accepted, all required voters have current `covered` votes, and no current dissent exists. A blocker records the missing resource or decision, attempts and what would unblock it. Waiting for another swarm task is not a blocker. A criterion is blocked when all required voters agree on its current blocker. Missing and stale votes appear in each agent's own queue and idle reminders, not as push notifications. When all linked tasks become accepted, missing voters and one independent voter receive a request, once per voter per criterion and linked-content signature. The user may optionally reject it, which stales those votes and asks the voters to keep working.

The run completes only when all four gates pass:

1. At least one active criterion exists, and every active criterion has a linked task.
2. Every task is accepted or deferred. A task is deferred when it is not accepted and every linked criterion is blocked.
3. Every active criterion is satisfied or blocked.
4. No task is in review.

The outcome is `completed` or `stopped_with_blockers`. Idle, budget exhaustion, interruption and explicit stop are not completion. The swarm finishes on its own. The user can join discussions, edit criteria or tasks, vote and reopen accepted work. Task acceptance comes from the review subagent, not a peer or a User action. Main should still inspect the files, diffs and tests: reviews and votes are model judgments, not proof.

**Esc aborts the run** and stops its agents (SIGTERM, then SIGKILL after five seconds if needed). Finished, stopped and interrupted swarms can be resumed by any enabled main pi session in the same project.

Every peer has the same tools. Start with `swarm_project` for the brief, gates, queue and tool guide.

| Tools | Purpose |
| --- | --- |
| `swarm_intent_update` | Register intent summary and file |
| `swarm_criteria_search`, `swarm_criteria_get`, `swarm_criteria_create`, `swarm_criteria_edit`, `swarm_criteria_archive` | Find and maintain criteria |
| `swarm_criteria_block`, `swarm_criteria_vote`, `swarm_criteria_vote_context` | Record blockers and assess criteria |
| `swarm_tasks_search`, `swarm_tasks_get`, `swarm_tasks_create`, `swarm_tasks_edit` | Find and maintain tasks and dependencies |
| `swarm_tasks_claim`, `swarm_tasks_release`, `swarm_tasks_handoff`, `swarm_tasks_transition` | Own tasks, start work or reopen accepted work |
| `swarm_review` | Review your task with a clean subagent; resume its session after fixing findings |
| `swarm_posts_search`, `swarm_posts_get`, `swarm_posts_create`, `swarm_posts_comment`, `swarm_posts_unsubscribe`, `swarm_posts_link`, `swarm_posts_unlink` | Search and discuss work, with links to tasks and criteria |
| `swarm_skills_search`, `swarm_skills_get` | Find and read project skills |
| `swarm_snooze`, `swarm_retire` | Pause idle reminders or request a replacement |

Agent titles should stay within 60 Unicode code points, with a hard limit of 100. Other agent text fields should stay within 300, with a hard limit of 400, except review context, which allows 4,000. Longer material belongs in a file referenced by path. User titles have a hard limit of 100; long user body text is accepted and saved to an attachment with a preview and path.

Posts are discovered by search. Use `@Name` in a post or comment to notify a participant once, without subscribing them. Names match case-insensitively; unknown names are ignored. Mentioning `@User` adds unread Wall attention. Authors and commenters subscribe to future comments; each subscriber receives at most one short notice per post every five minutes. Mentions are not throttled and replace the subscriber notice for that comment. Unsubscribe with `swarm_posts_unsubscribe`.

User and Watcher can create broadcast posts to notify every active worker once, without subscribing the recipients. Normal User posts notify only mentioned participants. In the board's new-post form, select "Broadcast to all agents"; broadcast posts have a Broadcast pill. Agents cannot broadcast. A worker mentioned in a broadcast receives one broadcast notice with "You are mentioned." appended. System notices arrive as steering; delivery into context does not prove understanding.

Retirement is available from the start. After finishing one large task or a few small ones, a worker can retire with a short handoff so a fresh agent with a clean context takes new work. It must first finish, release or hand off every owned task in `claimed`, `in_progress` or `review`; rejection lists those task IDs. A replacement keeps the model assignment but must verify the handoff and current work before acting. Snoozing reminders for five minutes remains available only after the first idle turn. Resume and restart preserve the work graph and votes, which are re-evaluated for staleness. The number of tasks linked to a criterion does not trigger a broad-criterion warning; agents judge whether the criterion is testable and its coverage is complete.

### Task review

Only the owner of an `in_progress` task can call `swarm_review({task_id, context, resume?})`. Supply what changed, where and how to verify it in `context`, up to 4,000 characters. The tool gives the reviewer the task title and body, the full linked criteria and that context. It blocks while the task is in `review`.

The reviewer runs in a clean Pi process with the caller's model and thinking level, without extensions, swarm tools or `PI_SWARM_*` environment variables. It inspects the code and runs relevant tests, with instructions not to modify files. A final `VERDICT: accept` accepts the task; `VERDICT: changes` or an invalid verdict returns it to `in_progress` with findings. Long findings include a path to their full text. After 30 minutes, the tool kills the reviewer and returns the task to `in_progress` with a timeout error.

Fix the findings, then call with `resume: true` to continue the same task's review session. Different tasks never share review sessions. Review tokens and cost count toward the owner's usage and the swarm's budgets. At run startup, tasks left in `review` without a live reviewer return to `in_progress`. The board shows context, findings and the timeline, but has no Accept or Request changes actions. Reopen remains available for accepted work.

## Board

Open the URL in the tool box, normally `http://127.0.0.1:3010/s/1`. The swarm selector updates from the existing live index feed without a page refresh. Opening the board root selects the most recently started live swarm, with creation time as a fallback. Explicit swarm URLs and manual choices stay selected; with no live swarm, the picker remains available.

Pick a swarm and switch between:

- **Dashboard**: intent, completion gates, counts, agreed blockers and unread messages.
- **Criteria**: grouped requirements, linked tasks, votes and blockers.
- **Tasks**: ownership, dependencies, evidence, reviews and timelines.
- **Agents**: participants, status and links to their Work activity.
- **Wall**: plans, updates and comments.
- **Work**: agent session activity, thinking and tool calls/results.
- **Stats**: input/output/cache-read/cache-write tokens and reported costs, active time and wall time.
- **Skills**: project skill catalogue and validation errors.
- **Watcher**: current Watcher status and guidance for asking questions on the Wall.
- **Config**: effective configuration, budget accounting and revision-bound editing.

Click project file references for bounded text, Markdown, highlighted code or raster-image previews. Large text files remain explicitly pageable; SVG/HTML stay inert text and paths escaping the project are rejected. See [file previews](docs/file-previews.md).

The Stats view separates all four token categories and shows cache tokens in the top summary. Per-category USD values are reported subtotals with coverage counts. Missing historical values remain "not recorded", never retroactively priced. Partial category subtotals need not sum to the total; money budgets continue using the independently reported total cost.

The header's Run configuration view shows recorded worker assignments, effective launch/timing settings, limits and budget policy. Worker rows show their recorded provider/model and thinking level. Older runs without recorded metadata are labelled unknown, not reconstructed from current settings. Each resume records a new secret-free configuration, reports changed sections and retains named worker model assignments. Credential values from `env` are not recorded. Extension URL userinfo, queries and fragments are removed from saved source references; authorized credential rotation does not change worker identity. Recorded provenance does not guarantee deterministic model behavior.

The Config tab can add or remove workers live and edit budget ceilings for this swarm only, including lowering limits or setting a finite limit on an unlimited swarm. Existing workers keep their assignments; additions get validated fixed assignments. Removing a worker archives it and joins its cleanup, while retaining its history and unread communication. At least one active worker must remain. An inactive task owner must be replaced before its criteria can be agreed.

Budget edits are cumulative total ceilings, not extra allowances or accounting resets. They work while stopped too, so Main can explicitly restart an unfinished swarm after an exhausted budget is raised. A ceiling at or below current consumption triggers the existing budget stop policy. Explicit UI ceilings survive resume and take precedence over file defaults; unedited dimensions still use those defaults. Accounting gaps remain a refusal, not a reason to invent missing prices. These controls do not write project/global settings. Models, credentials, task/criteria and broad launch settings remain outside the live editor.

Control history shows pending, applying, applied or rejected edits. An interrupted applying request is not blindly replayed. Stale revisions are rejected; refresh before submitting another edit. After interruption, inspect recorded effects before repeating an uncertain request. Initial run configuration remains immutable alongside explicit effective revisions.

Mention `@Watcher` in a Wall post or comment to ask about the swarm. Watcher wakes on the mention, reads the post and answers by commenting on it. It can publish posts, including broadcasts, but cannot change the work graph or do the work. Watcher runs within the owned swarm execution; mentions after stopping remain queued until resume, rather than starting a separate paid runner. Already-loaded runtimes must be restarted to pick up extension updates; newer-schema refusal remains enforced.

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
  "maxRpcFrameBytes": 16777216,
  "idleReminderDelay": 60000,
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
- `idleReminderDelay` (milliseconds, integer ≥0) sets the idle reminder delay. Reminders point agents to gates and work; they are suppressed while only user decisions remain.
- `budgetMoneyUsd` and `budgetTimeSeconds` are optional finite positive cumulative ceilings. Omit a limit for unlimited. Time counts active run wall time across resumes, excluding stopped time. Money counts persisted worker/Watcher usage, including reported tool costs, other native usage, retries and compaction, not Main or external billing. Reports lost on abrupt failure are not estimated. Missing or unverifiable zero-only model prices reject money-budget admission. Delayed reports and active work can overshoot. Missing or invalid reported usage costs, including compaction, are recorded as accounting gaps rather than free usage. Legacy nonpositive totals without reporting provenance remain unverified; newly explicit reported zero stays valid. Historical prices are never reconstructed. A money-limited run stops with an error on a gap or unexpected worker model, and raising the ceiling cannot repair incomplete accounting. Inspect the evidence; continuing without a money limit requires user agreement.
- After unexpected owner loss, active time is reconciled through the latest recorded heartbeat or same-run worker usage/spans, not the later sweep/discovery timestamp. The unobserved final interval remains uncertain; this does not invent an exact process death time. Clean owned stops retain their actual stop time.
- `gracefulShutdownOnBudget` defaults to `false`, initiating immediate process interruption on exhaustion. `true` stops new deliveries/admissions and waits for the active pi agent turn to settle. The runner clears queued steering without marking it read. The active turn can include further model/tool steps; this is not a per-tool cancellation boundary. Explicit stop or completion can end the graceful wait early. Progress and unread messages remain resumable; external effects may be uncertain. Inspect artifacts before repeating interrupted actions.
- After the user agrees, Main can raise limits in `.pi/swarm/settings.json` and call `restart_swarm`. Limits are new cumulative ceilings, never accounting resets. The board and tool result show consumption and budget stop reason, not fabricated completion votes.
- Settings are re-read on each launch/resume; the run keeps that snapshot for revives. Port settings apply when hosting starts.
- Invalid settings fail the tool. Unknown keys produce warnings.
- `env` values must be strings. They override inherited environment values. Keys starting with **`PI_SWARM_` are reserved** and ignored with a warning in `env`; the extension sets agent identity itself.

The extension does not store configured env values in its database or expose them in settings diagnostics or the board. This is not secret isolation: children inherit them, can read project files, and their commands/output may reveal secrets in sessions. Protect credentials accordingly.

### Search and skills

Search uses local BM25 ranking by default. Omit query text to keep the caller's filtered, most-recent-first order. Pages default to 10 items. `search.maxResults` defaults to 20 and cannot raise the hard cap of 50. Both it and `search.timeoutMs` must be positive safe integers. Embeddings and helper reranking each use `search.timeoutMs`, default 8000 milliseconds. JEV has its own timeout, default 120000 milliseconds, to allow for model loading and queued requests.

Optional remote ranking settings:

```json
{
  "search": {
    "maxResults": 20,
    "timeoutMs": 8000,
    "embedding": {
      "url": "https://embedding.example/v1",
      "model": "your-embedding-model",
      "apiKeyEnv": "SEARCH_EMBEDDING_KEY"
    },
    "jev": {
      "url": "http://your-jev-host:8765",
      "apiKeyEnv": "SEARCH_JEV_KEY",
      "model": "jev-latest",
      "timeoutMs": 120000
    }
  },
  "helperModel": "provider/model/low"
}
```

Endpoints require HTTP or HTTPS URLs without embedded credentials, query strings or fragments. `apiKeyEnv` names a variable in the swarm settings `env` map or the process environment, not a literal secret. Embeddings require a nonempty model name; their `apiKeyEnv` is optional. They call `<url>/embeddings`, cache document vectors by content hash in SQLite, and fuse cosine and BM25 rankings with reciprocal rank fusion.

`search.jev` configures AutoJev, not a Cohere/Jina `/rerank` endpoint. It requires `url` and `apiKeyEnv`; `model` defaults to `jev-latest`, and `timeoutMs` defaults to 120000 and must be a positive safe integer. One authenticated request to `<url>/v1/systemone` scores the top 30 candidates with named `noul` relevance questions sharing the query and documents. Each document is limited to 600 characters. Scores must be probabilities between 0 and 1; equal scores retain the previous order. Oversized requests, rate limits, malformed replies, HTTP errors and timeouts keep the preceding ranking with a `search degraded: jev failed: <reason>` note. Requests are not retried. The old `search.reranker` setting is no longer supported.

Without JEV, tool callers can use `helperModel` through Pi's model registry. Its format is `provider/model/thinking`; model ids may contain slashes. Thinking is `off`, `minimal`, `low`, `medium`, `high`, `xhigh` or `max`. HTTP/UI searches can use JEV but never use the helper. JEV takes precedence over the helper and does not fall back to it after failure. Other remote failures also keep the preceding ranking with an explicit degradation note. Pagination retains the first page's reranked window, so later pages do not rerank it again.

Project-wide skills live in `.pi/swarm/skills/<name>/SKILL.md`. Require YAML frontmatter with `name` matching the folder and a nonempty `description`. The first Markdown heading supplies the title, otherwise the folder name does. Search/get sync the index on every read, including invalid folders with their validation error. All regular files contribute to the revision hash. Symlinks are invalid. Each folder allows up to 256 files or directories, 1 MiB per file, 8 MiB total and 16 nested directory levels. Skills search stays BM25-only over name, title and description. Catalogue changes emit skill events to swarms so the board can refresh.

## Runtime data and git

```text
.pi/swarm/
  settings.json
  work/<swarm-id>/brief.md  # full original request
  skills/<name>/SKILL.md    # project-wide skills
  swarm.db                 # SQLite; WAL/SHM sidecars while open
  sessions/<swarm-id>/<agent-name>/
    session.jsonl          # same file for launch, revive and resume
    system-prompt.md
  sessions/<swarm-id>/reviews/task-<task-id>/
    session.jsonl          # reused only with resume: true for this task's review
    <revision>-findings.md # full review findings
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

Model-dependent coordination loops can keep spending without making progress. Watch the board and abort if needed. Optional cumulative money and time budgets stop execution; message-count quotas are not supported. Scale to hundreds of agents is a target, not a proven result.

## Development and packaging

From a checkout:

```sh
npm ci
pi -e . --swarm          # try this checkout without installing it
npm run check            # types, formatting, size, backend/UI tests, package contents
npm run build:ui
npm run check:package
```

`npm test` and standalone `npm run test:ui` each refresh the four declared Pi SDK packages at `@latest` with `--save-dev --ignore-scripts`, then run backend/UI typechecking before their test suite. `npm run check` runs both entrypoints plus formatting, file-size and package-content checks. Network access is required, and a newer Pi release can update `package.json` and `package-lock.json`. Keep those changes together.

`npm run test:evergreen` also runs live delegation/resume e2e tests using the globally installed `$EVERGREEN_PI_BIN` (or `pi` on PATH) and the required `$EVERGREEN_E2E_MODEL`. These need working credentials/network and spend tokens. See [EVERGREEN.md](EVERGREEN.md) for intent, coverage and compatibility seams.

Validation covers backend behavior, SDK integration and UI component tests. Tool snippet tests check registered text and bounds, not model behavior. Terminal renderer tests use test themes; UI tests do not establish live browser or terminal theme compatibility. These checks are not a live multi-agent/model run.

For another working project, use `pi -e /absolute/path/to/pi-free-swarm --swarm`. Backend TypeScript loads directly through pi; no backend build is needed.

**`ui_dist/` is committed and shipped.** After UI changes, run `npm run build:ui` and include the rebuilt assets with the source changes. Users do not run Vite to use the board.

The `pi.extensions` manifest points to `index.ts`. The npm file allowlist ships the entry point, `src/` (including `store/schema.sql`), prebuilt board/fonts, README and license. Pi supplies the declared peer packages. `npm run check:package` checks `npm pack --dry-run --json` for required files and excludes scratch data, runtime data and implementation plans. It checks package contents, not whether the prebuilt UI is up to date.

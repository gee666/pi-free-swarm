# pi behaviour findings (M0 spike)

Verified against **pi 0.87.1** on **Node 26.8.2** with real `pi --mode rpc` runs
(`anthropic/claude-haiku-4-5`, thinking `low`). JSON samples are real output, trimmed with `…`.
Long strings (system prompt, signatures) are cut. The last section lists the plan changes.

## 1. Extension loading in child processes

**What a child `pi --mode rpc` loads**

| Source | Loaded in the child? |
|---|---|
| User packages (`~/.pi/agent/settings.json` → `packages`) | Yes, always. |
| User extensions (`~/.pi/agent/extensions/*`) | Yes, always. |
| Project `.pi/extensions`, project packages in `.pi/settings.json` | **Only if the project is trusted.** RPC can't show the trust prompt. With the default `defaultProjectTrust: "ask"`, protected project resources are skipped silently unless a saved decision (`~/.pi/agent/trust.json`) or `--approve` applies. Verified: a `.pi/extensions/*.ts` was not loaded without `--approve` and was loaded with it. `ctx.isProjectTrusted()` reports the decision. |
| `-e <path>` | Yes. It is the only way to load an extension the main process got through `-e`. |

**Duplicates.** pi dedupes extension entries by canonical (realpath) path before loading. Each case
below was run and the factory calls were counted:

| Main-process setup + child `-e` | Result |
|---|---|
| Global npm package + `-e <pkg dir>` or `-e <pkg>/src/index.ts` | Loaded once, attributed to the package |
| Symlinked `.pi/extensions/probe` → dir, + `-e dir/index.ts` | Loaded once |
| `-e <dir with package.json pi.extensions>` + `-e <dir>/index.ts` | Loaded once |
| `-e <dir without package.json>` + `-e <dir>/index.ts` | **Loaded twice → tool conflict** |
| Two different files registering the same tool name | **Tool conflict** |

Any extension load failure, a tool or flag conflict included, is fatal in every mode (`main.js`). pi prints the conflict to stderr and exits with **code 1** before it
answers any RPC command:
```
Error: Failed to load extension "/…/probe-copy/index.ts": Tool "spike_block" conflicts with /…/probe-ext/index.ts
Hint: Start without extensions using "pi -ne".
```

**Self path.** In an extension loaded by jiti, `fileURLToPath(import.meta.url)` gives the absolute
path of the loaded `.ts` file, for example `/…/probe-ext/index.ts`.

**`-ne` is not safe for children.** User extensions may provide providers or auth. With `-ne`, the
same Anthropic model failed with a 400 on this machine, because a user-level extension supplies the working
credentials. Children must load user extensions.

**Startup cost.** With all user packages loaded, the first `get_state` response arrives after
1.1–1.7 s. Children also run every user extension's side effects, such as MCP servers and browser bridges,
and forward their `extension_ui_request` records (`notify`, `setStatus`).

## 2. Read detection: `prompt` to an idle agent and `prompt` + `streamingBehavior: "steer"`

**Idle agent.** The prompt is answered at once and the run starts right away:
```json
{"id":"p1","type":"prompt","message":"[swarm message #1] reply with the word ok"}
{"id":"p1","type":"response","command":"prompt","success":true}
{"type":"agent_start"}
{"type":"turn_start"}
{"type":"message_start","message":{"role":"system","content":"","sections":{"preamble":"…","tools":"…"},"toolsAdded":[…]}}
{"type":"message_end","message":{"role":"system",…}}
{"type":"message_start","message":{"role":"user","content":[{"type":"text","text":"[swarm message #1] reply with the word ok"}],"timestamp":1790160771934}}
{"type":"message_end","message":{"role":"user",…}}
{"type":"message_start","message":{"role":"assistant","content":[…],"stopReason":"pending",…}}
{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","contentIndex":0,"delta":"…"},…}
{"type":"message_end","message":{"role":"assistant","content":[{"type":"thinking",…},{"type":"text","text":"ok"}],"stopReason":"stop",…}}
{"type":"turn_end","message":{…},"toolResults":[]}
{"type":"agent_end","messages":[…],"willRetry":false}
{"type":"agent_settled"}
```
- The first run of a process emits a `role: "system"` message with the full prompt and tool set, so
  lines can be tens of KB. `agent_end.messages` repeats the whole run.
- User `content` is **always an array of text blocks**, even when the prompt was a plain string.
- `message_update.assistantMessageEvent.type` is one of `thinking_start|thinking_delta|thinking_end|text_start|text_delta|text_end`,
  plus the tool-call streaming variants.

**Working agent.** The prompts below were sent while `bash sleep 6` was running, with steering mode `all`:
```json
{"type":"tool_execution_start","toolCallId":"toolu_012g…","toolName":"bash","args":{"command":"sleep 6","timeout":30}}
{"id":"s1","type":"prompt","message":"[swarm message #87] thread #12 · from Maria\n\"first steer\"","streamingBehavior":"steer"}
{"id":"s2","type":"prompt","message":"[swarm message #88] …","streamingBehavior":"steer"}
{"id":"x","type":"prompt","message":"no behaviour while streaming"}
{"type":"queue_update","steering":["[swarm message #87] thread #12 · from Maria\n\"first steer\""],"followUp":[]}
{"id":"s1","type":"response","command":"prompt","success":true}
{"type":"queue_update","steering":["[swarm message #87] …","[swarm message #88] …"],"followUp":[]}
{"id":"s2","type":"response","command":"prompt","success":true}
{"id":"x","type":"response","command":"prompt","success":false,"error":"Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message."}
{"type":"tool_execution_end","toolCallId":"toolu_012g…","toolName":"bash","result":{"content":[{"type":"text","text":"(no output)"}]},"isError":false}
{"type":"message_start","message":{"role":"toolResult",…}}  … {"type":"turn_end",…}
{"type":"turn_start"}
{"type":"queue_update","steering":["[swarm message #88] …"],"followUp":[]}
{"type":"message_start","message":{"role":"user","content":[{"type":"text","text":"[swarm message #87] thread #12 · from Maria\n\"first steer\""}],…}}
{"type":"queue_update","steering":[],"followUp":[]}
{"type":"message_start","message":{"role":"user","content":[{"type":"text","text":"[swarm message #88] …"}],…}}
{"type":"message_start","message":{"role":"assistant",…}}   ← one LLM call answers both
```
- `queue_update` comes **before** the `prompt` response. `get_state.pendingMessageCount` counts
  queued messages.
- **`set_steering_mode {"mode":"all"}`** works (`get_state.steeringMode: "all"`). Both queued messages
  are injected at the same turn boundary, as two separate `message_start` user events, before one assistant
  call. With `one-at-a-time` (the default), each queued message costs its own assistant turn. The mode is
  per process, so send it after every spawn.
- A steer sent during a **text-only final turn** is still delivered: pi starts another turn before
  `agent_end`.
- **`streamingBehavior: "steer"` on an idle agent** behaves like a plain prompt: no `queue_update`,
  and `agent_start` follows at once.
- **Settle gap:** a steer sent right after `turn_end` or `agent_end`, but before `agent_settled`, gives the sequence
  below. The old run's `agent_settled` arrives **after** the send and before the response. The message then starts a new run:
  ```json
  {"type":"agent_end","messages":[…],"willRetry":false}
  {"id":"s1","type":"prompt","message":"[swarm message #9] …","streamingBehavior":"steer"}
  {"type":"agent_settled"}
  {"id":"s1","type":"response","command":"prompt","success":true}
  {"type":"agent_start"}
  {"type":"message_start","message":{"role":"user","content":[{"type":"text","text":"[swarm message #9] …"}]}}
  ```
- A message whose text starts with `/` is parsed as a command, template or skill. The `[swarm message #N]`
  header prevents this.

## 3. Long blocking extension tools

**Registration API (0.87).** `pi.registerTool(def: ToolDefinition<TParams, TDetails>)`:
- `name`, `label`, `description`, `parameters` (a TypeBox schema from `typebox`).
- Optional: `promptSnippet`. Without it, custom tools are left out of the "Available tools" section of the
  system prompt. Also optional: `promptGuidelines`, `executionMode: "sequential"|"parallel"`, `prepareArguments`, `renderShell`.
- `execute(toolCallId, params, signal: AbortSignal|undefined, onUpdate: ((partial: AgentToolResult<TDetails>) => void)|undefined, ctx: ExtensionContext): Promise<AgentToolResult<TDetails>>`,
  where `AgentToolResult = { content: (TextContent|ImageContent)[]; details: TDetails; usage?; terminate? }`.
  Throwing produces an error result (`isError: true`, content = the error message). Returning never does.
- `renderCall(args, theme, context)` and `renderResult(result, {expanded, isPartial}, theme, context)` return
  a pi-tui `Component`, for example `new Text(str, 0, 0)`. `context` has `toolCallId`, `invalidate()`, `state`,
  `isPartial`, `isError`, `executionStarted` and `lastComponent`.

A minimal blocking tool, verified:
```ts
pi.registerTool({
  name: "spike_block", label: "Spike block", description: "Blocks N seconds.",
  parameters: Type.Object({ seconds: Type.Number() }),
  async execute(_id, params, signal, onUpdate) {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        const elapsed = Math.round((Date.now() - started) / 1000);
        onUpdate?.({ content: [{ type: "text", text: `blocked ${elapsed}s` }], details: { elapsed } });
        if (elapsed >= params.seconds) { clearInterval(timer); resolve({ content: [{ type: "text", text: "done" }], details: { elapsed } }); }
      }, 1000);
      signal?.addEventListener("abort", () => { clearInterval(timer); reject(new Error("aborted by user")); });
    });
  },
  renderResult(result, { isPartial }, theme) {
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    return new Text(theme.fg(isPartial ? "muted" : "success", text), 0, 0);
  },
});
```
**RPC run.** Each `onUpdate` call becomes a `tool_execution_update`. `abort` fires the tool's `signal` at once
(`AbortError: This operation was aborted`):
```json
{"type":"tool_execution_update","toolCallId":"toolu_01XH…","toolName":"spike_block","args":{"seconds":60},"partialResult":{"content":[{"type":"text","text":"blocked 3s"}],"details":{"elapsed":3}}}
{"type":"abort"}
{"type":"tool_execution_end","toolCallId":"toolu_01XH…","toolName":"spike_block","result":{"content":[{"type":"text","text":"aborted by user"}],"details":{}},"isError":true}
{"type":"message_start","message":{"role":"toolResult","toolName":"spike_block","isError":true,…}}
{"type":"turn_start"}
{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"aborted","errorMessage":"Operation aborted before provider attempt."}}
{"type":"agent_end","messages":[…],"willRetry":false}
{"type":"agent_settled"}
{"type":"response","command":"abort","success":true}
```
- `ctx.signal` is also set inside `execute`, and it is the same run signal.
- pi and agent-core set no tool execution timeout, so tools may block indefinitely.
- **Esc in the TUI** (`app.interrupt`, default `escape`): while streaming, it calls `restoreQueuedMessagesToEditor({abort: true})`.
  That moves queued steer and follow-up texts back into the editor, then calls `session.abort()`, which aborts the run's
  `AbortSignal`, the same path as RPC `abort`. So Esc during the `swarm` tool reaches its `signal`.
- In the main process, user messages typed during the long `swarm` tool are queued as steering. They are delivered only after the tool returns.

## 4. Lifecycle, mode and environment

| | RPC child | Interactive (TUI) |
|---|---|---|
| `ctx.mode` | `"rpc"` | `"tui"` |
| `ctx.hasUI` | `true` | `true` |
| `ctx.ui.notify()` | works: emits `{"type":"extension_ui_request","method":"notify","message":"…","notifyType":"info"}` | shown in the TUI |
| `session_start` | `{type:"session_start",reason:"startup"}` | same |
| stdin closed / Ctrl+D | `session_shutdown {reason:"quit"}` → `process.on("exit")` (code 0) | same |
| SIGTERM / SIGHUP | `session_shutdown {reason:"quit"}` → `exit` (code 143 / 129) | `session_shutdown` → `exit` |
| SIGINT | **no handler: the process dies, no `session_shutdown`, no `exit` event** | not tested (Ctrl+C is a key in raw mode) |
| SIGKILL | nothing runs | nothing runs |

- `ctx.cwd` is the process cwd. `ctx.sessionManager.getSessionFile()` and `getSessionDir()` are known
  at `session_start`, before the file exists (`undefined`/`""` with `--no-session`).
- `ctx.model` (`{provider, id, …}`) and `ctx.thinkingLevel` hold the **live** model and level. Read them at
  tool execution time; they follow `/model` changes.
- `PI_MODEL`, `PI_PROVIDER`, `PI_REASONING_LEVEL`, `PI_SESSION_ID` and `PI_SESSION_FILE` are set **only in
  the environment of bash-tool subprocesses**, not in the pi process. Don't read them in an extension.
  pi sets `PI_CODING_AGENT=true` in its own process. It has no "child" marker, and `ctx.mode === "rpc"`
  is also true for IDE clients, so role detection must use our own env variable.
- `process.argv` of pi is `[<node>, <path of the pi bin>, …flags]`, for example
  `["/…/bin/node","/…/bin/pi","--mode","rpc",…]`. `process.execPath` is node. Respawn with
  `spawn(process.execPath, [process.argv[1], …args])`.
- pi's startup replaces `process.emitWarning` with a no-op, so Node warnings are never printed from a pi
  process.
- Dialogs (`select`/`confirm`/`input`/`editor`) from any child extension block until the client answers
  with `{"type":"extension_ui_response","id":…,"cancelled":true}`.

## 5. Session JSONL format

**File naming.** `--session-dir D` creates `D/<ISO time with ':' and '.' replaced by '-'>_<uuid v7>.jsonl`,
for example `2026-09-23T10-54-21-744Z_01a0cde6-fa30-779a-b9c1-608c942d3646.jsonl`. The path is chosen at startup. The
**file is first written when the first message is persisted**, so a process that never got a prompt leaves no file.
`--session <path>` accepts an arbitrary path, existing or not. It creates the file there and appends to it
across restarts; verified with two processes sharing `…/Maria.jsonl`.

**`--continue` with `--session-dir D`** picks the file with the **newest mtime** whose header `cwd` equals the child's cwd.
From another cwd it starts a new file. CLI `--model` and `--thinking` override the values stored in the session.

**`--append-system-prompt <file>`** accepts a path and adds the file's contents as the `addendum` prompt section
(verified). A path that doesn't exist is **silently used as literal prompt text** (`resolvePromptInput` in
`core/resource-loader.js`), so pass an absolute path and write the file before spawning.

Real entries (one tool succeeded and one failed in parallel; `custom` entries come from other extensions):
```json
{"type":"session","version":3,"id":"01a0cde6-fa30-…","timestamp":"2026-09-23T10:54:21.744Z","cwd":"/…/tmp/spike"}
{"type":"model_change","id":"09cdc6a2","parentId":null,"timestamp":"…","provider":"anthropic","modelId":"claude-haiku-4-5"}
{"type":"thinking_level_change","id":"61419fa7","parentId":"09cdc6a2","timestamp":"…","thinkingLevel":"low"}
{"type":"custom","customType":"<other-extension>","data":{…},"id":"1773cadf","parentId":"61419fa7","timestamp":"…"}
{"type":"message","id":"97a9c76c","parentId":"1773cadf","timestamp":"…","message":{"role":"system","content":"","sections":{"preamble":"…","tools":"…","addendum":"…","cwd":"…"},"toolsAdded":[{"name":"read",…},…],"timestamp":1790160863160}}
{"type":"message","id":"df29e65d","parentId":"97a9c76c","timestamp":"2026-09-23T10:54:23.163Z","message":{"role":"user","content":[{"type":"text","text":"Think briefly, then: …"}],"timestamp":1790160863159}}
{"type":"message","id":"d7c1f8f3","parentId":"6805fc3e","timestamp":"2026-09-23T10:54:27.480Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"The user wants me to: …","thinkingSignature":"EsUD…"},{"type":"text","text":"I'll run the echo command …"},{"type":"toolCall","id":"toolu_016r…","name":"bash","arguments":{"command":"echo hi","timeout":null}},{"type":"toolCall","id":"toolu_01G3…","name":"spike_fail","arguments":{}}],"api":"anthropic-messages","provider":"anthropic","model":"claude-haiku-4-5","usage":{…},"stopReason":"toolUse","timestamp":1790160863175,"responseId":"msg_…","responseModel":"claude-haiku-4-5-20251001","rawStopReason":"tool_use"}}
{"type":"message","id":"9615522b","parentId":"72588f9c","timestamp":"2026-09-23T10:54:27.497Z","message":{"role":"toolResult","toolCallId":"toolu_016r…","toolName":"bash","content":[{"type":"text","text":"hi\n"}],"isError":false,"timestamp":1790160867497}}
{"type":"message","id":"a7951659","parentId":"9615522b","timestamp":"2026-09-23T10:54:27.499Z","message":{"role":"toolResult","toolCallId":"toolu_01G3…","toolName":"spike_fail","content":[{"type":"text","text":"intentional failure"}],"details":{},"isError":true,"timestamp":1790160867499}}
{"type":"session_info","id":"8582beee","parentId":"61653cc3","timestamp":"…","name":"spike session"}
{"type":"model_change","id":"914db5a9","parentId":"8582beee","timestamp":"…","provider":"anthropic","modelId":"claude-haiku-4-5-20251001"}
```
- Thinking blocks may be `redacted: true` with empty text. Treat `thinkingSignature` as opaque.
- The assistant `message.timestamp` is the **request start**; the entry `timestamp` is when it was
  persisted. A `toolResult` `message.timestamp` is the tool end. For a tool duration, use
  `toolResult.message.timestamp − Date.parse(assistant entry timestamp)`; it is approximate for parallel tools.
  `tool_execution_start`/`end` events are exact.
- **Provider errors and retries.** Checked against a local fake provider that returned 529, 529, then 400:
  ```json
  {"type":"message","id":"eba76fef",…,"message":{"role":"assistant","content":[],"provider":"fakeprov","model":"fake-model","usage":{"input":0,…,"cost":{"total":0}},"stopReason":"error","errorMessage":"529 {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",…}}"}}
  {"type":"context_edit","id":"70e0354d","parentId":"eba76fef","timestamp":"…","targetId":"eba76fef","replacement":null}
  {"type":"message","id":"4bf0c193",…,"message":{"role":"assistant","content":[],"stopReason":"error","errorMessage":"529 …"}}
  {"type":"context_edit",…,"targetId":"4bf0c193","replacement":null}
  {"type":"message","id":"19cb03d3",…,"message":{"role":"assistant","content":[],"stopReason":"error","errorMessage":"400 … fake bad request"}}
  ```
  A retried attempt is an error assistant message followed by a `context_edit` that removes it from context.
  There is no dedicated retry entry. The RPC events for the same sequence:
  ```json
  {"type":"agent_end","messages":[…],"willRetry":true}
  {"type":"auto_retry_start","attempt":1,"maxAttempts":3,"delayMs":2000,"errorMessage":"529 …"}
  {"type":"agent_start"} … {"type":"auto_retry_start","attempt":2,"maxAttempts":3,"delayMs":4000,…}
  {"type":"agent_end","messages":[…],"willRetry":false}
  {"type":"auto_retry_end","success":false,"attempt":2,"finalError":"400 … fake bad request"}
  {"type":"agent_settled"}
  ```
- **Compaction.** Tested with RPC `compact` in a trusted project with `compaction.keepRecentTokens: 50`. A tiny
  session gives `success:false, error:"Nothing to compact (session too small)"`.
  ```json
  {"type":"compaction","id":"777f891a","parentId":"b660bdf2","timestamp":"…","summary":"## Goal\nProvide a short sentence …","firstKeptEntryId":"bb5fac6b","tokensBefore":12469,"details":{"readFiles":[],"modifiedFiles":[]},"usage":{"input":748,"output":636,"cacheRead":0,"cacheWrite":0,"totalTokens":1384,"cost":{…,"total":0.003928}},"fromHook":false,"systemMessage":{"role":"system","sections":{…},"toolsAdded":[…]}}
  ```
  The RPC events are `compaction_start {reason:"manual"|…}` and then `compaction_end {reason, result:{summary, firstKeptEntryId, tokensBefore, estimatedTokensAfter, usage, details}, aborted, willRetry, errorMessage?}`.
- Other entry types (per `session-format.md`, not produced here): `usage` (e.g. `kind:"cache_warm"`),
  `branch_summary`, `custom_message`, `label`. The Work tab must skip unknown `custom` entries.

## 6. Tool names

Tools visible in a child on this machine, from `pi.getAllTools()` with `sourceInfo`:
- **pi built-ins:** `read`, `bash`, `powershell`, `edit`, `write`, `grep`, `find`, `ls`.
- **User packages and extensions:** `bitbucket`, `jenkins`, `mcp`, `mcpScript`, `image_gen`,
  `activate_browser_agent_tools`, 22 `browser_*` tools, and two tools of a delegation package.
  An MCP gateway can also expose arbitrary MCP server tool names.
- pi's example extensions use generic names too: `todo`, `question`, `questionnaire`, `structured_output`, `hello`.

None of `post`, `comment`, `message`, `read_posts`, `read_post`, `reply_to` or `read_thread` collide
today. But a collision is not a warning: it is `exit 1` at startup (§1). Generic names like `message`
and `post` are likely to be taken by messaging or social extensions later.

## 7. `node:sqlite`

`tmp/spike/sqlite-concurrency.mjs` opens one DB file from two writer processes and one reader process,
with `journal_mode=WAL`, `busy_timeout=5000` and `synchronous=NORMAL`. Each writer runs 500 × (`BEGIN IMMEDIATE`, two inserts,
optional 3 ms hold, `COMMIT`):
```json
{"id":"A","busy":0,"ms":1507}
{"reader":true,"reads":1020337,"lastSeenEventId":499}
{"id":"B","busy":0,"ms":3035}
{"node":"v26.8.2","journal":{"journal_mode":"wal"},"rows":[{"writer":"A","c":500},{"writer":"B","c":500}],"events":1000}
```
- There were no `SQLITE_BUSY` errors: writers serialise through the busy handler, and the reader is never blocked.
- Node 26.8.2 prints **no ExperimentalWarning** for `node:sqlite` (bundled SQLite 3.53.4). Inside pi,
  warnings are muted anyway (§4). `DatabaseSync` also works from an extension loaded by jiti.

## 8. Usage on `message_end`

```json
"usage":{"input":10,"output":49,"cacheRead":0,"cacheWrite":12331,"totalTokens":12390,
         "cost":{"input":0.00001,"output":0.000245,"cacheRead":0,"cacheWrite":0.01541375,"total":0.01566875},
         "cacheWrite1h":0,"reasoning":43}
```
- Assistant `message_start` already has a partial `usage`. Only count `message_end`.
- Error messages carry zero usage.
- Compaction usage appears only in `compaction_end.result.usage` and the `compaction` entry, not in any `message_end`.
- `get_session_stats` returns the session totals, compaction included: `tokens{input,output,cacheRead,cacheWrite,total}` and `cost`.

## Decisions / plan adjustments

1. **Always pass `-e <abs path of our index.ts>`** (`fileURLToPath(import.meta.url)` in `index.ts`).
   Canonical-path dedupe makes it safe with a global install, a project install or a symlinked `.pi/extensions` dir.
   It is also required when the main process loaded us with `-e` or from an untrusted project. No "is it installed?"
   detection is needed. **Never pass `-ne`.** Also forward the main process's own `-e/--extension` arguments,
   resolved to absolute paths, so that models provided by extensions resolve in the children.
2. **Project trust:** pass `--approve` when `ctx.isProjectTrusted()` is true in the main process, else `--no-approve`.
   Without it, RPC children silently drop project extensions and settings.
3. **Model:** at `swarm`/`resume_swarm` execution, pass `--model <ctx.model.provider>/<ctx.model.id>` and
   `--thinking <ctx.thinkingLevel>`. Don't use `PI_MODEL`-style env variables and don't parse `argv` for them.
4. **Spawn:** `spawn(process.execPath, [process.argv[1], "--mode", "rpc", …], {detached: true})`, with a
   `PI_SWARM_PI_COMMAND` (+ args prefix) override for the fake-pi tests. Stop children with SIGTERM, not SIGINT:
   an RPC child has no SIGINT handler and dies without `session_shutdown`. Detached children don't get the
   terminal's Ctrl+C, so the runner must kill them itself.
5. **Session files (§7.1, §10):** replace `--session-dir … [--continue]` with one deterministic file per agent,
   `--session .pi/swarm/sessions/<id>/<Name>.jsonl`, for launch, revive and resume alike. It is verified to append across
   restarts. The Work tab reads exactly that file. `--continue` would depend on mtime and cwd matching.
   The file appears only after the first message, so the Work tab must handle a missing file.
6. **`--append-system-prompt <prompt.md path>`** works as planned (it becomes the `addendum` section).
7. **Delivery (§7.2):** always send `prompt` with `streamingBehavior: "steer"`. It is queued if the agent is working
   and starts a run if the agent is idle, so the runner never has to decide idle vs working at send time.
   Keep `set_steering_mode all` (verified) and resend it after every spawn.
8. **Status (§7.3):** `delivered` = `response.success`, which may arrive after `queue_update`. `read` = a user
   `message_start` whose text blocks contain `[swarm message #N]`. Scan for all markers, since a batch prompt holds several.
9. **Idle detection (§7.2, §7.6):** count `prompt` commands in flight, from sent to response. Ignore `agent_settled`
   while that count is > 0; the settle gap in §2 shows a stale `agent_settled` arriving after a send. Any `agent_start`
   → `working`. Also ignore `agent_end` with `willRetry: true` (retry chain in §5).
10. **Tool names (§6.2): prefix all agent tools with `swarm_`:** `swarm_read_posts`, `swarm_read_post`,
    `swarm_post`, `swarm_comment`, `swarm_message`, `swarm_reply_to`, `swarm_read_thread`. A future collision
    with a generic name would make every agent exit 1 at startup. Update the delivery footer to
    `(reply with swarm_reply_to(12, …))`. Give each agent tool a `promptSnippet`, otherwise pi omits it from the
    system prompt's tool list.
11. **Supervisor robustness:** auto-answer child dialog requests (`select/confirm/input/editor`) with
    `{"type":"extension_ui_response","id":…,"cancelled":true}` and ignore fire-and-forget UI records. If a child
    exits during startup with `Failed to load extension` on stderr, treat it as fatal: no revive, and surface stderr.
    Use a JSONL reader that splits on `\n` only, since lines can be tens of KB. User extensions may silently wait out
    rate limits for minutes; the 20-minute inactivity watchdog already covers that.
12. **Stats (§7.8):** also record `compaction_end.result.usage` as a usage row. `message_end` alone misses compaction cost.
13. **Cleanup (§7.1):** `session_shutdown` fires for quit, SIGTERM and SIGHUP in both modes. Kill the process groups there,
    with a synchronous `process.on("exit")` kill as a backstop. Nothing runs on SIGKILL, so the parent watchdog (§7.7) stays necessary.
14. **SQLite (§3):** WAL + `busy_timeout=5000` + `BEGIN IMMEDIATE` is confirmed for concurrent processes. No warning suppression is needed.

// Timings, paths, names and fixed texts shared across layers. Values only: no Node imports and no
// environment reads (callers read the *_ENV variables themselves).

// ── Paths (relative to the project folder) ───────────────────────────────────
export const SWARM_DIR = ".pi/swarm";
export const DB_FILE = "swarm.db";
export const SETTINGS_FILE = "settings.json";
export const SESSIONS_DIR = "sessions";
/** Per agent, both in `<SWARM_DIR>/<SESSIONS_DIR>/<swarmId>/<Name>/`. One session file for all runs and revives. */
export const SESSION_FILE = "session.jsonl";
export const SYSTEM_PROMPT_FILE = "system-prompt.md";

// ── Environment variables ────────────────────────────────────────────────────
export const ROLE_ENV = "PI_SWARM_ROLE";
export const AGENT_ROLE = "agent";
export const DB_ENV = "PI_SWARM_DB";
export const SWARM_ID_ENV = "PI_SWARM_ID";
export const AGENT_NAME_ENV = "PI_SWARM_AGENT";
export const RUNNER_PID_ENV = "PI_SWARM_RUNNER_PID";
export const RESERVED_ENV_PREFIX = "PI_SWARM_";
export const PORT_ENV = "PI_SWARM_PORT";
/** Replaces the pi executable for agents; tests point it at test/fixtures/fake-pi. */
export const PI_COMMAND_ENV = "PI_SWARM_PI_COMMAND";
/** JSON string array put before the pi arguments, e.g. `["test/fixtures/fake-pi.mjs"]`. */
export const PI_ARGS_PREFIX_ENV = "PI_SWARM_PI_ARGS_PREFIX";
export const STARTUP_TIMEOUT_ENV = "PI_SWARM_STARTUP_TIMEOUT";
export const IDLE_TIMEOUT_ENV = "PI_SWARM_IDLE_TIMEOUT";
export const STARTUP_RETRIES_ENV = "PI_SWARM_STARTUP_RETRIES";

// ── SQLite ───────────────────────────────────────────────────────────────────
export const BUSY_TIMEOUT_MS = 5_000;
export const EVENTS_RETENTION_MS = 24 * 60 * 60_000;
export const EVENTS_PRUNE_INTERVAL_MS = 10 * 60_000;

// ── Coordination ─────────────────────────────────────────────────────────────
export const DELIVERY_POLL_MS = 300;
export const EVENTS_TAIL_MS = 250;
export const RUN_LOCK_HEARTBEAT_MS = 5_000;
export const RUN_LOCK_STALE_MS = 20_000;
export const SERVER_HOST_HEARTBEAT_MS = 5_000;
export const SERVER_HOST_POLL_MS = 5_000;
export const SERVER_HOST_STALE_MS = 15_000;
export const STALE_SWEEP_INTERVAL_MS = 10_000;
export const PARENT_WATCH_INTERVAL_MS = 5_000;
export const COMPLETION_CHECK_MS = 1_000;
export const COMPLETION_GRACE_MS = 15_000;
export const PROGRESS_UPDATE_MS = 1_000;
export const RESUME_STAGGER_MS = 5_000;
/** Delay before revive 1, 2 and 3 of an agent within one run; its length is the revive budget. */
export const REVIVE_BACKOFF_MS: readonly number[] = [5_000, 30_000, 120_000];

// ── Agent process watchdog (same defaults as the proven stall watchdog it copies) ──
export const SIGKILL_TIMEOUT_MS = 5_000;
export const RETRY_WAIT_GRACE_MS = 60_000;
export const DEFAULT_STARTUP_TIMEOUT_MS = 120_000;
export const DEFAULT_IDLE_TIMEOUT_MS = 20 * 60_000;
export const DEFAULT_STARTUP_RETRIES = 2;
export const STARTUP_RETRY_BASE_BACKOFF_MS = 1_000;
export const MAX_CAPTURED_STDERR_CHARS = 64_000;
/** pi's stderr text when an extension (e.g. a tool name conflict) fails to load: fatal, never revived. */
export const EXTENSION_LOAD_FAILURE_MARKER = "Failed to load extension";

// ── Settings defaults ────────────────────────────────────────────────────────
export const DEFAULT_MIN_AGENTS = 1;
export const DEFAULT_MAX_AGENTS = 10;
export const DEFAULT_AGENTS = 5;
export const DEFAULT_STAGGER_SECONDS = 20;

// ── Board server ─────────────────────────────────────────────────────────────
export const SERVER_BIND_HOST = "127.0.0.1";
export const DEFAULT_PORT = 3010;
/** Last port tried when the port was not configured explicitly. */
export const PORT_FALLBACK_LAST = 3030;
export const SSE_KEEPALIVE_MS = 15_000;

// ── Paging and output caps ───────────────────────────────────────────────────
export const PAGE_DEFAULT_COUNT = 20;
export const PAGE_MAX_COUNT = 100;
export const SESSION_PAGE_DEFAULT = 50;
export const SESSION_PAGE_MAX = 200;
/** Tool results in the Work tab are cut here; the UI shows 4 KB and loads the rest on "Show more". */
export const SESSION_TOOL_OUTPUT_MAX_CHARS = 64 * 1024;
export const SESSION_WATCH_POLL_MS = 1_000;
export const WALL_DIGEST_MAX_POSTS = 150;

// ── Participants ─────────────────────────────────────────────────────────────
export const USER_NAME = "User";
export const MAIN_NAME = "Main";
export const SYSTEM_NAME = "System";
export const RESERVED_NAMES: readonly string[] = [USER_NAME, MAIN_NAME, SYSTEM_NAME];

// ── Tool names ───────────────────────────────────────────────────────────────
export const MAIN_TOOL = { swarm: "swarm", resumeSwarm: "resume_swarm" } as const;
/** Prefixed because a tool name conflict makes pi exit at startup, and generic names like `post` are likely taken. */
export const AGENT_TOOL = {
  readPosts: "swarm_read_posts",
  readPost: "swarm_read_post",
  post: "swarm_post",
  comment: "swarm_comment",
  message: "swarm_message",
  replyTo: "swarm_reply_to",
  readThread: "swarm_read_thread",
} as const;

// ── Fixed texts that more than one module writes or recognises ───────────────
export const UNDELIVERABLE_REPLY_TEXT = "The swarm is finished. This message will not be delivered.";
export const NOT_RUNNING_TEXT = "Swarm is not running. Messages can't be sent.";
export const MAIN_FEEDBACK_POST_TITLE = "Feedback from Main";
export const MAIN_FEEDBACK_POST_SUFFIX = "…see your messages";
/** First line of the revive prompt; the session reader shows such prompts as a `revive` system item. */
export const REVIVE_PROMPT_HEADER = "[swarm] You were restarted after a crash or stall.";
export const RESUME_PROMPT_HEADER = "[swarm resumed by Main]";

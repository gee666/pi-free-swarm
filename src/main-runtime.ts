// Main-mode state of one pi session: the lazily opened swarm.db, the board server host and the cleanup
// hooks. Nothing starts in the extension factory; the DB and host come up on session_start (when the
// project already has swarms) or on the first `swarm` call.
import { systemClock } from "./clock.js";
import type { SessionContext, SwarmExtensionApi } from "./extension-api.js";
import { killAllAgentsSync } from "./agents/process-registry.js";
import { stopAllRuns } from "./broker/swarm-run.js";
import { sweepStaleRuns } from "./broker/swarms.js";
import { hasSwarmDb, openSwarmDb, swarmDbPath, type SwarmDb } from "./store/db.js";
import { registerMainTools } from "./tools/main-tools.js";

/** The part of `ServerHost` (server/host.ts) the main session drives. */
export interface BoardHost {
  start(): void;
  ensure(): Promise<string | null>;
  boardUrl(): string | null;
  stop(): Promise<void>;
  releaseSync(): void;
}

export interface BoardHostOptions {
  cwd: string;
  getDb(): SwarmDb | null;
  onError(message: string): void;
}

export type NotifyType = "info" | "warning" | "error";

export interface MainRuntime {
  readonly cwd: string;
  /** Absolute path of our index.ts; every agent loads it with `-e`. */
  readonly extensionPath: string;
  readonly host: BoardHost;
  /** `create: false` returns null while the project has no swarm.db yet. */
  getDb(create: boolean): SwarmDb | null;
  /** Shown in the session's UI when it has one (TUI, RPC client); dropped in print/JSON mode. */
  notify(message: string, type: NotifyType): void;
}

export interface MainRuntimeControl extends MainRuntime {
  attachUi(ui: SessionContext["ui"] | null): void;
  closeDb(): void;
}

export function createMainRuntime(options: {
  cwd: string;
  extensionPath: string;
  createHost(options: BoardHostOptions): BoardHost;
}): MainRuntimeControl {
  let db: SwarmDb | null = null;
  let ui: SessionContext["ui"] | null = null;
  const runtime: MainRuntimeControl = {
    cwd: options.cwd,
    extensionPath: options.extensionPath,
    host: options.createHost({
      cwd: options.cwd,
      getDb: () => db,
      onError: (message) => runtime.notify(message, "error"),
    }),
    getDb(create) {
      if (db === null && (create || hasSwarmDb(options.cwd))) db = openSwarmDb(swarmDbPath(options.cwd), { create });
      return db;
    },
    notify(message, type) {
      ui?.notify(message, type);
    },
    attachUi(next) {
      ui = next;
    },
    closeDb() {
      db?.close();
      db = null;
    },
  };
  return runtime;
}

// `exit` handlers must be synchronous; one listener per process, pointing at the latest runtime.
let exitCleanup: (() => void) | null = null;
let exitListenerAdded = false;

function onProcessExit(cleanup: () => void): void {
  exitCleanup = cleanup;
  if (exitListenerAdded) return;
  exitListenerAdded = true;
  process.on("exit", () => exitCleanup?.());
}

export function registerMainMode(pi: SwarmExtensionApi, runtime: MainRuntimeControl): void {
  registerMainTools(pi, runtime);
  pi.on("session_start", (_event, ctx) => {
    runtime.attachUi(ctx.hasUI ? ctx.ui : null);
    const db = runtime.getDb(false);
    if (db === null) return;
    sweepStaleRuns(db, systemClock.now());
    runtime.host.start();
  });
  pi.on("session_shutdown", async () => {
    await stopAllRuns();
    await runtime.host.stop();
    runtime.closeDb();
    runtime.attachUi(null);
  });
  // Last resort when pi exits without session_shutdown finishing: SIGKILL agent groups, free the host row.
  onProcessExit(() => {
    killAllAgentsSync();
    runtime.host.releaseSync();
  });
}

import type { SwarmListItem } from "../api-types.js";
import type { WatchdogConfig } from "../agents/watchdog.js";
import type { Clock } from "../clock.js";
import type { AgentLaunchContext } from "../runtime-types.js";
import type { SwarmSettings } from "../settings.js";
import type { SwarmDb } from "../store/db.js";
import type { RunProgress } from "./run-progress.js";
import type { RunEndStatus } from "./swarms.js";

export interface RunTimings {
  heartbeatMs: number;
  deliveryPollMs: number;
  completionCheckMs: number;
  completionGraceMs: number;
  progressMs: number;
  resumeStaggerMs: number;
  reviveBackoffMs: readonly number[];
  watchdog?: WatchdogConfig;
}

export interface RunEnvironment {
  cwd: string;
  db: SwarmDb;
  runnerPid: number;
  clock: Clock;
  settings: SwarmSettings;
  launch: AgentLaunchContext;
  boardUrl(): string | null;
  notifyUser(text: string): void;
  timings?: Partial<RunTimings>;
}

export interface RunOptions {
  signal?: AbortSignal;
  onProgress?(progress: RunProgress): void;
}

export interface RunOutcome {
  swarm: SwarmListItem;
  run: number;
  end: RunEndStatus;
}

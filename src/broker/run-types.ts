import type { SwarmListItem } from "../api-types.js";
import type { WatchdogConfig } from "../agents/watchdog.js";
import type { Clock } from "../clock.js";
import {
  COMPLETION_CHECK_MS,
  COMPLETION_GRACE_MS,
  DELIVERY_POLL_MS,
  PROGRESS_UPDATE_MS,
  RESUME_STAGGER_MS,
  REVIVE_BACKOFF_MS,
  RUN_LOCK_HEARTBEAT_MS,
} from "../constants.js";
import type { AgentLaunchContext } from "../runtime-types.js";
import type { SwarmSettings } from "../settings.js";
import type { SwarmDb } from "../store/db.js";
import type { AcceptanceRecord } from "../store/acceptance-types.js";
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

export const DEFAULT_TIMINGS: RunTimings = {
  heartbeatMs: RUN_LOCK_HEARTBEAT_MS,
  deliveryPollMs: DELIVERY_POLL_MS,
  completionCheckMs: COMPLETION_CHECK_MS,
  completionGraceMs: COMPLETION_GRACE_MS,
  progressMs: PROGRESS_UPDATE_MS,
  resumeStaggerMs: RESUME_STAGGER_MS,
  reviveBackoffMs: REVIVE_BACKOFF_MS,
};

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
  acceptance: AcceptanceRecord;
}

// Public, secret-free provenance shared by storage and the board.
export interface WorkerAssignment {
  name: string;
  provider: string;
  modelId: string;
  thinkingLevel: string | null;
}

export interface RunConfiguration {
  version: 1;
  workers: WorkerAssignment[];
  launch: {
    projectTrusted: boolean;
    noExtensions: boolean;
    /** Source references only; URL authorization/query/fragment data is removed. */
    extensionArgs: string[];
  };
  timing: {
    staggerSeconds: number;
    idleReminderDelay: number;
    idleReminderDigestSize: number;
    heartbeatMs: number;
    deliveryPollMs: number;
    completionCheckMs: number;
    progressMs: number;
    resumeStaggerMs: number;
    reviveBackoffMs: number[];
    /** Missing only on early configuration records. */
    startupTimeoutMs?: number;
    idleTimeoutMs?: number;
    startupRetries?: number;
  };
  limits: { bodyMaxChars: number; maxRpcFrameBytes: number; maxAgents?: number };
  budget: {
    moneyUsd: number | null;
    timeSeconds: number | null;
    gracefulShutdown: boolean;
  };
}

export interface SavedRunConfiguration {
  run: number;
  recordedAt: number;
  /** Present for explicit live edits; original run records remain immutable. */
  revision?: number;
  effective: RunConfiguration;
  /** Names of changed sections compared with the previous recorded run. */
  changes: string[];
}

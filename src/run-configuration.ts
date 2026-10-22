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
  };
  limits: { bodyMaxChars: number; maxRpcFrameBytes: number };
  budget: {
    moneyUsd: number | null;
    timeSeconds: number | null;
    gracefulShutdown: boolean;
  };
}

export interface SavedRunConfiguration {
  run: number;
  recordedAt: number;
  effective: RunConfiguration;
  /** Names of changed sections compared with the previous recorded run. */
  changes: string[];
}

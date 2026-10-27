import type { BudgetStatus } from "../../../src/budget";
import type { SavedRunConfiguration } from "../../../src/run-configuration";

export const budget: BudgetStatus = {
  moneyUsd: 10,
  timeSeconds: 300,
  costUsd: 10.5,
  activeTimeMs: 301000,
  gracefulShutdown: false,
  exhausted: "money",
  stopReason: "budget-exhausted",
  moneyOvershootUsd: 0.5,
  timeOvershootSeconds: 1,
  accounting: "Worker and Watcher usage only; Main excluded. Delayed accounting may overshoot.",
};

export const configuration: SavedRunConfiguration = {
  run: 2,
  recordedAt: 123,
  changes: ["budget"],
  effective: {
    version: 1,
    workers: [{ name: "Maria", provider: "provider-a", modelId: "model-a", thinkingLevel: "high" }],
    launch: { projectTrusted: true, noExtensions: true, extensionArgs: [] },
    timing: {
      staggerSeconds: 1,
      idleReminderDelay: 500,
      idleReminderDigestSize: 3,
      heartbeatMs: 1000,
      deliveryPollMs: 100,
      completionCheckMs: 100,
      progressMs: 1000,
      resumeStaggerMs: 100,
      reviveBackoffMs: [100, 200],
    },
    limits: { maxRpcFrameBytes: 1048576 },
    budget: { moneyUsd: 10, timeSeconds: 300, gracefulShutdown: false },
  },
};

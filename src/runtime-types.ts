// Backend-only shapes passed between layers owned by different modules (agents ↔ broker ↔ tools).

/** Usage of one assistant message, as read from an RPC `message_end`. Cost is USD. */
export interface UsageSample {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  model: string | null;
}

/** Model and thinking level inherited from the main session and passed to every agent spawn of a run. */
export interface ModelSelection {
  provider: string;
  modelId: string;
  thinkingLevel: string | null;
}

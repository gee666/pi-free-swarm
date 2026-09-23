// Backend-only shapes passed between layers owned by different modules (agents ↔ broker ↔ tools).

/**
 * Usage of one assistant message (RPC `message_end`) or one compaction (`compaction_end.result.usage`),
 * which no `message_end` reports. Cost is USD.
 */
export interface UsageSample {
  kind: "message" | "compaction";
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  model: string | null;
}

/** The main session's live model (`ctx.model`, `ctx.thinkingLevel`), read when `swarm`/`resume_swarm` executes. */
export interface ModelSelection {
  provider: string;
  modelId: string;
  thinkingLevel: string | null;
}

/** What every agent spawn of one run inherits from the main process; captured once per tool call. */
export interface AgentLaunchContext {
  /** Absolute; this extension's index.ts first, then the main process's own `-e` values. Never `-ne`. */
  extensionArgs: readonly string[];
  /** `ctx.isProjectTrusted()`: `--approve` when true, else `--no-approve`. */
  projectTrusted: boolean;
  model: ModelSelection | null;
}

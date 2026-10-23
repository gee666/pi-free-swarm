// Backend-only shapes passed between layers owned by different modules (agents ↔ broker ↔ tools).
import type { ReportedUsageCosts } from "./api-usage-types.js";

/**
 * One completed native usage report. Cost is reported USD.
 */
export interface UsageSample {
  kind: "message" | "compaction" | "tool" | "usage";
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  costBreakdown?: ReportedUsageCosts;
  /** False when no attributable USD total can be verified, including unpriced SDK zero. */
  costKnown?: boolean;
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
  /** This extension's index.ts first, then the main process's explicit `-e` paths or package sources. */
  extensionArgs: readonly string[];
  /** Preserve the parent's opt-out from discovered/configured extensions; explicit `-e` still loads. */
  noExtensions?: boolean;
  /** `ctx.isProjectTrusted()`: `--approve` when true, else `--no-approve`. */
  projectTrusted: boolean;
  model: ModelSelection | null;
}

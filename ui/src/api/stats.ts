import type { StatsResponse } from "../../../src/api-types";
import { getJson } from "./http";

/** Swarm totals and per-agent usage, agents in launch order. */
export function fetchStats(swarmId: number | string, signal: AbortSignal): Promise<StatsResponse> {
  return getJson<StatsResponse>(`/api/swarms/${encodeURIComponent(swarmId)}/stats`, signal);
}

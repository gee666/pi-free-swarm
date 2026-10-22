import { REVIVE_BACKOFF_MS } from "../constants.js";

/** `null` means the agent's revive budget for this run is used up. */
export function reviveDelayMs(
  revivesUsedThisRun: number,
  backoffMs: readonly number[] = REVIVE_BACKOFF_MS,
): number | null {
  return backoffMs[revivesUsedThisRun] ?? null;
}

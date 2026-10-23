import type { SwarmStatus } from "../api-types.js";
import { isPidAlive, isRunLockFresh, type PidAlive } from "./locks.js";
import { intOrNull, swarmStatusOf, type Row } from "./rows.js";

/** Keep scalar progress and full API snapshots consistent about stale owners. */
export function resolvedSwarmState(
  row: Row,
  now: number,
  alive: PidAlive = isPidAlive,
): {
  status: SwarmStatus;
  live: boolean;
  runnerPid: number | null;
} {
  const stored = swarmStatusOf(row);
  const runnerPid = intOrNull(row, "runner_pid");
  const wantsLive = stored === "starting" || stored === "running";
  const live =
    wantsLive && isRunLockFresh({ runnerPid, runnerHeartbeatAt: intOrNull(row, "runner_heartbeat_at") }, now, alive);
  return { status: wantsLive && !live ? "interrupted" : stored, live, runnerPid };
}

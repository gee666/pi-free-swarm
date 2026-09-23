import type { SwarmListItem, SwarmListResponse } from "../../../src/api-types";
import { getJson } from "./http";

export function fetchSwarms(signal: AbortSignal): Promise<SwarmListResponse> {
  return getJson<SwarmListResponse>("/api/swarms", signal);
}

/** Applies a `swarm.updated` payload to a newest-first list, adding swarms that are new. */
export function withSwarm(list: SwarmListResponse | undefined, swarm: SwarmListItem): SwarmListResponse | undefined {
  if (!list) return list;
  const known = list.swarms.some((item) => item.id === swarm.id);
  const swarms = known ? list.swarms.map((item) => (item.id === swarm.id ? swarm : item)) : [swarm, ...list.swarms];
  return { swarms };
}

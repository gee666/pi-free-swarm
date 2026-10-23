import type { SwarmListItem, SwarmListResponse } from "../../../src/api-types";
import { getJson } from "./http";

export function fetchSwarms(signal: AbortSignal): Promise<SwarmListResponse> {
  return getJson<SwarmListResponse>("/api/swarms", signal);
}

/** Prefer the most recently started active run; old records without that time use creation order. */
export function latestRunningSwarm(swarms: readonly SwarmListItem[]): SwarmListItem | undefined {
  return swarms.reduce<SwarmListItem | undefined>((latest, swarm) => {
    if (swarm.status !== "running" && swarm.status !== "starting") return latest;
    if (!latest) return swarm;
    const time = (swarm.startedAt ?? swarm.createdAt) - (latest.startedAt ?? latest.createdAt);
    const order = time || swarm.createdAt - latest.createdAt || swarm.id - latest.id;
    return order > 0 ? swarm : latest;
  }, undefined);
}

/** Applies a `swarm.updated` payload to a newest-first list, adding swarms that are new. */
export function withSwarm(list: SwarmListResponse | undefined, swarm: SwarmListItem): SwarmListResponse | undefined {
  if (!list) return list;
  const known = list.swarms.some((item) => item.id === swarm.id);
  const swarms = known ? list.swarms.map((item) => (item.id === swarm.id ? swarm : item)) : [swarm, ...list.swarms];
  return { swarms };
}

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import type { DashboardResponse, RunHeaderState, ScopeApprovalResponse } from "../../../src/api-types";
import { getJson, postJson } from "./http";
import { useAsync, type AsyncState } from "./useAsync";
import { useSwarmStream } from "./SwarmStream";
import { useStreamListener } from "./useEventStream";

export const RUN_LABELS: Record<RunHeaderState, string> = {
  running: "Running",
  awaiting_user: "Awaiting you",
  completed: "Completed",
  stopped_with_blockers: "Stopped with blockers",
  stopped: "Stopped",
  interrupted: "Interrupted",
};
const DashboardContext = createContext<AsyncState<DashboardResponse> | null>(null);
const REFRESH_DEBOUNCE_MS = 250;

export function DashboardProvider({ swarmId, children }: { swarmId: string; children: ReactNode }) {
  const stream = useSwarmStream();
  const state = useAsync(
    (signal) => getJson<DashboardResponse>(`/api/swarms/${encodeURIComponent(swarmId)}/dashboard`, signal),
    [swarmId, stream.openCount],
    stream.openCount > 0 || stream.status === "reconnecting",
  );
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), [swarmId]);
  useStreamListener(stream, (event) => {
    if (
      ![
        "project.changed",
        "task.changed",
        "criterion.changed",
        "swarm.updated",
        "message.created",
        "message.status",
      ].includes(event.type)
    )
      return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(state.reload, REFRESH_DEBOUNCE_MS);
  });
  return <DashboardContext.Provider value={state}>{children}</DashboardContext.Provider>;
}

export function useDashboard() {
  const state = useContext(DashboardContext);
  if (!state) throw new Error("useDashboard requires DashboardProvider");
  return state;
}

export function approveScope(swarmId: string, expectedRevision: number) {
  return postJson<ScopeApprovalResponse>(`/api/swarms/${encodeURIComponent(swarmId)}/scope/approve`, {
    expectedRevision,
  });
}

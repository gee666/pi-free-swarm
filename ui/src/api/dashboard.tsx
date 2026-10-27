import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import type { DashboardResponse, RunHeaderState } from "../../../src/api-types";
import { getJson } from "./http";
import { useAsync, type AsyncState } from "./useAsync";
import { useSwarmStream } from "./SwarmStream";
import { useStreamListener } from "./useEventStream";
import { REFRESH_DEBOUNCE_MS } from "../lib/useDebounced";

export const RUN_LABELS: Record<RunHeaderState, string> = {
  running: "Running",
  completed: "Completed",
  stopped_with_blockers: "Stopped with blockers",
  stopped: "Stopped",
  interrupted: "Interrupted",
};
const DashboardContext = createContext<AsyncState<DashboardResponse> | null>(null);

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
        "participant.updated",
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

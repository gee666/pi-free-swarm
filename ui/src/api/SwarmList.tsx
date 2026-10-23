import { createContext, useContext, type ReactNode } from "react";
import { fetchSwarms, withSwarm } from "./swarms";
import { useAsync } from "./useAsync";
import { useEventStream, useStreamListener } from "./useEventStream";

function useLiveSwarmList() {
  const stream = useEventStream("/events");
  // Waiting for the handshake avoids both a duplicate initial fetch and a snapshot/event gap.
  const list = useAsync(fetchSwarms, [stream.openCount], stream.openCount > 0);
  useStreamListener(stream, (event) => {
    if (event.type === "swarm.updated") list.update((current) => withSwarm(current, event.payload.swarm));
  });
  return { list, stream };
}
const SwarmListContext = createContext<ReturnType<typeof useLiveSwarmList> | null>(null);

/** One existing global index feed, shared across route changes; scoped activity stays separate. */
export function SwarmListProvider({ children }: { children: ReactNode }) {
  const state = useLiveSwarmList();
  return <SwarmListContext.Provider value={state}>{children}</SwarmListContext.Provider>;
}

export function useSwarmList() {
  const state = useContext(SwarmListContext);
  if (!state) throw new Error("useSwarmList must be used inside SwarmListProvider");
  return state;
}

import { createContext, useContext, type ReactNode } from "react";
import { useEventStream, type EventStream } from "./useEventStream";

const SwarmStreamContext = createContext<EventStream | null>(null);

/** Opens `/events?swarm=:id` once for all pages of a swarm. */
export function SwarmStreamProvider({ swarmId, children }: { swarmId: string; children: ReactNode }) {
  const stream = useEventStream(`/events?swarm=${encodeURIComponent(swarmId)}`);
  return <SwarmStreamContext.Provider value={stream}>{children}</SwarmStreamContext.Provider>;
}

/** The current swarm's event stream; only valid below SwarmStreamProvider (every `/s/:id/*` page). */
export function useSwarmStream(): EventStream {
  const stream = useContext(SwarmStreamContext);
  if (!stream) throw new Error("useSwarmStream must be used inside SwarmStreamProvider");
  return stream;
}

import { createContext, useContext, type ReactNode } from "react";
import type { SwarmDetailResponse } from "../../../src/api-types";
import { applyParticipantEvent, fetchSwarmDetail, orderParticipants } from "./agents";
import { SwarmStreamProvider, useSwarmStream } from "./SwarmStream";
import { useAsync, type AsyncState } from "./useAsync";
import { useStreamListener } from "./useEventStream";
import { ComposerDraftsProvider } from "../components/compose/ComposerDrafts";

interface CurrentDetail {
  swarmId: string;
  detail: AsyncState<SwarmDetailResponse>;
}
const DetailContext = createContext<CurrentDetail | null>(null);

/** One current-route snapshot for both the shell and page; no historical or multi-swarm cache. */
export function SwarmViewProvider({ swarmId, children }: { swarmId: string; children: ReactNode }) {
  return (
    <ComposerDraftsProvider>
      <SwarmStreamProvider key={swarmId} swarmId={swarmId}>
        <CurrentDetailProvider swarmId={swarmId}>{children}</CurrentDetailProvider>
      </SwarmStreamProvider>
    </ComposerDraftsProvider>
  );
}

function CurrentDetailProvider({ swarmId, children }: { swarmId: string; children: ReactNode }) {
  const stream = useSwarmStream();
  // A missing-swarm stream never opens; one fallback snapshot exposes its HTTP error instead of a permanent skeleton.
  const detail = useAsync(
    (signal) =>
      fetchSwarmDetail(swarmId, signal).then((value) => ({
        ...value,
        participants: orderParticipants(value.participants),
      })),
    [swarmId, stream.openCount],
    stream.openCount > 0 || stream.status === "reconnecting",
  );
  useStreamListener(stream, (event) => {
    if (event.type === "swarm.updated" || event.type === "usage.updated") detail.reload();
    detail.update((current) => {
      if (!current) return current;
      if (event.type === "swarm.updated")
        return event.payload.swarm.id === current.swarm.id ? { ...current, swarm: event.payload.swarm } : current;
      const participants = applyParticipantEvent(current.participants, event);
      const unread = "userUnread" in event.payload ? event.payload.userUnread : undefined;
      const unreadChanged =
        unread !== undefined &&
        (unread.messages !== current.userUnread?.messages || unread.comments !== current.userUnread?.comments);
      return participants === current.participants && !unreadChanged
        ? current
        : {
            ...current,
            participants,
            ...(unreadChanged ? { userUnread: unread } : {}),
          };
    });
  });
  return <DetailContext.Provider value={{ swarmId, detail }}>{children}</DetailContext.Provider>;
}

export function useSwarmDetail(swarmId: string): AsyncState<SwarmDetailResponse> {
  const current = useContext(DetailContext);
  if (!current || current.swarmId !== swarmId)
    throw new Error("useSwarmDetail requires the matching SwarmViewProvider");
  return current.detail;
}

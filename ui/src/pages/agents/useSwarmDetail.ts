import type { SwarmDetailResponse } from "../../../../src/api-types";
import { applyParticipantEvent, fetchSwarmDetail } from "../../api/agents";
import { useSwarmStream } from "../../api/SwarmStream";
import { useAsync, type AsyncState } from "../../api/useAsync";
import { useStreamListener } from "../../api/useEventStream";

/** Swarm record and participants, patched from the stream (statuses, unread counts, `swarm.updated`). */
export function useSwarmDetail(swarmId: string): AsyncState<SwarmDetailResponse> {
  const stream = useSwarmStream();
  const detail = useAsync((signal) => fetchSwarmDetail(swarmId, signal), [swarmId, stream.openCount]);
  useStreamListener(stream, (event) => {
    detail.update((current) => {
      if (!current) return current;
      if (event.type === "swarm.updated") {
        return event.payload.swarm.id === current.swarm.id ? { ...current, swarm: event.payload.swarm } : current;
      }
      const participants = applyParticipantEvent(current.participants, event);
      return participants === current.participants ? current : { ...current, participants };
    });
  });
  return detail;
}

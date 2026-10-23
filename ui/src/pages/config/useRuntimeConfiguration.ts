import { fetchConfiguration } from "../../api/configuration";
import { useAsync } from "../../api/useAsync";
import { useSwarmStream } from "../../api/SwarmStream";
import { useStreamListener } from "../../api/useEventStream";

export function useRuntimeConfiguration(swarmId: string) {
  const stream = useSwarmStream();
  const state = useAsync((signal) => fetchConfiguration(swarmId, signal), [swarmId, stream.openCount]);
  useStreamListener(stream, (event) => {
    if (event.type === "swarm.updated") state.reload();
  });
  return state;
}

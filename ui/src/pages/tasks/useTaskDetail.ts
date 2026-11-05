import type { TaskDetailResponse } from "../../../../src/api-types";
import { getJson } from "../../api/http";
import { useLoadMore } from "../../api/useLoadMore";
import { useSwarmStream } from "../../api/SwarmStream";
import { affectsWork, useWorkRefresh, workUrl } from "../work-items/useWorkData";

export function useTaskDetail(swarmId: string, id: number) {
  const stream = useSwarmStream();
  const state = useLoadMore<TaskDetailResponse>(
    {
      fetch: (signal, current) =>
        getJson<TaskDetailResponse>(
          workUrl(swarmId, `tasks/${id}${current?.nextAfter == null ? "" : `?after=${current.nextAfter}`}`),
          signal,
        ),
      hasMore: (data) => data.nextAfter !== null,
      merge: (current, page) => {
        const known = new Set(current.timeline.map((event) => event.id));
        return {
          ...current,
          timeline: [...current.timeline, ...page.timeline.filter((event) => !known.has(event.id))],
          nextAfter: page.nextAfter,
        };
      },
    },
    `${swarmId}/tasks/${id}`,
    [stream.openCount],
  );
  useWorkRefresh(state.reload, affectsWork);
  return state;
}

import type { PostDetailResponse } from "../../../../src/api-types";
import { useSwarmStream } from "../../api/SwarmStream";
import { useAsync, type AsyncState } from "../../api/useAsync";
import { useStreamListener } from "../../api/useEventStream";
import { fetchPost } from "../../api/wall";
import { withComment } from "./wallModel";

/**
 * The open post with its comments, oldest first; new comments arrive from the swarm stream. `data` is
 * undefined while no post is open and while another post is still loading.
 */
export function usePost(swarmId: string, postId: number | undefined): AsyncState<PostDetailResponse | undefined> {
  const stream = useSwarmStream();
  const state = useAsync(
    (signal) => (postId === undefined ? Promise.resolve(undefined) : fetchPost(swarmId, postId, signal)),
    [swarmId, postId, stream.openCount],
  );
  const { update } = state;
  useStreamListener(stream, (event) => {
    if (event.type !== "comment.created") return;
    const { comment, commentCount } = event.payload;
    update((current) => current && withComment(current, comment, commentCount));
  });
  return { ...state, data: state.data?.post.id === postId ? state.data : undefined };
}

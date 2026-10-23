import type { PostDetailResponse } from "../../../../src/api-types";
import { useSwarmStream } from "../../api/SwarmStream";
import { useAsync, type AsyncState } from "../../api/useAsync";
import { useStreamListener } from "../../api/useEventStream";
import { fetchPost } from "../../api/wall";
import { orderPost, withComment, withPostClaim, withPostContract, withUserPostAttention } from "./wallModel";

/**
 * The open post with its comments, newest first; new comments arrive from the swarm stream. `data` is
 * undefined while no post is open and while another post is still loading.
 */
export function usePost(swarmId: string, postId: number | undefined): AsyncState<PostDetailResponse | undefined> {
  const stream = useSwarmStream();
  const state = useAsync(
    (signal) =>
      postId === undefined ? Promise.resolve(undefined) : fetchPost(swarmId, postId, signal).then(orderPost),
    [swarmId, postId, stream.openCount],
  );
  const { update } = state;
  useStreamListener(stream, (event) => {
    if (event.type === "post.contract.updated") {
      update((current) => current && withPostContract(current, event.payload.contract));
      return;
    }
    if (event.type === "post.claimed") {
      update((current) => {
        if (!current) return current;
        const post = withPostClaim(current.post, event.payload.claim);
        return post === current.post ? current : { ...current, post };
      });
      return;
    }
    if (event.type === "user.post.updated") {
      update((current) => {
        if (!current) return current;
        const post = withUserPostAttention(current.post, event.payload);
        return post === current.post ? current : { ...current, post };
      });
      return;
    }
    if (event.type !== "comment.created") return;
    const { comment, commentCount } = event.payload;
    update((current) => current && withComment(current, comment, commentCount));
  });
  return { ...state, data: state.data?.post.id === postId ? state.data : undefined };
}

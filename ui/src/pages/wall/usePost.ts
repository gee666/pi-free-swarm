import type { PostDetailResponse } from "../../../../src/api-types";
import { useSwarmStream } from "../../api/SwarmStream";
import { useAsync, type AsyncState } from "../../api/useAsync";
import { useStreamListener } from "../../api/useEventStream";
import { fetchPost } from "../../api/wall";
import { useWorkRefresh } from "../work-items/useWorkData";
import { orderPost, withComment, withUserPostAttention } from "./wallModel";

export function usePost(swarmId: string, postId: number | undefined): AsyncState<PostDetailResponse | undefined> {
  const stream = useSwarmStream();
  const state = useAsync(
    (signal) =>
      postId === undefined ? Promise.resolve(undefined) : fetchPost(swarmId, postId, signal).then(orderPost),
    [swarmId, postId, stream.openCount],
  );
  useWorkRefresh(state.reload, (event) => event.type === "post.links.changed" && event.payload.id === postId);
  const { update } = state;
  useStreamListener(stream, (event) => {
    if (event.type === "user.post.updated") {
      update((current) => {
        if (!current) return current;
        const post = withUserPostAttention(current.post, event.payload);
        return post === current.post ? current : { ...current, post };
      });
    }
    if (event.type === "comment.created") {
      const { comment, commentCount } = event.payload;
      update((current) => current && withComment(current, comment, commentCount));
    }
  });
  return { ...state, data: state.data?.post.id === postId ? state.data : undefined };
}

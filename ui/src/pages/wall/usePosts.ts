import type { PostListResponse } from "../../../../src/api-types";
import { useSwarmStream } from "../../api/SwarmStream";
import { useAsync, type AsyncState } from "../../api/useAsync";
import { useStreamListener } from "../../api/useEventStream";
import { useLoadMore, type LoadMore } from "../../api/useLoadMore";
import { fetchPosts } from "../../api/wall";
import { newestFirst } from "../../lib/newestFirst";
import {
  withCommentCount,
  withOlderPosts,
  withPost,
  withPostListClaim,
  withPostListContract,
  withUserPostListAttention,
} from "./wallModel";

const PAGE_SIZE = 20;

/** The wall, newest first, kept live from the swarm stream; older posts load on demand. */
export function usePosts(swarmId: string): AsyncState<PostListResponse> & LoadMore {
  const stream = useSwarmStream();
  const state = useAsync(
    (signal) =>
      fetchPosts(swarmId, { count: PAGE_SIZE }, signal).then((list) => ({ ...list, posts: newestFirst(list.posts) })),
    [swarmId, stream.openCount],
  );
  const { update } = state;

  useStreamListener(stream, (event) => {
    if (event.type === "post.created") update((current) => current && withPost(current, event.payload.post));
    if (event.type === "post.contract.updated")
      update((current) => current && withPostListContract(current, event.payload.contract));
    if (event.type === "post.claimed") update((current) => current && withPostListClaim(current, event.payload.claim));
    if (event.type === "user.post.updated")
      update((current) => current && withUserPostListAttention(current, event.payload));
    if (event.type === "comment.created") {
      const { comment, commentCount } = event.payload;
      update((current) => current && withCommentCount(current, comment.postId, commentCount));
    }
  });

  const more = useLoadMore(state, {
    loaded: (data) => data.posts.length,
    total: (data) => data.total,
    fetch: (offset) => fetchPosts(swarmId, { count: PAGE_SIZE, offset }),
    merge: withOlderPosts,
  });
  return { ...state, ...more };
}

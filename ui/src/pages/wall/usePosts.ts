import type { PostListResponse, PostsSearchResponse } from "../../../../src/api-types";
import { getJson } from "../../api/http";
import { useSwarmStream } from "../../api/SwarmStream";
import { useStreamListener } from "../../api/useEventStream";
import { useLoadMore } from "../../api/useLoadMore";
import { fetchPosts } from "../../api/wall";
import { newestFirst } from "../../lib/newestFirst";
import { useWorkRefresh, workUrl } from "../work-items/useWorkData";
import { withCommentCount, withOlderPosts, withPost, withUserPostListAttention } from "./wallModel";

const PAGE_SIZE = 20;
interface WallPageData extends PostListResponse {
  nextCursor?: string | null;
  notes?: string[];
}
export function usePosts(swarmId: string, query = "") {
  const stream = useSwarmStream();
  const state = useLoadMore<WallPageData>(
    {
      fetch: async (signal, current) => {
        if (!query) {
          const list = await fetchPosts(swarmId, { count: PAGE_SIZE, offset: current?.posts.length ?? 0 }, signal);
          return { ...list, posts: newestFirst(list.posts) };
        }
        const params = new URLSearchParams(query);
        if (current?.nextCursor) params.set("cursor", current.nextCursor);
        return getJson<PostsSearchResponse>(workUrl(swarmId, `posts?${params}`), signal);
      },
      hasMore: (data) => (query ? Boolean(data.nextCursor) : data.posts.length < data.total),
      merge: (current, page) => {
        if (!query) return withOlderPosts(current, page);
        const known = new Set(current.posts.map((post) => post.id));
        return { ...page, posts: [...current.posts, ...page.posts.filter((post) => !known.has(post.id))] };
      },
    },
    `${swarmId}/posts?${query}`,
    [stream.openCount],
  );
  useWorkRefresh(
    state.reload,
    (event) =>
      event.type === "post.links.changed" ||
      (Boolean(query) && (event.type === "post.created" || event.type === "comment.created")),
  );
  const { update } = state;
  useStreamListener(stream, (event) => {
    if (event.type === "post.created" && !query) update((current) => current && withPost(current, event.payload.post));
    if (event.type === "user.post.updated")
      update((current) => current && withUserPostListAttention(current, event.payload));
    if (event.type === "comment.created") {
      const { comment, commentCount } = event.payload;
      update((current) => current && withCommentCount(current, comment.postId, commentCount));
    }
  });
  return state;
}

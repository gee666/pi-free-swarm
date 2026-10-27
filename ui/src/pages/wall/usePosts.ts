import type { PostListResponse, PostsSearchResponse } from "../../../../src/api-types";
import { getJson } from "../../api/http";
import { useSwarmStream } from "../../api/SwarmStream";
import { useAsync, type AsyncState } from "../../api/useAsync";
import { useStreamListener } from "../../api/useEventStream";
import { useLoadMore, type LoadMore } from "../../api/useLoadMore";
import { fetchPosts } from "../../api/wall";
import { newestFirst } from "../../lib/newestFirst";
import { useWorkRefresh, workUrl } from "../work-items/useWorkData";
import { withCommentCount, withOlderPosts, withPost, withUserPostListAttention } from "./wallModel";

const PAGE_SIZE = 20;
interface WallPageData extends PostListResponse {
  nextCursor?: string | null;
  notes?: string[];
}
export function usePosts(swarmId: string, query = ""): AsyncState<WallPageData> & LoadMore {
  const stream = useSwarmStream();
  const fetchPage = async (signal?: AbortSignal, offset = 0, cursor?: string | null): Promise<WallPageData> => {
    if (!query) {
      const list = await fetchPosts(swarmId, { count: PAGE_SIZE, offset }, signal);
      return { ...list, posts: newestFirst(list.posts) };
    }
    const params = new URLSearchParams(query);
    if (cursor) params.set("cursor", cursor);
    return getJson<PostsSearchResponse>(workUrl(swarmId, `posts?${params}`), signal);
  };
  const state = useAsync((signal) => fetchPage(signal), [swarmId, query, stream.openCount]);
  useWorkRefresh(
    state.reload,
    (event) => event.type === "post.links.changed" || (Boolean(query) && event.type === "post.created"),
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
  const more = useLoadMore(state, {
    loaded: (data) => data.posts.length,
    total: (data) => (query ? (data.nextCursor ? data.posts.length + 1 : data.posts.length) : data.total),
    fetch: (offset) => fetchPage(undefined, offset, state.data?.nextCursor),
    merge: (current, page) => {
      if (!query) return withOlderPosts(current, page);
      const known = new Set(current.posts.map((post) => post.id));
      return { ...page, posts: [...current.posts, ...page.posts.filter((post) => !known.has(post.id))] };
    },
  });
  return { ...state, ...more };
}

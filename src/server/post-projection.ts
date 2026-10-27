import type { PostsSearchResponse } from "../api-types.js";
import { searchPostCandidates } from "../broker/post-queries.js";
import { USER_NAME } from "../constants.js";
import { runSearch } from "../search/index.js";
import { getPost } from "../store/wall-queries.js";
import { postsForUser } from "../store/user-post-state.js";
import { requireSwarmItem, type ApiDeps } from "./api-util.js";
import { positiveQuery, searchQuery, searchSettings, textQuery } from "./work-input.js";

export async function searchPosts(deps: ApiDeps, swarmId: number, url: URL): Promise<PostsSearchResponse> {
  requireSwarmItem(deps, swarmId);
  const candidates = searchPostCandidates(deps.db, swarmId, USER_NAME, {
    author: textQuery(url, "author"),
    taskId: positiveQuery(url, "taskId"),
    criterionId: positiveQuery(url, "criterionId"),
  });
  const result = await runSearch({
    db: deps.db,
    kind: "post",
    candidates,
    ...searchQuery(url),
    settings: searchSettings(deps.db),
  });
  const posts = postsForUser(
    deps.db,
    swarmId,
    result.items.flatMap((item) => {
      const post = getPost(deps.db, swarmId, Number(item.id));
      return post === null ? [] : [post];
    }),
  );
  return { ...result, posts, items: posts, total: candidates.length };
}

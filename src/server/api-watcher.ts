import type { WatcherChatResponse } from "../api-types.js";
import { sendWatcherChat } from "../broker/watcher-chat.js";
import { postsForUser } from "../store/user-post-state.js";
import { getPostDetail } from "../store/wall-queries.js";
import { watcherChatPostId } from "../store/watcher-chat.js";
import { postLinks } from "./work-projection.js";
import { readUserJsonBody, reply, requireSwarmItem, stringField, type ApiDeps, type ApiRoute } from "./api-util.js";

function chatResponse(deps: ApiDeps, swarmId: number): WatcherChatResponse {
  const postId = watcherChatPostId(deps.db, swarmId);
  const detail = postId === undefined ? null : getPostDetail(deps.db, swarmId, postId);
  return {
    conversation:
      detail === null
        ? null
        : {
            ...detail,
            post: postsForUser(deps.db, swarmId, [detail.post])[0] ?? detail.post,
            links: postLinks(deps.db, swarmId, detail.post.id),
          },
  };
}

export function watcherRoutes(deps: ApiDeps): ApiRoute[] {
  const pattern = "/api/swarms/:swarmId/watcher";
  return [
    {
      method: "GET",
      pattern,
      handle: ({ params }) =>
        deps.db.read(() => {
          const swarm = requireSwarmItem(deps, params.id("swarmId"));
          return reply(chatResponse(deps, swarm.id));
        }),
    },
    {
      method: "POST",
      pattern,
      handle: async ({ req, params }) => {
        const body = await readUserJsonBody(req);
        const text = stringField(body, "text");
        return deps.db.write(() => {
          const swarm = requireSwarmItem(deps, params.id("swarmId"));
          sendWatcherChat(deps.db, swarm.id, text, deps.clock.now());
          return reply(chatResponse(deps, swarm.id), 201);
        });
      },
    },
  ];
}

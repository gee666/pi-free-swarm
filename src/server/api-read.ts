// GET routes of the board API.
import type {
  PostDetailResponse,
  PostListResponse,
  SessionPage,
  StatsResponse,
  SwarmDetailResponse,
  SwarmListResponse,
} from "../api-types.js";
import { searchPosts } from "./post-projection.js";
import { postLinks } from "./work-projection.js";
import { SESSION_PAGE_DEFAULT, SESSION_PAGE_MAX } from "../constants.js";
import { getStats } from "../store/stats-queries.js";
import { listAgentSessions, listParticipants, listSwarms } from "../store/swarm-queries.js";
import { getPostDetail, listPosts } from "../store/wall-queries.js";
import { userUnreadSummary } from "../store/user-unread.js";
import { postsForUser } from "../store/user-post-state.js";
import { getUserPostAttention } from "../broker/user-post-subscription.js";
import {
  ApiFailure,
  intQuery,
  notFound,
  pageQuery,
  reply,
  requireSwarmItem,
  type ApiDeps,
  type ApiRoute,
} from "./api-util.js";

function sessionLimit(url: URL): number {
  const limit = intQuery(url, "limit", SESSION_PAGE_DEFAULT);
  if (Number.isInteger(limit) && limit >= 1 && limit <= SESSION_PAGE_MAX) return limit;
  throw new ApiFailure(400, "validation", `limit must be an integer 1–${SESSION_PAGE_MAX}.`, "limit");
}

export function readRoutes(deps: ApiDeps): ApiRoute[] {
  const { db, clock } = deps;
  return [
    {
      method: "GET",
      pattern: "/api/swarms",
      handle: () => deps.db.read(() => reply<SwarmListResponse>({ swarms: listSwarms(db, clock.now(), deps.alive) })),
    },
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId",
      handle: ({ params }) => {
        return deps.db.read(() => {
          const swarm = requireSwarmItem(deps, params.id("swarmId"));
          return reply<SwarmDetailResponse>({
            swarm,
            participants: listParticipants(db, swarm.id),
            userUnread: userUnreadSummary(db, swarm.id),
          });
        });
      },
    },
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId/posts",
      handle: async ({ params, url }) => {
        if (["query", "author", "taskId", "criterionId", "cursor", "limit"].some((key) => url.searchParams.has(key)))
          return reply(await searchPosts(deps, params.id("swarmId"), url));
        return db.read(() => {
          const page = pageQuery(url);
          const swarm = requireSwarmItem(deps, params.id("swarmId"));
          const result = listPosts(db, swarm.id, page);
          return reply<PostListResponse>({ ...result, posts: postsForUser(db, swarm.id, result.posts) });
        });
      },
    },
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId/posts/:postId",
      handle: ({ params }) => {
        return deps.db.read(() => {
          const swarm = requireSwarmItem(deps, params.id("swarmId"));
          const postId = params.id("postId");
          const detail = getPostDetail(db, swarm.id, postId);
          if (detail === null) throw notFound(`Post #${postId} not found.`);
          return reply<PostDetailResponse>({
            ...detail,
            links: postLinks(db, swarm.id, postId),
            post: postsForUser(db, swarm.id, [detail.post])[0] ?? detail.post,
          });
        });
      },
    },
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId/posts/:postId/subscription",
      handle: ({ params }) =>
        deps.db.read(() => reply(getUserPostAttention(db, params.id("swarmId"), params.id("postId")))),
    },
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId/agents/:name/session",
      handle: async ({ params, url }) => {
        const limit = sessionLimit(url);
        const agent = db.read(() => {
          const swarm = requireSwarmItem(deps, params.id("swarmId"));
          const name = params.text("name");
          const found = listAgentSessions(db, swarm.id).find((a) => a.name.toLowerCase() === name.toLowerCase());
          if (found === undefined) throw notFound(`Agent ${name} not found.`);
          return found;
        });
        const query = {
          before: url.searchParams.get("before") ?? undefined,
          after: url.searchParams.get("after") ?? undefined,
          limit,
        };
        return reply<SessionPage>(await deps.sessions.readPage(agent.name, agent.sessionFile, query));
      },
    },
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId/stats",
      handle: ({ params }) => {
        return deps.db.read(() => {
          const swarmId = params.id("swarmId");
          const stats = getStats(db, swarmId, clock.now());
          if (stats === null) throw notFound(`Swarm #${swarmId} not found.`);
          return reply<StatsResponse>(stats);
        });
      },
    },
  ];
}

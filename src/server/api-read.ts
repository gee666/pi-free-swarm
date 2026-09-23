// GET routes of the board API.
import type {
  MailboxKind,
  MailboxResponse,
  PostDetailResponse,
  PostListResponse,
  SessionPage,
  StatsResponse,
  SwarmDetailResponse,
  SwarmListResponse,
  ThreadResponse,
} from "../api-types.js";
import { SESSION_PAGE_DEFAULT, SESSION_PAGE_MAX } from "../constants.js";
import { getMailbox, getThread } from "../store/message-queries.js";
import { getStats } from "../store/stats-queries.js";
import { getParticipant, listAgentSessions, listParticipants, listSwarms } from "../store/swarm-queries.js";
import { getPostDetail, listPosts } from "../store/wall-queries.js";
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

function boxQuery(url: URL): MailboxKind {
  const box = url.searchParams.get("box") ?? "inbox";
  if (box === "inbox" || box === "sent") return box;
  throw new ApiFailure(400, "validation", 'box must be "inbox" or "sent".', "box");
}

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
      handle: () => reply<SwarmListResponse>({ swarms: listSwarms(db, clock.now(), deps.alive) }),
    },
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId",
      handle: ({ params }) => {
        const swarm = requireSwarmItem(deps, params.id("swarmId"));
        return reply<SwarmDetailResponse>({ swarm, participants: listParticipants(db, swarm.id) });
      },
    },
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId/posts",
      handle: ({ params, url }) => {
        const page = pageQuery(url);
        const swarm = requireSwarmItem(deps, params.id("swarmId"));
        return reply<PostListResponse>(listPosts(db, swarm.id, page));
      },
    },
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId/posts/:postId",
      handle: ({ params }) => {
        const swarm = requireSwarmItem(deps, params.id("swarmId"));
        const postId = params.id("postId");
        const detail = getPostDetail(db, swarm.id, postId);
        if (detail === null) throw notFound(`Post #${postId} not found.`);
        return reply<PostDetailResponse>(detail);
      },
    },
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId/participants/:name/messages",
      handle: ({ params, url }) => {
        const box = boxQuery(url);
        const page = pageQuery(url);
        const swarm = requireSwarmItem(deps, params.id("swarmId"));
        const name = params.text("name");
        const participant = getParticipant(db, swarm.id, name);
        if (participant === null) throw notFound(`Participant ${name} not found.`);
        return reply<MailboxResponse>(getMailbox(db, swarm.id, participant.name, box, page));
      },
    },
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId/threads/:threadId",
      handle: ({ params }) => {
        const swarm = requireSwarmItem(deps, params.id("swarmId"));
        const threadId = params.id("threadId");
        const thread = getThread(db, swarm.id, threadId);
        if (thread === null) throw notFound(`Thread #${threadId} not found.`);
        return reply<ThreadResponse>(thread);
      },
    },
    {
      method: "GET",
      pattern: "/api/swarms/:swarmId/agents/:name/session",
      handle: async ({ params, url }) => {
        const limit = sessionLimit(url);
        const swarm = requireSwarmItem(deps, params.id("swarmId"));
        const name = params.text("name");
        const agent = listAgentSessions(db, swarm.id).find((a) => a.name.toLowerCase() === name.toLowerCase());
        if (agent === undefined) throw notFound(`Agent ${name} not found.`);
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
        const swarmId = params.id("swarmId");
        const stats = getStats(db, swarmId, clock.now());
        if (stats === null) throw notFound(`Swarm #${swarmId} not found.`);
        return reply<StatsResponse>(stats);
      },
    },
  ];
}

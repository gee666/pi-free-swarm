// POST routes of the board API. The board always acts as User.
import type { CreateCommentResponse, CreatePostResponse, MarkReadResponse, SendMessageResponse } from "../api-types.js";
import { markUserRead, replyToThread, sendMessage } from "../broker/messages.js";
import { markUserCommentsRead } from "../broker/user-comment-read.js";
import { setUserPostSubscription } from "../broker/user-post-subscription.js";
import { addComment, createPost } from "../broker/wall.js";
import { NOT_RUNNING_TEXT, USER_NAME } from "../constants.js";
import {
  ApiFailure,
  idArrayField,
  notFound,
  readJsonBody,
  readUserJsonBody,
  reply,
  requireSwarmItem,
  stringArrayField,
  stringField,
  type ApiDeps,
  type ApiRoute,
} from "./api-util.js";

const CREATED = 201;

/**
 * Rejects messages to a swarm nobody runs. The broker re-checks inside its transaction and stores a
 * message that loses that race as undeliverable, with a System reply.
 */
function requireAcceptingSwarm(deps: ApiDeps, swarmId: number): number {
  const swarm = requireSwarmItem(deps, swarmId);
  if (!swarm.acceptsMessages) throw new ApiFailure(409, "swarm_not_running", NOT_RUNNING_TEXT);
  return swarm.id;
}

export function writeRoutes(deps: ApiDeps): ApiRoute[] {
  const { db, clock } = deps;
  return [
    {
      method: "POST",
      pattern: "/api/swarms/:swarmId/posts",
      handle: async ({ req, params }) => {
        const body = await readUserJsonBody(req);
        const input = { title: stringField(body, "title"), text: stringField(body, "text") };
        const swarm = requireSwarmItem(deps, params.id("swarmId"));
        const post = createPost(db, swarm.id, USER_NAME, input, clock.now());
        return reply<CreatePostResponse>({ post: { ...post, userSubscribed: true, userUnreadComments: 0 } }, CREATED);
      },
    },
    {
      method: "POST",
      pattern: "/api/swarms/:swarmId/posts/:postId/comments",
      handle: async ({ req, params }) => {
        const text = stringField(await readUserJsonBody(req), "text");
        const swarm = requireSwarmItem(deps, params.id("swarmId"));
        const result = addComment(db, swarm.id, USER_NAME, params.id("postId"), text, clock.now());
        return reply<CreateCommentResponse>(result, CREATED);
      },
    },
    {
      method: "POST",
      pattern: "/api/swarms/:swarmId/posts/:postId/read",
      handle: async ({ req, params }) => {
        const ids = idArrayField(await readJsonBody(req), "commentIds");
        return reply(markUserCommentsRead(db, params.id("swarmId"), params.id("postId"), ids, clock.now()));
      },
    },
    {
      method: "POST",
      pattern: "/api/swarms/:swarmId/posts/:postId/subscription",
      handle: async ({ req, params }) => {
        const body = await readJsonBody(req);
        return reply(
          setUserPostSubscription(db, params.id("swarmId"), params.id("postId"), body.subscribed, clock.now()),
        );
      },
    },
    {
      method: "POST",
      pattern: "/api/swarms/:swarmId/messages",
      handle: async ({ req, params }) => {
        const body = await readUserJsonBody(req);
        const to = stringArrayField(body, "to");
        const text = stringField(body, "text");
        const swarmId = requireAcceptingSwarm(deps, params.id("swarmId"));
        const message = sendMessage(db, swarmId, USER_NAME, to, text, clock.now());
        return reply<SendMessageResponse>({ message }, CREATED);
      },
    },
    {
      method: "POST",
      pattern: "/api/swarms/:swarmId/threads/:threadId/reply",
      handle: async ({ req, params }) => {
        const text = stringField(await readUserJsonBody(req), "text");
        const swarmId = requireAcceptingSwarm(deps, params.id("swarmId"));
        const message = replyToThread(db, swarmId, USER_NAME, params.id("threadId"), text, clock.now());
        return reply<SendMessageResponse>({ message }, CREATED);
      },
    },
    {
      method: "POST",
      pattern: "/api/swarms/:swarmId/participants/:name/read",
      handle: async ({ req, params }) => {
        const name = params.text("name");
        if (name.toLowerCase() !== USER_NAME.toLowerCase()) {
          throw notFound(`Only ${USER_NAME}'s messages can be marked read here, not ${name}'s.`);
        }
        const messageIds = idArrayField(await readJsonBody(req), "messageIds");
        const swarm = requireSwarmItem(deps, params.id("swarmId"));
        return reply<MarkReadResponse>(markUserRead(db, swarm.id, messageIds, clock.now()));
      },
    },
  ];
}

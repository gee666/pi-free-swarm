// POST routes of the board API. The board always acts as User.
import type { CreateCommentResponse, CreatePostResponse } from "../api-types.js";
import { markUserCommentsRead } from "../broker/user-comment-read.js";
import { setUserPostSubscription } from "../broker/user-post-subscription.js";
import { addComment, createPost } from "../broker/wall.js";
import { updatePostLinks } from "../broker/post-links.js";
import { postLinkFields } from "./work-input.js";
import { postLinks } from "./work-projection.js";
import { USER_NAME } from "../constants.js";
import {
  idArrayField,
  readJsonBody,
  readUserJsonBody,
  reply,
  requireSwarmItem,
  stringField,
  type ApiDeps,
  type ApiRoute,
} from "./api-util.js";

const CREATED = 201;

export function writeRoutes(deps: ApiDeps): ApiRoute[] {
  const { db, clock } = deps;
  return [
    ...["link", "unlink"].map((action): ApiRoute => ({
      method: "POST",
      pattern: `/api/swarms/:swarmId/posts/:postId/${action}`,
      handle: async ({ req, params }) => {
        const body = await readUserJsonBody(req);
        const swarm = requireSwarmItem(deps, params.id("swarmId"));
        const result = updatePostLinks(db, {
          swarmId: swarm.id,
          actor: USER_NAME,
          now: clock.now(),
          postId: params.id("postId"),
          ...postLinkFields(body),
          remove: action === "unlink",
        });
        return reply({ id: result.id, links: postLinks(db, swarm.id, result.id) });
      },
    })),
    {
      method: "POST",
      pattern: "/api/swarms/:swarmId/posts",
      handle: async ({ req, params }) => {
        const body = await readUserJsonBody(req);
        const input = { title: stringField(body, "title"), text: stringField(body, "text"), broadcast: body.broadcast };
        const swarm = requireSwarmItem(deps, params.id("swarmId"));
        const links = postLinkFields(body);
        const post = db.write(() => {
          const now = clock.now();
          const created = createPost(db, swarm.id, USER_NAME, input, now);
          updatePostLinks(db, { swarmId: swarm.id, actor: USER_NAME, now, postId: created.id, ...links });
          return created;
        });
        return reply<CreatePostResponse>(
          { post: { ...post, userSubscribed: true, userUnreadComments: 0 }, links: postLinks(db, swarm.id, post.id) },
          CREATED,
        );
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
  ];
}
